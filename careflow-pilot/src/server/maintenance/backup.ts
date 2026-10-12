import { randomUUID } from "node:crypto";
import { chmodSync, constants, copyFileSync, lstatSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import type { DatabaseHandle } from "../db/client.js";
import { encryptSnapshot, sha256File, syncFile } from "./backup-crypto.js";
import { assertDatabaseIntegrity, schemaFingerprint } from "./integrity.js";
import { setOperationalMetadata } from "./metadata.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const backupManifestSchema = z.strictObject({
  version: z.literal(1), product: z.literal("careflow-pilot"), syntheticOnly: z.literal(true),
  backupId: z.string().uuid(), databaseId: z.string().uuid(), environmentId: z.string().min(3).max(64),
  generation: z.string().min(1).max(80), startedAt: z.string().datetime(), completedAt: z.string().datetime(), releaseId: z.string().min(1).max(100),
  nodeVersion: z.string(), sqliteVersion: z.string(), databaseSha256: hash, schemaSha256: hash,
  migrations: z.array(z.strictObject({ hash, created_at: z.number() })),
  evidence: z.record(z.string(), z.number().int().nonnegative()),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export const backupReceiptSchema = z.strictObject({
  objectId: z.string().regex(/^[a-f0-9-]{36}\.cfbak$/), databaseId: z.string().uuid(), environmentId: z.string(),
  sha256: hash, bytes: z.number().int().positive(), keyId: hash, verifiedAt: z.string().datetime(),
  snapshotStartedAt: z.string().datetime(), snapshotCompletedAt: z.string().datetime(), generation: z.string().min(1).max(80),
  storageKind: z.enum(["synthetic-directory", "external"]),
});
export type BackupReceipt = z.infer<typeof backupReceiptSchema>;
export interface BackupStore {
  readonly kind: "synthetic-directory" | "external";
  /** Must create a new immutable object, fail if it exists, and require no delete credential. */
  put(objectId: string, sourcePath: string): Promise<void>;
  retrieve(objectId: string, targetPath: string): Promise<void>;
  /** Durable, immutable recovery index outside the app. Must finish with read-back verification.
   * Production adapters must bound/cancel network I/O, use no overwrite/delete credentials,
   * and retain receipts with the same approved failure domain and retention as their archive. */
  publishReceipt(receipt: BackupReceipt): Promise<void>;
}
function objectName(value: string): string { return backupReceiptSchema.shape.objectId.parse(value); }
export function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new Error("Backup staging directory must be private");
}
/** Synthetic drill adapter only. A local directory is not an independent failure domain. */
export class DirectoryBackupStore implements BackupStore {
  readonly kind = "synthetic-directory" as const;
  constructor(private readonly directory: string) { assertPrivateDirectory(directory); }
  async put(objectId: string, sourcePath: string): Promise<void> {
    const target = join(this.directory, objectName(objectId));
    copyFileSync(sourcePath, target, constants.COPYFILE_EXCL); chmodSync(target, 0o600); syncFile(target);
  }
  async publishReceipt(receipt: BackupReceipt): Promise<void> {
    const validated = backupReceiptSchema.parse(receipt);
    const target = join(this.directory, `${objectName(validated.objectId)}.receipt.json`);
    const bytes = `${JSON.stringify(validated)}\n`;
    writeFileSync(target, bytes, { flag: "wx", mode: 0o600 }); syncFile(target);
    if (readFileSync(target, "utf8") !== bytes) throw new Error("Backup receipt read-back failed");
  }
  async retrieve(objectId: string, targetPath: string): Promise<void> {
    const source = join(this.directory, objectName(objectId));
    const stat = lstatSync(source); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Unsafe backup object");
    copyFileSync(source, targetPath, constants.COPYFILE_EXCL); chmodSync(targetPath, 0o600);
  }
}

export function snapshotEvidence(sqlite: Database.Database): Record<string, number> {
  const evidence = Object.fromEntries(["audit_events", "security_events", "idempotency_records", "command_cancellations", "clinical_notes", "fulfillment_dispenses", "inventory_stock_movements", "finance_payments", "visit_closures"]
    .map((table) => [table, sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number]));
  evidence.audit_high_water = sqlite.prepare("SELECT COALESCE(max(rowid),0) FROM audit_events").pluck().get() as number;
  evidence.command_high_water = sqlite.prepare("SELECT COALESCE(max(rowid),0) FROM idempotency_records").pluck().get() as number;
  return evidence;
}
const running = new WeakSet<DatabaseHandle>();
export async function createEncryptedBackup(input: {
  database: DatabaseHandle; publicKey: string; stagingDirectory: string; store: BackupStore; releaseId: string;
  /** Test seam: writes on the same connection during the SQLite backup are included consistently. */
  progress?: (progress: { totalPages: number; remainingPages: number }) => number | void;
  allowPendingMigrations?: boolean;
}): Promise<BackupReceipt> {
  if (running.has(input.database)) throw new Error("Backup already running");
  assertPrivateDirectory(input.stagingDirectory);
  const startedAt = new Date().toISOString();
  const directory = mkdtempSync(join(input.stagingDirectory, "snapshot-")); running.add(input.database);
  try {
    const snapshot = join(directory, "snapshot.sqlite");
    await input.database.sqlite.backup(snapshot, input.progress ? { progress: (progress) => input.progress?.(progress) ?? 100 } : undefined);
    chmodSync(snapshot, 0o600);
    const sqlite = new Database(snapshot, { readonly: true, fileMustExist: true });
    let manifest: BackupManifest;
    try {
      assertDatabaseIntegrity(sqlite, input.allowPendingMigrations);
      const metadata = (key: string) => sqlite.prepare("SELECT value FROM platform_metadata WHERE key = ?").pluck().get(key);
      const evidence = snapshotEvidence(sqlite);
      manifest = backupManifestSchema.parse({ version: 1, product: "careflow-pilot", syntheticOnly: true, backupId: randomUUID(),
        databaseId: metadata("database_id"), environmentId: metadata("environment_id"), generation: metadata("recovery_generation"),
        startedAt, completedAt: new Date().toISOString(), releaseId: input.releaseId, nodeVersion: process.version,
        sqliteVersion: sqlite.prepare("SELECT sqlite_version()").pluck().get(), databaseSha256: await sha256File(snapshot), schemaSha256: schemaFingerprint(sqlite),
        migrations: sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at").all(), evidence });
    } finally { sqlite.close(); }
    const archive = join(directory, "encrypted.cfbak");
    const keyId = await encryptSnapshot(snapshot, manifest, archive, input.publicKey);
    const sha256 = await sha256File(archive); const bytes = statSync(archive).size; const objectId = `${manifest.backupId}.cfbak`;
    await input.store.put(objectId, archive);
    const verifiedCopy = join(directory, "verified.cfbak"); await input.store.retrieve(objectId, verifiedCopy);
    if (statSync(verifiedCopy).size !== bytes || await sha256File(verifiedCopy) !== sha256) throw new Error("Backup storage read-back verification failed");
    const receipt = backupReceiptSchema.parse({ objectId, databaseId: manifest.databaseId, environmentId: manifest.environmentId, sha256, bytes, keyId, snapshotStartedAt: manifest.startedAt, snapshotCompletedAt: manifest.completedAt, generation: manifest.generation, verifiedAt: new Date().toISOString(), storageKind: input.store.kind });
    await input.store.publishReceipt(receipt);
    input.database.sqlite.transaction(() => {
      setOperationalMetadata(input.database.sqlite, "last_backup_receipt", JSON.stringify(receipt));
      if (input.database.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='backup_verifications'").get()) {
        input.database.sqlite.prepare("INSERT INTO backup_verifications (id, receipt_json, verified_at) VALUES (?, ?, ?)").run(manifest.backupId, JSON.stringify(receipt), receipt.verifiedAt);
      }
    }).immediate();
    return receipt;
  } finally { running.delete(input.database); rmSync(directory, { recursive: true, force: true }); }
}
