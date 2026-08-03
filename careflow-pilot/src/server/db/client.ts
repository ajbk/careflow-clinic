import { chmodSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { acquireHostLock } from "../host-lock.js";
import * as schema from "./schema.js";

const CAREFLOW_APPLICATION_ID = 0x43464c57;
const CAREFLOW_PRODUCT_ID = "careflow-pilot";

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  close: () => void;
}

interface MigrationRecord {
  hash: string;
  created_at: number;
}

function migrationFolder(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "drizzle"),
    resolve(moduleDirectory, "../../../drizzle"),
    resolve(moduleDirectory, "../../drizzle"),
  ];
  return candidates.find((path) => existsSync(resolve(path, "meta/_journal.json"))) ?? candidates[0];
}

function assertKnownIdentity(
  sqlite: Database.Database,
  migrationsPath: string,
  allowPendingMigrations: boolean,
): void {
  try {
    const applicationId = sqlite.pragma("application_id", { simple: true });
    if (applicationId !== CAREFLOW_APPLICATION_ID) throw new Error("identity mismatch");

    const productId = sqlite
      .prepare("SELECT value FROM platform_metadata WHERE key = 'product_id'")
      .pluck()
      .get();
    if (productId !== CAREFLOW_PRODUCT_ID) throw new Error("product mismatch");

    const applied = sqlite
      .prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC, id ASC")
      .all() as MigrationRecord[];
    const known = readMigrationFiles({ migrationsFolder: migrationsPath });
    if (applied.length === 0 || applied.length > known.length) throw new Error("migration mismatch");
    if (!allowPendingMigrations && applied.length !== known.length) {
      throw new Error("pending migration");
    }
    for (const [index, migration] of applied.entries()) {
      if (
        migration.hash !== known[index]?.hash ||
        Number(migration.created_at) !== known[index]?.folderMillis
      ) {
        throw new Error("migration mismatch");
      }
    }
  } catch {
    throw new Error("Existing database is not a CareFlow Pilot database");
  }
}

function validateExistingFileReadOnly(databasePath: string, migrationsPath: string): void {
  let readonlyDatabase: Database.Database | undefined;
  try {
    readonlyDatabase = new Database(databasePath, { readonly: true, fileMustExist: true });
    assertKnownIdentity(readonlyDatabase, migrationsPath, true);
  } catch {
    throw new Error("Existing database is not a CareFlow Pilot database");
  } finally {
    readonlyDatabase?.close();
  }
}

function secureDatabaseArtifacts(databasePath: string): void {
  if (process.platform === "win32") return;
  for (const artifact of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(artifact)) chmodSync(artifact, 0o600);
  }
}

export function openDatabase(inputPath: string): DatabaseHandle {
  const lock = acquireHostLock(inputPath);
  const migrationsPath = migrationFolder();
  const existingNonEmpty = existsSync(lock.databasePath) && statSync(lock.databasePath).size > 0;
  let sqlite: Database.Database | undefined;

  try {
    if (existingNonEmpty) validateExistingFileReadOnly(lock.databasePath, migrationsPath);

    sqlite = new Database(lock.databasePath);
    secureDatabaseArtifacts(lock.databasePath);
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = FULL");
    sqlite.pragma("busy_timeout = 5000");

    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: migrationsPath });
    assertKnownIdentity(sqlite, migrationsPath, false);
    secureDatabaseArtifacts(lock.databasePath);

    let closed = false;
    return {
      sqlite,
      db,
      close: () => {
        if (closed) return;
        try {
          sqlite?.close();
          secureDatabaseArtifacts(lock.databasePath);
        } finally {
          lock.release();
          closed = true;
        }
      },
    };
  } catch (error) {
    try {
      sqlite?.close();
      secureDatabaseArtifacts(lock.databasePath);
    } finally {
      lock.release();
    }
    throw error;
  }
}
