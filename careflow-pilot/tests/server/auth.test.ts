import { createHash } from "node:crypto";
import argon2 from "argon2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditEvents, sessions, staffAccounts } from "../../src/server/modules/platform/index.js";
import { cookieFrom, login, rawTokenFrom, seedAccount, TEST_NEW_PASSWORD } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("named account sessions", () => {
  it("stores only a SHA-256 token hash and authenticates the named account cookie", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    const logCapture = vi.spyOn(fixture.app.log, "info");

    const response = await login(fixture.app, account.username, account.password);
    const cookie = cookieFrom(response);
    const rawToken = rawTokenFrom(cookie);
    const stored = fixture.database.db.select().from(sessions).get();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        user: { id: account.actor.id, username: account.username, role: "doctor" },
        clinic: { id: "clinic" },
        permissions: expect.arrayContaining(["visit:start-consultation"]),
        mustChangePassword: false,
      },
    });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored?.tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(stored?.tokenHash).not.toBe(rawToken);
    expect(JSON.stringify(response.json())).not.toContain(rawToken);
    expect(JSON.stringify(response.json())).not.toContain(stored?.tokenHash);
    expect(JSON.stringify(response.json())).not.toContain(account.passwordHash);
    expect(JSON.stringify(logCapture.mock.calls)).not.toContain(rawToken);
    expect(JSON.stringify(logCapture.mock.calls)).not.toContain(stored?.tokenHash);
    expect(JSON.stringify(logCapture.mock.calls)).not.toContain(account.passwordHash);

    const session = await fixture.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.user.id).toBe(account.actor.id);
  });

  it("performs one real Argon2 verification for unknown, wrong, and disabled logins with one generic response", async () => {
    const verify = vi.fn((hash: string, password: string) => argon2.verify(hash, password));
    const fixture = await createTestApp({ passwordVerifier: verify });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { active: false });

    const unknown = await login(fixture.app, "missing", account.password);
    const wrong = await login(fixture.app, account.username, "รหัสผ่านผิดแต่ยาวพอ-0000");
    const disabled = await login(fixture.app, account.username, account.password);

    expect(verify).toHaveBeenCalledTimes(3);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(disabled.statusCode).toBe(401);
    expect(unknown.json().error).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(wrong.json().error).toEqual(unknown.json().error);
    expect(disabled.json().error).toEqual(unknown.json().error);
  });

  it("requires Pilot acknowledgement before password change and records acceptance only once", async () => {
    let now = new Date("2026-08-03T01:00:00.000Z");
    const fixture = await createTestApp({ clock: () => now });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, {
      pilotAcknowledgedAt: null,
      mustChangePassword: true,
    });
    const auth = await login(fixture.app, account.username, account.password);
    const cookie = cookieFrom(auth);

    const before = await fixture.app.inject({ method: "GET", url: "/api/test/doctor", headers: { cookie } });
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe("PILOT_ACKNOWLEDGEMENT_REQUIRED");

    const accepted = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/acknowledge-pilot",
      headers: { cookie },
      payload: { accepted: true },
    });
    expect(accepted.statusCode).toBe(204);
    const first = fixture.database.db.select().from(staffAccounts).get();
    expect(first).toMatchObject({ pilotAcknowledgedAt: now.toISOString(), revision: 2 });
    expect(fixture.database.db.select().from(auditEvents).get()).toMatchObject({
      actorId: account.actor.id,
      actorRole: "doctor",
      action: "account.pilot-acknowledged",
      entityRevision: 2,
    });

    now = new Date("2026-08-03T01:01:00.000Z");
    const repeated = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/acknowledge-pilot",
      headers: { cookie },
      payload: { accepted: true },
    });
    expect(repeated.statusCode).toBe(204);
    expect(fixture.database.db.select().from(staffAccounts).get()).toMatchObject({
      pilotAcknowledgedAt: "2026-08-03T01:00:00.000Z",
      revision: 2,
    });
    expect(fixture.database.db.select().from(auditEvents).all()).toHaveLength(1);

    const gated = await fixture.app.inject({ method: "GET", url: "/api/test/doctor", headers: { cookie } });
    expect(gated.statusCode).toBe(403);
    expect(gated.json().error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("expires at exact idle and absolute boundaries without polling sliding activity", async () => {
    let now = new Date("2026-08-03T00:00:00.000Z");
    const fixture = await createTestApp({ clock: () => now });
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });

    let auth = await login(fixture.app, account.username, account.password);
    let cookie = cookieFrom(auth);
    for (let seconds = 5; seconds < 900; seconds += 5) {
      now = new Date(Date.parse("2026-08-03T00:00:00.000Z") + seconds * 1000);
      const read = await fixture.app.inject({ method: "GET", url: "/api/test/doctor", headers: { cookie } });
      expect(read.statusCode).toBe(200);
    }
    expect(fixture.database.db.select().from(sessions).get()?.lastSeenAt).toBe("2026-08-03T00:00:00.000Z");
    now = new Date("2026-08-03T00:15:00.000Z");
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(401);

    now = new Date("2026-08-03T02:00:00.000Z");
    auth = await login(fixture.app, account.username, account.password);
    cookie = cookieFrom(auth);
    now = new Date("2026-08-03T02:14:59.000Z");
    expect((await fixture.app.inject({ method: "POST", url: "/api/auth/activity", headers: { cookie } })).statusCode).toBe(204);
    now = new Date("2026-08-03T02:29:58.000Z");
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);

    now = new Date("2026-08-03T09:59:59.000Z");
    fixture.database.sqlite.prepare("UPDATE sessions SET last_seen_at = ?").run(now.toISOString());
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(200);
    now = new Date("2026-08-03T10:00:00.000Z");
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(401);
  });

  it("enforces Doctor permission on direct requests independently of UI visibility", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { username: "assistant", role: "assistant", mustChangePassword: false });
    const cookie = cookieFrom(await login(fixture.app, account.username, account.password));

    const response = await fixture.app.inject({ method: "GET", url: "/api/test/doctor", headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("revokes sessions for an account disabled after issuance", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    const cookie = cookieFrom(await login(fixture.app, account.username, account.password));
    fixture.database.sqlite.prepare("UPDATE staff_accounts SET active = 0").run();

    const response = await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(0);
  });

  it("rate limits the sixth failed login per IP and normalized username", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await login(fixture.app, attempt % 2 ? " Missing " : "missing", "wrong-password-value", {
        remoteAddress: "127.0.0.9",
      });
      expect(response.statusCode).toBe(attempt <= 5 ? 401 : 429);
      expect(response.json().error.code).toBe(attempt <= 5 ? "AUTH_REQUIRED" : "RATE_LIMITED");
    }
  });

  it("changes password atomically, invalidates old cookies, and issues one usable replacement", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: true });
    const firstCookie = cookieFrom(await login(fixture.app, account.username, account.password));
    const secondCookie = cookieFrom(await login(fixture.app, account.username, account.password));

    const changed = await fixture.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { cookie: firstCookie },
      payload: { currentPassword: account.password, newPassword: TEST_NEW_PASSWORD },
    });
    const replacement = cookieFrom(changed);
    expect(changed.statusCode).toBe(204);
    expect(JSON.stringify(changed.payload)).not.toContain(TEST_NEW_PASSWORD);
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: firstCookie } })).statusCode).toBe(401);
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: secondCookie } })).statusCode).toBe(401);
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: replacement } })).statusCode).toBe(200);
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(1);
    expect(fixture.database.db.select().from(auditEvents).get()).toMatchObject({ action: "account.password-changed", actorId: account.actor.id });
  });

  it("revokes the current session and expires the cookie on logout", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const account = await seedAccount(fixture.database, { mustChangePassword: false });
    const cookie = cookieFrom(await login(fixture.app, account.username, account.password));

    const response = await fixture.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(response.statusCode).toBe(204);
    expect(response.headers["set-cookie"]).toMatch(/careflow_session=;.*Max-Age=0/i);
    expect(fixture.database.db.select().from(sessions).all()).toHaveLength(0);
    expect((await fixture.app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } })).statusCode).toBe(401);
  });
});
