import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPIRE_UAT_DOCTOR_SESSION_CONFIRMATION,
  runExpireUatDoctorSession,
} from "../../src/server/maintenance/expire-uat-doctor-session.js";
import { buildApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/client.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface StoredSession {
  tokenHash: string;
  staffId: string;
  expiresAt: string;
}

function sessionsIn(databasePath: string): StoredSession[] {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare(
      "SELECT token_hash AS tokenHash, staff_id AS staffId, expires_at AS expiresAt FROM sessions ORDER BY staff_id, token_hash",
    ).all() as StoredSession[];
  } finally {
    database.close();
  }
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expire(databasePath: string, confirmation = EXPIRE_UAT_DOCTOR_SESSION_CONFIRMATION) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = runExpireUatDoctorSession({
    argv: ["--database", databasePath, "--confirm", confirmation],
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });
  return { code, output, errors };
}

async function preparedUatSessionDatabase(filename = "careflow-uat.sqlite") {
  const fixture = await createTestApp({ clock: () => new Date() });
  const directory = dirname(fixture.databasePath);
  let closed = false;
  const closeFixture = async () => {
    if (closed) return;
    await fixture.app.close();
    fixture.database.close();
    closed = true;
  };
  cleanups.push(async () => {
    await closeFixture();
    rmSync(directory, { recursive: true, force: true });
  });

  const doctor = await seedAccount(fixture.database, {
    id: "uat-doctor-001",
    username: "uat-doctor",
    role: "doctor",
    displayName: "แพทย์ UAT",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(fixture.database, {
    id: "uat-assistant-001",
    username: "uat-assistant",
    role: "assistant",
    displayName: "ผู้ช่วย UAT",
    mustChangePassword: false,
  });
  const doctorCookie = cookieFrom(await login(fixture.app, doctor.username, doctor.password));
  const assistantCookie = cookieFrom(await login(fixture.app, assistant.username, assistant.password));

  await closeFixture();
  const databasePath = join(directory, filename);
  renameSync(fixture.databasePath, databasePath);
  return { assistant, assistantCookie, databasePath, doctor, doctorCookie };
}

async function reopenUatApp(databasePath: string) {
  const database = openDatabase(databasePath);
  const app = await buildApp({
    db: database,
    config: {
      host: "127.0.0.1",
      port: 3001,
      databasePath,
      cookieSecure: false,
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath: "./dist/client",
    },
    clock: () => new Date(),
    idFactory: () => "expire-uat-session-test",
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    database.close();
  });
  return { app, database };
}

describe("expire UAT Doctor session maintenance command", () => {
  it("sets only the single Doctor UAT session expiry timestamp and yields SERVER SESSION_EXPIRED", async () => {
    const fixture = await preparedUatSessionDatabase();
    const before = sessionsIn(fixture.databasePath);
    expect(before).toHaveLength(2);
    const doctorBefore = before.find((session) => session.staffId === fixture.doctor.actor.id);
    const assistantBefore = before.find((session) => session.staffId === fixture.assistant.actor.id);
    expect(doctorBefore).toBeDefined();
    expect(assistantBefore).toBeDefined();

    expect(expire(fixture.databasePath)).toEqual({
      code: 0,
      output: ["Doctor UAT session timestamp expired"],
      errors: [],
    });

    const after = sessionsIn(fixture.databasePath);
    const doctorAfter = after.find((session) => session.staffId === fixture.doctor.actor.id);
    const assistantAfter = after.find((session) => session.staffId === fixture.assistant.actor.id);
    expect(after).toHaveLength(2);
    expect(doctorAfter?.tokenHash).toBe(doctorBefore?.tokenHash);
    expect(Date.parse(doctorAfter?.expiresAt ?? "")).toBeLessThan(Date.now());
    expect(assistantAfter).toEqual(assistantBefore);

    const reopened = await reopenUatApp(fixture.databasePath);
    const expired = await reopened.app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: fixture.doctorCookie },
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe("SESSION_EXPIRED");
    expect(reopened.database.sqlite.prepare("SELECT count(*) FROM sessions WHERE staff_id = ?").pluck().get(fixture.doctor.actor.id)).toBe(0);
    expect(reopened.database.sqlite.prepare("SELECT count(*) FROM sessions WHERE staff_id = ?").pluck().get(fixture.assistant.actor.id)).toBe(1);
    expect(fixture.assistantCookie).toContain("careflow_session=");
  });

  it("rejects a non-UAT database filename before opening a writable handle", async () => {
    const fixture = await preparedUatSessionDatabase("careflow.sqlite");
    const before = hashFile(fixture.databasePath);

    const result = expire(fixture.databasePath);

    expect(result.code).toBe(1);
    expect(result.errors).toEqual(["Doctor UAT session expiry failed"]);
    expect(hashFile(fixture.databasePath)).toBe(before);
  });

  it.each(["database", "-wal", "-shm"] as const)("rejects a hard-linked %s artifact before any mutation", async (artifactKind) => {
    const fixture = await preparedUatSessionDatabase();
    let keeper: Database.Database | undefined;
    let artifactPath = fixture.databasePath;
    if (artifactKind !== "database") {
      keeper = new Database(fixture.databasePath);
      keeper.pragma("journal_mode = WAL");
      keeper.pragma("wal_autocheckpoint = 0");
      keeper.pragma("user_version = 1");
      artifactPath = `${fixture.databasePath}${artifactKind}`;
      cleanups.push(async () => { keeper?.close(); });
    }
    const aliasPath = `${artifactPath}.hard-link`;
    linkSync(artifactPath, aliasPath);
    expect(statSync(artifactPath).nlink).toBe(2);
    const protectedPaths = [...new Set([fixture.databasePath, artifactPath, aliasPath])];
    const before = new Map(protectedPaths.map((path) => [path, hashFile(path)]));

    const result = expire(fixture.databasePath);

    expect(result).toEqual({ code: 1, output: [], errors: ["Doctor UAT session expiry failed"] });
    expect(new Map(protectedPaths.map((path) => [path, hashFile(path)]))).toEqual(before);
  });

  it("rejects a non-Pilot database with the UAT filename before opening a writable handle", () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-expire-uat-non-pilot-"));
    const databasePath = join(directory, "careflow-uat.sqlite");
    const database = new Database(databasePath);
    database.exec("CREATE TABLE unrelated(value TEXT NOT NULL)");
    database.close();
    cleanups.push(async () => { rmSync(directory, { recursive: true, force: true }); });
    const before = hashFile(databasePath);

    const result = expire(databasePath);

    expect(result.code).toBe(1);
    expect(result.errors).toEqual(["Doctor UAT session expiry failed"]);
    expect(hashFile(databasePath)).toBe(before);
  });

  it("rejects ambiguous Doctor UAT sessions byte-for-byte unchanged", async () => {
    const fixture = await preparedUatSessionDatabase();
    const fixtureDatabase = openDatabase(fixture.databasePath);
    const app = await buildApp({
      db: fixtureDatabase,
      config: {
        host: "127.0.0.1",
        port: 3001,
        databasePath: fixture.databasePath,
        cookieSecure: false,
        sessionIdleMinutes: 15,
        sessionAbsoluteHours: 8,
        clientDistPath: "./dist/client",
      },
      clock: () => new Date(),
      idFactory: () => "expire-uat-session-ambiguous",
    });
    await app.ready();
    await login(app, fixture.doctor.username, fixture.doctor.password);
    await app.close();
    fixtureDatabase.close();
    const before = hashFile(fixture.databasePath);

    const result = expire(fixture.databasePath);

    expect(result.code).toBe(1);
    expect(result.errors).toEqual(["Doctor UAT session expiry failed"]);
    expect(hashFile(fixture.databasePath)).toBe(before);
  });
});
