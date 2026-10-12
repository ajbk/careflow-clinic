import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/config.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { cookieFrom, seedAccount, TEST_PASSWORD } from "./helpers/auth.js";

const origin = "https://clinic.example.test";
const environment = {
  CAREFLOW_PROFILE: "cloud",
  CAREFLOW_PUBLIC_ORIGIN: origin,
  CAREFLOW_TRUSTED_PROXIES: "127.0.0.1,::1",
  CAREFLOW_ENVIRONMENT_ID: "synthetic-cloud-test",
  CAREFLOW_DB_PATH: "/data/careflow.sqlite",
  CAREFLOW_COOKIE_SECURE: "true",
};
const headers = { host: "clinic.example.test", "x-forwarded-proto": "https", origin };
let app: FastifyInstance | undefined;
let database: TestDatabase | undefined;
afterEach(async () => { await app?.close(); database?.cleanup(); app = undefined; database = undefined; });

async function setup(overrides: Record<string, string> = {}) {
  database = createTestDatabase();
  await seedAccount(database, { mustChangePassword: false });
  app = await buildApp({ db: database, config: loadConfig({ ...environment, ...overrides, CAREFLOW_DB_PATH: database.databasePath }),
    clock: () => new Date("2026-10-09T00:00:00.000Z"), idFactory: randomUUID });
  await app.ready();
  return app;
}

describe("cloud configuration", () => {
  it("requires an explicit HTTPS origin, exact trusted proxy peers, secure cookie and absolute DB", () => {
    expect(loadConfig(environment)).toHaveProperty("cloud.publicOrigin", origin);
  });
  it.each([
    { CAREFLOW_PUBLIC_ORIGIN: "http://clinic.example.test" },
    { CAREFLOW_PUBLIC_ORIGIN: "https://clinic.example.test/path" },
    { CAREFLOW_PUBLIC_ORIGIN: "https://user:secret@clinic.example.test" },
    { CAREFLOW_TRUSTED_PROXIES: "true" },
    { CAREFLOW_TRUSTED_PROXIES: "1" },
    { CAREFLOW_TRUSTED_PROXIES: "0.0.0.0/0" },
    { CAREFLOW_TRUSTED_PROXIES: "10.0.0.1" },
    { CAREFLOW_ENVIRONMENT_ID: "" },
    { CAREFLOW_DB_PATH: "./careflow.sqlite" },
    { CAREFLOW_COOKIE_SECURE: "false" },
  ])("rejects unsafe cloud configuration %j", (override) => {
    expect(() => loadConfig({ ...environment, ...override })).toThrow("Invalid CareFlow configuration");
  });
  it("rejects an unknown deployment profile", () => {
    expect(() => loadConfig({ CAREFLOW_PROFILE: "production-typo" })).toThrow();
  });
});

describe("cloud request boundary", () => {
  it("rejects an untrusted socket even if forwarding headers claim HTTPS", async () => {
    const server = await setup();
    const response = await server.inject({ url: "/api/health", remoteAddress: "198.51.100.2", headers });
    expect(response.statusCode).toBe(403);
  });
  it.each([
    { ...headers, host: "attacker.test" },
    { ...headers, "x-forwarded-proto": "http" },
    { ...headers, "x-forwarded-proto": "https,http" },
    { ...headers, "x-forwarded-host": "attacker.test" },
  ])("rejects malformed or unapproved proxy metadata %j", async (requestHeaders) => {
    const server = await setup();
    expect((await server.inject({ url: "/api/health", remoteAddress: "127.0.0.1", headers: requestHeaders })).statusCode).toBe(403);
  });
  it("rejects a cross-origin login before issuing a session", async () => {
    const server = await setup();
    const response = await server.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "127.0.0.1",
      headers: { ...headers, origin: "https://attacker.test" }, payload: { username: "doctor", password: TEST_PASSWORD } });
    expect(response.statusCode).toBe(403);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(database!.sqlite.prepare("SELECT count(*) n FROM sessions").get()).toEqual({ n: 0 });
  });
  it("issues a host-only secure cookie and enforces a session-bound CSRF token", async () => {
    const server = await setup();
    const response = await server.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "127.0.0.1", headers,
      payload: { username: "doctor", password: TEST_PASSWORD } });
    expect(response.statusCode).toBe(200);
    const setCookie = String(response.headers["set-cookie"]);
    expect(setCookie).toContain("__Host-careflow_session=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Domain=");
    expect(response.headers["cache-control"]).toBe("no-store");
    const cookie = cookieFrom(response);
    const csrfToken = response.json().data.security.csrfToken as string;
    expect(csrfToken).toMatch(/^[a-f0-9]{64}$/);
    const denied = await server.inject({ method: "POST", url: "/api/auth/activity", remoteAddress: "127.0.0.1", headers: { ...headers, cookie } });
    expect(denied.statusCode).toBe(403);
    const allowed = await server.inject({ method: "POST", url: "/api/auth/activity", remoteAddress: "127.0.0.1", headers: { ...headers, cookie, "x-csrf-token": csrfToken } });
    expect(allowed.statusCode).toBe(204);
  });
  it("audits access and rejected requests without retaining passwords, cookies or raw URL data", async () => {
    const server = await setup();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", headers, payload: { username: "doctor", password: TEST_PASSWORD } });
    const read = await server.inject({ url: "/api/patients/search?q=private-search", headers: { ...headers, cookie: cookieFrom(login) } });
    expect(read.statusCode).toBe(200);
    await server.inject({ method: "POST", url: "/api/auth/activity", headers: { ...headers, cookie: cookieFrom(login) } });
    const events = database!.sqlite.prepare("SELECT * FROM security_events").all();
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action: "login.succeeded", actor_id: "doctor-001" }), expect.objectContaining({ action: "request.denied" }), expect.objectContaining({ action: "record.read", route: "/api/patients/search", actor_id: "doctor-001" })]));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain("private-search");
    expect(serialized).not.toContain(cookieFrom(login));
    expect(() => database!.sqlite.exec("DELETE FROM security_events")).toThrow(/append-only/);
  });
  it("does not disclose search results if the read audit cannot be written", async () => {
    const server = await setup();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", headers, payload: { username: "doctor", password: TEST_PASSWORD } });
    database!.sqlite.exec("CREATE TEMP TRIGGER fail_read_audit BEFORE INSERT ON security_events WHEN NEW.action='record.read' BEGIN SELECT RAISE(ABORT, 'synthetic disk full'); END");
    const read = await server.inject({ url: "/api/patients/search?q=DEMO", headers: { ...headers, cookie: cookieFrom(login) } });
    expect(read.statusCode).toBe(500);
    expect(read.json()).not.toHaveProperty("data");
    expect(read.body).not.toContain("synthetic disk full");
  });
  it("shares the durable account password budget with the change-password endpoint across IPs", async () => {
    const server = await setup();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", headers, payload: { username: "doctor", password: TEST_PASSWORD } });
    const security = login.json().data.security;
    for (let attempt = 0; attempt < 4; attempt++) {
      const denied = await server.inject({ method: "POST", url: "/api/auth/change-password", headers: { ...headers, cookie: cookieFrom(login), "x-csrf-token": security.csrfToken, "x-forwarded-for": `198.51.100.${attempt + 1}` }, payload: { currentPassword: "wrong-synthetic-password", newPassword: "synthetic-new-password-1234" } });
      expect(denied.statusCode).toBe(401);
    }
    const throttled = await server.inject({ method: "POST", url: "/api/auth/change-password", headers: { ...headers, cookie: cookieFrom(login), "x-csrf-token": security.csrfToken, "x-forwarded-for": "203.0.113.5" }, payload: { currentPassword: TEST_PASSWORD, newPassword: "synthetic-new-password-1234" } });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe("RATE_LIMITED");
    expect(database!.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action='account.password-changed'").pluck().get()).toBe(0);
  });
  it("blocks cloud writes under the selected backup policy while status and liveness stay available", async () => {
    const server = await setup({ CAREFLOW_BACKUP_MAX_AGE_SECONDS: "600" });
    const login = await server.inject({ method: "POST", url: "/api/auth/login", headers, payload: { username: "doctor", password: TEST_PASSWORD } });
    const security = login.json().data.security;
    const response = await server.inject({ method: "POST", url: "/api/patients/synthetic", headers: { ...headers, cookie: cookieFrom(login), "x-csrf-token": security.csrfToken,
      "idempotency-key": "no-backup-patient-1", "x-careflow-generation": security.generation }, payload: { expectedRevisions: {}, payload: {} } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("OPERATIONAL_HOLD");
    expect(database!.sqlite.prepare("SELECT count(*) FROM patients").pluck().get()).toBe(0);
    expect((await server.inject({ url: "/api/live", headers })).statusCode).toBe(200);
    expect((await server.inject({ url: "/api/ready", headers })).statusCode).toBe(503);
  });
  it("rejects a stale generation before a clinical command can write", async () => {
    const server = await setup();
    const login = await server.inject({ method: "POST", url: "/api/auth/login", headers, payload: { username: "doctor", password: TEST_PASSWORD } });
    const security = login.json().data.security;
    const response = await server.inject({ method: "POST", url: "/api/patients/synthetic", headers: { ...headers, cookie: cookieFrom(login), "x-csrf-token": security.csrfToken,
      "idempotency-key": "stale-generation-test", "x-careflow-generation": "before-restore" }, payload: { expectedRevisions: {}, payload: {} } });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe("GENERATION_CHANGED");
    expect(database!.sqlite.prepare("SELECT count(*) n FROM patients").get()).toEqual({ n: 0 });
  });
});
