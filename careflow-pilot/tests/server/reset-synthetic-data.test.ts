import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmdirSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runResetSyntheticData, RESET_CONFIRMATION } from "../../src/server/maintenance/reset-synthetic.js";
import { maintenanceLockPath } from "../../src/server/host-lock.js";
import { openDatabase } from "../../src/server/db/client.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function populatedDatabase() {
  const fixture = await createTestApp();
  cleanups.push(fixture.cleanup);
  const account = await seedAccount(fixture.database, {
    id: "reset-assistant-001",
    username: "reset-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยรีเซ็ต",
    mustChangePassword: false,
    pilotAcknowledgedAt: null,
  });
  const cookie = cookieFrom(await login(fixture.app, account.username, account.password));
  await fixture.app.inject({
    method: "POST",
    url: "/api/auth/acknowledge-pilot",
    headers: { cookie },
    payload: { accepted: true },
  });
  const patientResponse = await fixture.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie, "idempotency-key": "reset-patient-001" },
    payload: { expectedRevisions: {}, payload: {} },
  });
  const patient = patientResponse.json().data;
  const intakeResponse = await fixture.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie, "idempotency-key": "reset-intake-001" },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId: patient.id,
        chiefComplaint: "ไอ",
        vitals: {
          weightKg: 60,
          heightCm: 165,
          temperatureC: 37,
          systolicMmhg: 120,
          diastolicMmhg: 80,
          heartRateBpm: 80,
          spo2Percent: 98,
        },
      },
    },
  });
  expect(intakeResponse.statusCode).toBe(201);
  const accountAuditCount = fixture.database.sqlite
    .prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'account.%'")
    .pluck()
    .get();
  await fixture.app.close();
  fixture.database.close();
  return { ...fixture, accountAuditCount };
}

function reset(databasePath: string, confirmation = RESET_CONFIRMATION): { code: number; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const code = runResetSyntheticData({
    argv: ["--database", databasePath, "--confirm", confirmation],
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });
  return { code, output, errors };
}

describe("guarded synthetic reset", () => {
  it("deletes only synthetic workflow data and preserves accounts/account audit", async () => {
    const fixture = await populatedDatabase();
    const result = reset(fixture.databasePath);

    expect(result.code).toBe(0);
    expect(result.output).toEqual(["Synthetic Pilot data reset complete"]);
    expect(result.errors).toEqual([]);
    const database = new Database(fixture.databasePath);
    try {
      expect(database.prepare("SELECT count(*) FROM patients").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM visits").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM intake_observations").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM idempotency_records").pluck().get()).toBe(0);
      expect(database.prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM staff_accounts").pluck().get()).toBe(1);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'account.%'").pluck().get()).toBe(fixture.accountAuditCount);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'patient.%' OR action LIKE 'visit.%'").pluck().get()).toBe(0);
      expect(Number(fixture.accountAuditCount)).toBeGreaterThan(0);
      expect(() => database.prepare("DELETE FROM audit_events WHERE action LIKE 'account.%'").run()).toThrow("append-only");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("rejects a live host lock and wrong confirmation without changing bytes", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const beforeWhileOpen = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    const live = reset(fixture.databasePath);
    expect(live.code).toBe(1);
    expect(live.errors).toEqual(["Synthetic Pilot data reset failed"]);
    await fixture.app.close();
    fixture.database.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    const wrong = reset(fixture.databasePath, "RESET");
    expect(wrong.code).toBe(1);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(before).not.toBe("");
    expect(beforeWhileOpen).not.toBe("");
  });

  it("rejects unknown application tables byte-for-byte unchanged", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const foreign = new Database(fixture.databasePath);
    foreign.exec("CREATE TABLE unexpected_reset_table(value TEXT NOT NULL)");
    foreign.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");

    const result = reset(fixture.databasePath);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(result.code).toBe(1);
    expect(after).toBe(before);
  });

  it("rejects a tampered migration record before opening a writable reset transaction", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const tampered = new Database(fixture.databasePath);
    tampered.prepare("UPDATE __drizzle_migrations SET hash = 'evil' WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)").run();
    tampered.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");

    const result = reset(fixture.databasePath);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(result.code).toBe(1);
    expect(after).toBe(before);
  });

  it("prevents a Clinic Host from starting while the maintenance lock is held", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const lockPath = maintenanceLockPath(fixture.databasePath);
    mkdirSync(lockPath, { mode: 0o700 });
    try {
      expect(() => openDatabase(fixture.databasePath)).toThrow("synthetic maintenance");
    } finally {
      rmdirSync(lockPath);
    }
  });
});
