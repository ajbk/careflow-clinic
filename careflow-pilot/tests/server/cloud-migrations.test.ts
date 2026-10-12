import { generateTestRecoveryKey } from "./helpers/recovery-key.js";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initializeCloudDatabase } from "../../src/server/maintenance/deployment.js";
import { openDatabase } from "../../src/server/db/client.js";
import { migrateCloudDatabase } from "../../src/server/maintenance/migrations.js";
import { restoreBackup } from "../../src/server/maintenance/restore.js";
import { DirectoryBackupStore } from "../../src/server/maintenance/backup.js";

const keys = await generateTestRecoveryKey();
const publicKey = keys.publicKey;
const privateKey = keys.privateKey;
let directory: string | undefined;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; });
function fixture() {
  directory = mkdtempSync(join(tmpdir(), "careflow-migration-"));
  const path = join(directory, "clinic.sqlite"); initializeCloudDatabase(path, "synthetic-upgrade");
  const db = openDatabase(path, { environmentId: "synthetic-upgrade" });
  db.sqlite.exec("DROP TABLE backup_verifications; DELETE FROM __drizzle_migrations WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)");
  const before = db.sqlite.prepare("SELECT hash FROM __drizzle_migrations ORDER BY created_at").all(); db.close();
  const stagingDirectory = join(directory, "staging"); mkdirSync(stagingDirectory, { mode: 0o700 });
  const storeDirectory = join(directory, "store"); mkdirSync(storeDirectory, { mode: 0o700 });
  return { path, before, storeDirectory, input: { databasePath: path, environmentId: "synthetic-upgrade", publicKey, stagingDirectory, store: new DirectoryBackupStore(storeDirectory), releaseId: "test-new-release" } };
}
describe("explicit maintenance migration", () => {
  it("releases the host lock when private staging is not writable", async () => {
    const { path, input, before } = fixture();
    chmodSync(input.stagingDirectory, 0o500);
    try { await expect(migrateCloudDatabase(input)).rejects.toThrow(); }
    finally { chmodSync(input.stagingDirectory, 0o700); }
    expect(existsSync(`${path}.careflow-running`)).toBe(false);
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try { expect(db.prepare("SELECT hash FROM __drizzle_migrations ORDER BY created_at").all()).toEqual(before); }
    finally { db.close(); }
  });
  it("backs up and validates a migrated copy before changing the source, then opens without startup migration", async () => {
    const { path, input } = fixture();
    const result = await migrateCloudDatabase(input);
    expect(result.backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    const db = openDatabase(path, { environmentId: "synthetic-upgrade" });
    expect(db.sqlite.prepare("SELECT count(*) n FROM backup_verifications").get()).toEqual({ n: 0 }); db.close();
  });
  it("preserves source migrations when validation fails before apply", async () => {
    const { path, input, before } = fixture();
    await expect(migrateCloudDatabase({ ...input, beforeApply: () => { throw new Error("test interrupted before apply"); } })).rejects.toThrow("interrupted");
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try { expect(db.prepare("SELECT hash FROM __drizzle_migrations ORDER BY created_at").all()).toEqual(before); }
    finally { db.close(); }
  });
  it("restores a known pre-migration backup in quarantine only with explicit permission, then migrates it separately", async () => {
    const { input, storeDirectory } = fixture();
    const { backup } = await migrateCloudDatabase(input);
    const targetPath = join(directory!, "pre-migration-restore.sqlite");
    const request = { archivePath: join(storeDirectory, backup.objectId), receipt: backup, privateKey, targetPath, environmentId: input.environmentId, expectedDatabaseId: backup.databaseId, fencingEvidence: "TEST-OLD-WRITER-FENCED" };
    await expect(restoreBackup(request)).rejects.toThrow();
    await expect(restoreBackup({ ...request, allowPendingMigrations: true })).resolves.toMatchObject({ mode: "reconciling", requiresMigration: true });
    expect(() => openDatabase(targetPath, { environmentId: input.environmentId })).toThrow();
    await migrateCloudDatabase({ ...input, databasePath: targetPath });
    const restored = openDatabase(targetPath, { environmentId: input.environmentId });
    try { expect(restored.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='recovery_mode'").pluck().get()).toBe("reconciling"); }
    finally { restored.close(); }
  });
});
