import { chmodSync, existsSync, lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { resolveDatabaseTarget } from "../host-lock.js";

export const RESET_CONFIRMATION = "RESET-SYNTHETIC-PILOT";
export const MAINTENANCE_LOCK_SUFFIX = ".careflow-maintenance";

const expectedTables = new Set([
  "__drizzle_migrations",
  "audit_events",
  "clinic_config",
  "clinic_counters",
  "idempotency_records",
  "intake_observations",
  "patients",
  "platform_metadata",
  "sessions",
  "staff_accounts",
  "visits",
]);

const triggerSql = {
  update: `CREATE TRIGGER audit_events_block_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END`,
  delete: `CREATE TRIGGER audit_events_block_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END`,
} as const;

export interface ResetSyntheticDependencies {
  argv: readonly string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface MaintenanceLock {
  path: string;
  release: () => void;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertSafeDatabaseArtifacts(databasePath: string): void {
  for (const artifact of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      const stat = lstatSync(artifact);
      if (stat.isSymbolicLink()) fail("database artifacts must not be symbolic links");
      if (!stat.isFile()) fail("database artifacts must be regular files");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertExistingRegularDatabase(inputPath: string): void {
  try {
    const stat = lstatSync(inputPath);
    if (stat.isSymbolicLink()) fail("database target must not be a symbolic link");
    if (!stat.isFile()) fail("database target must be a file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("database file does not exist");
    throw error;
  }
}

function acquireMaintenanceLock(databasePath: string): MaintenanceLock {
  const path = `${databasePath}${MAINTENANCE_LOCK_SUFFIX}`;
  try {
    mkdirSync(path, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(path, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("CareFlow synthetic reset is already running");
    }
    throw error;
  }
  let released = false;
  return {
    path,
    release: () => {
      if (released) return;
      rmdirSync(path);
      released = true;
    },
  };
}

function assertNoHostLock(lockPath: string): void {
  if (existsSync(lockPath)) fail("CareFlow Clinic Host is running; stop it before reset");
}

function listApplicationTables(sqlite: Database.Database): string[] {
  return sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
}

function assertPilotIdentity(sqlite: Database.Database): void {
  const applicationId = sqlite.pragma("application_id", { simple: true });
  if (applicationId !== 0x43464c57) fail("Existing database is not a CareFlow Pilot database");
  const productId = sqlite
    .prepare("SELECT value FROM platform_metadata WHERE key = 'product_id'")
    .pluck()
    .get();
  const migrationCount = sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get();
  if (productId !== "careflow-pilot" || Number(migrationCount) !== 3) {
    fail("Existing database is not a CareFlow Pilot database");
  }
  const tables = listApplicationTables(sqlite);
  if (tables.some((name) => !expectedTables.has(name)) || tables.length !== expectedTables.size) {
    fail("Database contains unknown application tables");
  }
  const clinic = sqlite
    .prepare("SELECT synthetic_only FROM clinic_config WHERE id = 'clinic'")
    .get() as { synthetic_only?: number } | undefined;
  if (!clinic || clinic.synthetic_only !== 1) {
    fail("Synthetic-only clinic marker is required");
  }
}

function assertForeignKeys(sqlite: Database.Database): void {
  const errors = sqlite.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) fail("foreign_key_check failed after synthetic reset");
}

function restoreAuditTriggers(sqlite: Database.Database): void {
  sqlite.exec(triggerSql.update);
  sqlite.exec(triggerSql.delete);
}

function verifyReset(sqlite: Database.Database): void {
  const targets = [
    ["sessions", "count(*)"],
    ["idempotency_records", "count(*)"],
    ["intake_observations", "count(*)"],
    ["visits", "count(*)"],
    ["patients", "count(*)"],
  ] as const;
  for (const [table, expression] of targets) {
    const count = sqlite.prepare(`SELECT ${expression} AS count FROM ${table}`).get() as { count: number };
    if (Number(count.count) !== 0) fail(`Synthetic reset left rows in ${table}`);
  }
  const counter = sqlite
    .prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'")
    .pluck()
    .get();
  if (Number(counter) !== 0) fail("Synthetic patient counter was not reset");
  const triggerNames = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_events_block_%' ORDER BY name")
    .pluck()
    .all() as string[];
  if (triggerNames.join(",") !== "audit_events_block_delete,audit_events_block_update") {
    fail("Audit append-only triggers were not restored");
  }
  assertForeignKeys(sqlite);
  const freelist = Number(sqlite.pragma("freelist_count", { simple: true }));
  if (freelist !== 0) fail("SQLite VACUUM did not reclaim all free pages");
}

function parseArguments(argv: readonly string[]): string {
  if (argv.length !== 4 || argv[0] !== "--database" || argv[2] !== "--confirm" || argv[3] !== RESET_CONFIRMATION) {
    fail(`Usage: --database /absolute/path/careflow.sqlite --confirm ${RESET_CONFIRMATION}`);
  }
  const databasePath = argv[1] ?? "";
  if (!databasePath || !isAbsolute(databasePath)) fail("--database must be an absolute path");
  return resolve(databasePath);
}

export function runResetSyntheticData(deps: ResetSyntheticDependencies): number {
  let maintenanceLock: MaintenanceLock | undefined;
  let sqlite: Database.Database | undefined;
  let transactionOpen = false;
  try {
    const inputPath = parseArguments(deps.argv);
    assertExistingRegularDatabase(inputPath);
    const target = resolveDatabaseTarget(inputPath);
    if (!existsSync(target.databasePath)) fail("database file does not exist");
    assertSafeDatabaseArtifacts(target.databasePath);
    assertNoHostLock(target.lockPath);
    maintenanceLock = acquireMaintenanceLock(target.databasePath);
    assertNoHostLock(target.lockPath);

    // Read-only validation ensures all fail-closed identity guards leave the
    // file byte-for-byte untouched before any writable handle is opened.
    const readonly = new Database(target.databasePath, { readonly: true, fileMustExist: true });
    try {
      assertPilotIdentity(readonly);
    } finally {
      readonly.close();
    }

    sqlite = new Database(target.databasePath, { fileMustExist: true });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("secure_delete = ON");
    assertNoHostLock(target.lockPath);
    sqlite.exec("BEGIN EXCLUSIVE");
    transactionOpen = true;
    sqlite.exec("DROP TRIGGER IF EXISTS audit_events_block_update; DROP TRIGGER IF EXISTS audit_events_block_delete;");
    sqlite.exec("DELETE FROM sessions;");
    sqlite.exec("DELETE FROM idempotency_records;");
    sqlite.exec("DELETE FROM intake_observations;");
    sqlite.exec("DELETE FROM visits;");
    sqlite.exec("DELETE FROM patients;");
    sqlite.exec("DELETE FROM audit_events WHERE action LIKE 'patient.%' OR action LIKE 'visit.%';");
    sqlite.exec("UPDATE clinic_counters SET value = 0 WHERE key = 'synthetic_patient';");
    restoreAuditTriggers(sqlite);
    sqlite.exec("COMMIT");
    transactionOpen = false;

    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.exec("VACUUM");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    verifyReset(sqlite);
    sqlite.close();
    sqlite = undefined;
    maintenanceLock.release();
    maintenanceLock = undefined;
    deps.stdout("Synthetic Pilot data reset complete");
    return 0;
  } catch {
    if (transactionOpen && sqlite) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The original error is the actionable CLI result.
      }
    }
    try {
      sqlite?.close();
    } catch {
      // Keep the command non-zero if physical cleanup itself failed.
    }
    try {
      maintenanceLock?.release();
    } catch {
      // A leftover lock is intentionally visible for safe operator recovery.
    }
    deps.stderr("Synthetic Pilot data reset failed");
    return 1;
  }
}

// Exported for tests/documentation without exposing mutable internals.
export const syntheticResetTriggerSql = Object.freeze({ ...triggerSql });
