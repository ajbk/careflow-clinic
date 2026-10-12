import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { initializeCloudDatabase } from "../../src/server/maintenance/deployment.js";
import { assertDatabaseIntegrity } from "../../src/server/maintenance/integrity.js";
import { openDatabase, type DatabaseHandle } from "../../src/server/db/client.js";
import { executeIdempotent } from "../../src/server/modules/platform/idempotency.js";
import { createPatientService } from "../../src/server/modules/patient/service.js";
import { seedAccount } from "./helpers/auth.js";

let directory: string | undefined;
let database: DatabaseHandle | undefined;
let child: ChildProcess | undefined;
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  database?.close(); if (directory) rmSync(directory, { recursive: true, force: true });
  child = undefined; database = undefined; directory = undefined;
});
async function fixture() {
  directory = mkdtempSync(join(tmpdir(), "careflow-process-crash-"));
  const path = join(directory, "clinic.sqlite"); initializeCloudDatabase(path, "synthetic-crash");
  database = openDatabase(path, { environmentId: "synthetic-crash" });
  const { actor } = await seedAccount({ ...database, databasePath: path, cleanup: () => undefined }, { mustChangePassword: false });
  return { path, actor };
}
describe("SQLite process death and storage exhaustion", () => {
  it.each(["before-commit", "after-commit"])("survives SIGKILL %s without separating a patient, audit and command result", async (phase) => {
    const { path, actor } = await fixture(); database!.close(); database = undefined;
    child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./helpers/crash-worker.ts", import.meta.url)), path, phase], { stdio: ["ignore", "pipe", "pipe"] });
    const worker = child;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Synthetic crash worker timed out")), 10_000);
      worker.stdout!.on("data", (bytes: Buffer) => { if (bytes.toString().includes("READY")) { clearTimeout(timer); resolve(); } });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); });
      worker.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic crash worker exited before barrier")); });
    });
    const exited = once(worker, "exit"); worker.kill("SIGKILL"); await exited;
    expect(worker.signalCode).toBe("SIGKILL");
    expect(() => openDatabase(path, { environmentId: "synthetic-crash" })).toThrow(/stale lock/);
    // Only this known-dead test worker's private lock is removed, after exit was observed.
    expect(existsSync(`${path}.careflow-running`)).toBe(true);
    rmSync(`${path}.careflow-running`, { recursive: true });
    database = openDatabase(path, { environmentId: "synthetic-crash" });
    assertDatabaseIntegrity(database.sqlite);
    const count = phase === "after-commit" ? 1 : 0;
    for (const table of ["patients", "audit_events", "idempotency_records"]) expect(database.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(count);
    const patients = createPatientService({ database });
    const replay = executeIdempotent({ db: database.db, actor, key: "synthetic-crash-command", operation: "patient.create-synthetic.v1", requestBody: { expectedRevisions: {}, payload: {} }, work: (tx) => ({ statusCode: 201, data: patients.createSyntheticPatient(tx, actor) }) });
    expect(replay.body.replayed).toBe(phase === "after-commit");
    for (const table of ["patients", "audit_events", "idempotency_records"]) expect(database.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(1);
  }, 15_000);
  it("rolls back clinical and audit writes when SQLite returns SQLITE_FULL storing command evidence", async () => {
    const { actor } = await fixture();
    const db = database!;
    const originalLimit = db.sqlite.pragma("max_page_count", { simple: true }) as number;
    const pages = db.sqlite.pragma("page_count", { simple: true }) as number;
    db.sqlite.pragma(`max_page_count=${pages + 1}`);
    const patients = createPatientService({ database: db });
    try {
      expect(() => executeIdempotent({ db: db.db, actor, key: "synthetic-disk-full", operation: "patient.create-synthetic.v1", requestBody: { expectedRevisions: {}, payload: {} }, work: (tx) => {
        patients.createSyntheticPatient(tx, actor); return { statusCode: 201, data: { syntheticPadding: "x".repeat(2 * 1024 * 1024) } };
      } })).toThrow(/database or disk is full/);
    } finally { db.sqlite.pragma(`max_page_count=${originalLimit}`); }
    for (const table of ["patients", "audit_events", "idempotency_records"]) expect(db.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    expect(db.sqlite.prepare("SELECT count(*) FROM staff_accounts").pluck().get()).toBe(1);
    assertDatabaseIntegrity(db.sqlite);
  });
});
