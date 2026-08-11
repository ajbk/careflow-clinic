import { chmodSync, existsSync, lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { assertKnownPilotDatabase } from "../db/client.js";
import { maintenanceLockPath, resolveDatabaseTarget } from "../host-lock.js";

export const EXPIRE_UAT_DOCTOR_SESSION_CONFIRMATION = "EXPIRE-UAT-DOCTOR-SESSION";

const uatDatabaseFilename = "careflow-uat.sqlite";
const uatDoctorUsername = "uat-doctor";

export interface ExpireUatDoctorSessionDependencies {
  argv: readonly string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface MaintenanceLock {
  release: () => void;
}

interface DoctorSession {
  tokenHash: string;
  staffId: string;
  username: string;
  active: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(argv: readonly string[]): string {
  if (
    argv.length !== 4
    || argv[0] !== "--database"
    || argv[2] !== "--confirm"
    || argv[3] !== EXPIRE_UAT_DOCTOR_SESSION_CONFIRMATION
  ) {
    fail(`Usage: --database /absolute/path/${uatDatabaseFilename} --confirm ${EXPIRE_UAT_DOCTOR_SESSION_CONFIRMATION}`);
  }
  const databasePath = argv[1] ?? "";
  if (!databasePath || !isAbsolute(databasePath)) fail("--database must be an absolute path");
  return resolve(databasePath);
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

function assertNoHostLock(lockPath: string): void {
  if (existsSync(lockPath)) fail("CareFlow Clinic Host is running; stop it before controlled session expiry");
}

function acquireMaintenanceLock(databasePath: string): MaintenanceLock {
  const path = maintenanceLockPath(databasePath);
  try {
    mkdirSync(path, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(path, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("CareFlow controlled session expiry is already running");
    }
    throw error;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      rmdirSync(path);
      released = true;
    },
  };
}

function doctorSessions(sqlite: Database.Database): DoctorSession[] {
  return sqlite.prepare(
    `SELECT
      sessions.token_hash AS tokenHash,
      sessions.staff_id AS staffId,
      staff_accounts.username AS username,
      staff_accounts.active AS active
    FROM sessions
    INNER JOIN staff_accounts ON staff_accounts.id = sessions.staff_id
    WHERE staff_accounts.role = 'doctor'
    ORDER BY sessions.token_hash`,
  ).all() as DoctorSession[];
}

function assertPilotUatDatabase(sqlite: Database.Database): void {
  assertKnownPilotDatabase(sqlite);
  const clinic = sqlite
    .prepare("SELECT synthetic_only FROM clinic_config WHERE id = 'clinic'")
    .get() as { synthetic_only?: number } | undefined;
  if (!clinic || clinic.synthetic_only !== 1) fail("Synthetic-only clinic marker is required");
}

function singleUatDoctorSession(sqlite: Database.Database): DoctorSession {
  const candidates = doctorSessions(sqlite);
  if (candidates.length !== 1) fail("expected exactly one Doctor UAT session");
  const candidate = candidates[0];
  if (!candidate || candidate.username !== uatDoctorUsername || candidate.active !== 1) {
    fail("expected the active uat-doctor session only");
  }
  return candidate;
}

export function runExpireUatDoctorSession(deps: ExpireUatDoctorSessionDependencies): number {
  let maintenanceLock: MaintenanceLock | undefined;
  let sqlite: Database.Database | undefined;
  let transactionOpen = false;
  try {
    const inputPath = parseArguments(deps.argv);
    assertExistingRegularDatabase(inputPath);
    const target = resolveDatabaseTarget(inputPath);
    if (basename(target.databasePath) !== uatDatabaseFilename) {
      fail(`database filename must be ${uatDatabaseFilename}`);
    }
    if (!existsSync(target.databasePath)) fail("database file does not exist");
    assertSafeDatabaseArtifacts(target.databasePath);
    assertNoHostLock(target.lockPath);
    maintenanceLock = acquireMaintenanceLock(target.databasePath);
    assertNoHostLock(target.lockPath);

    // Validate all identity guards through a read-only handle. Every failed
    // guard above and here leaves the target untouched before write access.
    const readonly = new Database(target.databasePath, { readonly: true, fileMustExist: true });
    try {
      assertPilotUatDatabase(readonly);
      singleUatDoctorSession(readonly);
    } finally {
      readonly.close();
    }

    sqlite = new Database(target.databasePath, { fileMustExist: true });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    assertNoHostLock(target.lockPath);
    sqlite.exec("BEGIN EXCLUSIVE");
    transactionOpen = true;
    const doctorSession = singleUatDoctorSession(sqlite);
    const expiresAt = new Date(Date.now() - 1_000).toISOString();
    const result = sqlite
      .prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .run(expiresAt, doctorSession.tokenHash);
    if (result.changes !== 1) fail("Doctor UAT session changed during controlled expiry");
    sqlite.exec("COMMIT");
    transactionOpen = false;
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.close();
    sqlite = undefined;
    maintenanceLock.release();
    maintenanceLock = undefined;
    deps.stdout("Doctor UAT session timestamp expired");
    return 0;
  } catch {
    if (transactionOpen && sqlite) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The generic failure is the safe operator-facing result.
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
      // A leftover lock remains visible for safe local operator recovery.
    }
    deps.stderr("Doctor UAT session expiry failed");
    return 1;
  }
}
