import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { assertKnownPilotDatabase, migrationFolder, type DatabaseHandle } from "../db/client.js";
import { assertDeploymentIdentity } from "../db/deployment-identity.js";
import { acquireHostLock } from "../host-lock.js";
import * as schema from "../db/schema.js";
import { assertPrivateDirectory, createEncryptedBackup, type BackupStore } from "./backup.js";
import { assertDatabaseIntegrity } from "./integrity.js";

/** No automatic rollback of committed business data. Failure preserves the source and backup. */
export async function migrateCloudDatabase(input: {
  databasePath: string; environmentId: string; publicKey: string; stagingDirectory: string; store: BackupStore; releaseId: string;
  beforeApply?: () => void;
}) {
  if (!existsSync(input.databasePath)) throw new Error("Migration source missing");
  assertPrivateDirectory(input.stagingDirectory);
  const lock = acquireHostLock(input.databasePath);
  let directory: string | undefined;
  let sqlite: Database.Database | undefined;
  try {
    directory = mkdtempSync(join(input.stagingDirectory, "migration-"));
    const preflight = new Database(lock.databasePath, { readonly: true, fileMustExist: true });
    try { assertKnownPilotDatabase(preflight, true); assertDeploymentIdentity(lock.databasePath, preflight, input.environmentId); }
    finally { preflight.close(); }
    sqlite = new Database(lock.databasePath, { fileMustExist: true });
    sqlite.pragma("foreign_keys=ON"); sqlite.pragma("synchronous=FULL"); sqlite.pragma("busy_timeout=5000");
    const database: DatabaseHandle = { sqlite, db: drizzle(sqlite, { schema }), close: () => undefined };
    const backup = await createEncryptedBackup({ ...input, database, allowPendingMigrations: true });
    const testPath = join(directory, "migration-copy.sqlite"); await sqlite.backup(testPath);
    const copy = new Database(testPath, { fileMustExist: true });
    try { copy.pragma("foreign_keys=ON"); migrate(drizzle(copy), { migrationsFolder: migrationFolder() }); assertDatabaseIntegrity(copy); }
    finally { copy.close(); }
    input.beforeApply?.();
    // Drizzle applies all pending SQL in one transaction; validating the copy happened first.
    migrate(database.db, { migrationsFolder: migrationFolder() });
    sqlite.exec("DELETE FROM sessions");
    assertDatabaseIntegrity(sqlite); sqlite.pragma("wal_checkpoint(TRUNCATE)");
    return { backup, status: "migrated" as const };
  } finally {
    try { sqlite?.close(); }
    finally {
      try { if (directory) rmSync(directory, { recursive: true, force: true }); }
      finally { lock.release(); }
    }
  }
}
