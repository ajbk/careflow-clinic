import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrationFolder } from "../db/client.js";
import { backupManifestSchema, backupReceiptSchema, snapshotEvidence, assertPrivateDirectory, type BackupReceipt } from "./backup.js";
import { decryptSnapshot, sha256File, syncFile } from "./backup-crypto.js";
import { assertDatabaseIntegrity, schemaFingerprint } from "./integrity.js";
import { writeDeploymentRecord } from "./deployment.js";
import { setOperationalMetadata } from "./metadata.js";

export async function restoreBackup(input: {
  archivePath: string; receipt: BackupReceipt; privateKey: string; targetPath: string; environmentId: string;
  expectedDatabaseId: string; fencingEvidence: string;
  /** Only known schema prefixes are accepted; startup stays closed until a separate migration. */
  allowPendingMigrations?: boolean;
}) {
  const receipt = backupReceiptSchema.parse(input.receipt);
  if (!isAbsolute(input.targetPath) || !/^[A-Za-z0-9._:-]{8,160}$/.test(input.fencingEvidence) ||
      [input.targetPath, `${input.targetPath}-wal`, `${input.targetPath}-shm`, `${input.targetPath}.deployment.json`, `${input.targetPath}.careflow-running`, `${input.targetPath}.careflow-maintenance`].some(existsSync)) throw new Error("Restore requires an unused isolated target and recorded old-writer fencing evidence");
  assertPrivateDirectory(dirname(input.targetPath));
  if (receipt.environmentId !== input.environmentId || receipt.databaseId !== input.expectedDatabaseId ||
      statSync(input.archivePath).size !== receipt.bytes || await sha256File(input.archivePath) !== receipt.sha256) throw new Error("Backup receipt verification failed");
  const directory = mkdtempSync(join(dirname(input.targetPath), ".restore-"));
  try {
    const snapshot = join(directory, "restored.sqlite");
    const manifest = backupManifestSchema.parse(await decryptSnapshot(input.archivePath, input.privateKey, join(directory, "decrypted.pack"), snapshot, receipt.keyId));
    if (manifest.databaseId !== input.expectedDatabaseId || manifest.environmentId !== input.environmentId ||
        `${manifest.backupId}.cfbak` !== receipt.objectId || manifest.startedAt !== receipt.snapshotStartedAt || manifest.completedAt !== receipt.snapshotCompletedAt || manifest.generation !== receipt.generation || manifest.databaseSha256 !== await sha256File(snapshot)) throw new Error("Backup manifest verification failed");
    const sqlite = new Database(snapshot, { fileMustExist: true });
    const generation = randomUUID(); const restoreId = randomUUID(); const restoredAt = new Date().toISOString();
    try {
      sqlite.pragma("foreign_keys = ON"); sqlite.pragma("synchronous = FULL");
      assertDatabaseIntegrity(sqlite, input.allowPendingMigrations);
      const migrations = sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all();
      if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations) || JSON.stringify(snapshotEvidence(sqlite)) !== JSON.stringify(manifest.evidence)) throw new Error("Snapshot evidence manifest mismatch");
      const get = (key: string) => sqlite.prepare("SELECT value FROM platform_metadata WHERE key = ?").pluck().get(key);
      if (schemaFingerprint(sqlite) !== manifest.schemaSha256 || get("environment_id") !== manifest.environmentId || get("database_id") !== manifest.databaseId || get("recovery_generation") !== manifest.generation) throw new Error("Snapshot identity verification failed");
      const accounts = sqlite.prepare("SELECT id, password_hash FROM staff_accounts").all() as { id: string; password_hash: string }[];
      const quarantine = accounts.map((account) => ({ id: account.id, credentialFingerprint: createHash("sha256").update(account.password_hash).digest("hex") }));
      sqlite.transaction(() => {
        sqlite.exec("DELETE FROM sessions; DELETE FROM auth_rate_limits;");
        sqlite.prepare("UPDATE staff_accounts SET active=0, disabled_at=?, must_change_password=1, revision=revision+1, updated_at=?").run(restoredAt, restoredAt);
        setOperationalMetadata(sqlite, "recovery_generation", generation); setOperationalMetadata(sqlite, "recovery_mode", "reconciling");
        setOperationalMetadata(sqlite, "recovery_quarantine", JSON.stringify(quarantine));
        setOperationalMetadata(sqlite, "recovery_manifest", JSON.stringify({ restoreId, restoredAt, sourceGeneration: manifest.generation, generation, sourceCompletedAt: manifest.completedAt, receipt, fencingEvidence: input.fencingEvidence }));
        sqlite.prepare("DELETE FROM platform_metadata WHERE key IN ('last_backup_receipt','recovery_approval','last_restore_drill')").run();
        sqlite.prepare(`INSERT INTO audit_events (id, clinic_id, actor_id, actor_role, action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json)
          VALUES (?, 'clinic', NULL, 'system', 'maintenance.restored', 'recovery', ?, 1, NULL, ?, ?)`)
          .run(randomUUID(), restoreId, restoredAt, JSON.stringify({ generation, backupSha256: receipt.sha256, fencingEvidence: input.fencingEvidence }));
      }).immediate();
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
    } finally { sqlite.close(); }
    syncFile(snapshot);
    copyFileSync(snapshot, input.targetPath, constants.COPYFILE_EXCL); syncFile(input.targetPath);
    writeDeploymentRecord(input.targetPath, { version: 1, environmentId: input.environmentId, databaseId: input.expectedDatabaseId, generation });
    return { restoreId, generation, sourceGeneration: manifest.generation, mode: "reconciling" as const, sourceCompletedAt: manifest.completedAt, requiresMigration: manifest.migrations.length !== readMigrationFiles({ migrationsFolder: migrationFolder() }).length };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
