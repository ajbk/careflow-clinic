import { generateTestRecoveryKey } from "./helpers/recovery-key.js";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { initializeCloudDatabase } from "../../src/server/maintenance/deployment.js";
import { openDatabase } from "../../src/server/db/client.js";
import { createEncryptedBackup, DirectoryBackupStore } from "../../src/server/maintenance/backup.js";
import { restoreBackup } from "../../src/server/maintenance/restore.js";
import { currentGeneration } from "../../src/server/modules/platform/operations.js";
import { seedAccount } from "./helpers/auth.js";
import type { TestDatabase } from "./helpers/database.js";
import { createSessionService } from "../../src/server/modules/platform/sessions.js";
import { approveRecovery } from "../../src/server/maintenance/reconciliation.js";
import argon2 from "argon2";
import * as openpgp from "openpgp";

const keys = await generateTestRecoveryKey();
const publicKey = keys.publicKey;
const privateKey = keys.privateKey;
let directory: string | undefined;
let database: TestDatabase | undefined;
afterEach(() => { database?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); database = undefined; directory = undefined; });
async function setup() {
  directory = mkdtempSync(join(tmpdir(), "careflow-drill-"));
  const databasePath = join(directory, "source.sqlite");
  initializeCloudDatabase(databasePath, "synthetic-drill");
  const handle = openDatabase(databasePath, { environmentId: "synthetic-drill" });
  database = { ...handle, databasePath, cleanup: handle.close };
  const { actor } = await seedAccount(database, { mustChangePassword: false });
  const sessions = createSessionService({ database, idleMinutes: 15, absoluteHours: 8 });
  const token = sessions.issue(actor.id, new Date());
  const staging = join(directory, "staging"); mkdirSync(staging, { mode: 0o700 });
  const storePath = join(directory, "synthetic-store"); mkdirSync(storePath, { mode: 0o700 });
  const store = new DirectoryBackupStore(storePath);
  return { staging, store, storePath, token, actor };
}
describe("consistent encrypted backup and fenced restore", () => {
  it("rejects a v6 recovery key that would silently negotiate legacy CFB instead of AEAD", async () => {
    const fixture = await setup();
    const legacyPreferences = await openpgp.generateKey({ type: "curve25519", config: { v6Keys: true, aeadProtect: false }, userIDs: [{ name: "Synthetic incompatible recipient" }], format: "armored" });
    await expect(createEncryptedBackup({ database: database!, publicKey: legacyPreferences.publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "test" })).rejects.toThrow(/SEIPDv2/);
    expect(database!.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='last_backup_receipt'").get()).toBeUndefined();
  });
  it("exports a consistent snapshot through immutable storage and quarantines restored accounts/sessions", async () => {
    const fixture = await setup();
    const originalGeneration = currentGeneration(database!);
    const backup = await createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "synthetic-test-release" });
    const archivePath = join(fixture.storePath, backup.objectId);
    expect(readFileSync(archivePath).includes(Buffer.from("SQLite format 3"))).toBe(false);
    // Interoperability: the standard library reads our archive without any custom crypto decoder.
    const message = await openpgp.readMessage({ binaryMessage: readFileSync(archivePath) });
    expect(message.packets.findPacket(openpgp.enums.packet.symEncryptedIntegrityProtectedData)).toMatchObject({ version: 2, cipherAlgorithm: openpgp.enums.symmetric.aes256, aeadAlgorithm: openpgp.enums.aead.gcm });
    const decoded = await openpgp.decrypt({ message, decryptionKeys: await openpgp.readPrivateKey({ armoredKey: privateKey }), format: "binary" });
    const packed = Buffer.from(decoded.data);
    const manifestSize = packed.readUInt32BE();
    expect(JSON.parse(packed.subarray(4, 4 + manifestSize).toString())).toMatchObject({ databaseId: backup.databaseId, syntheticOnly: true });
    expect(packed.subarray(4 + manifestSize, 4 + manifestSize + 16).toString()).toBe("SQLite format 3\0");
    const targetPath = join(directory!, "restored.sqlite");
    const result = await restoreBackup({ archivePath, receipt: backup, privateKey, targetPath, environmentId: "synthetic-drill", expectedDatabaseId: backup.databaseId, fencingEvidence: "TEST-OLD-WRITER-STOPPED" });
    const restored = openDatabase(targetPath, { environmentId: "synthetic-drill" });
    try {
      expect(result.mode).toBe("reconciling");
      expect(currentGeneration(restored)).not.toBe(originalGeneration);
      expect(restored.sqlite.prepare("SELECT count(*) n FROM sessions").get()).toEqual({ n: 0 });
      expect(restored.sqlite.prepare("SELECT active FROM staff_accounts").get()).toEqual({ active: 0 });
      expect(restored.sqlite.prepare("SELECT value FROM platform_metadata WHERE key = 'recovery_mode'").pluck().get()).toBe("reconciling");
      expect(restored.sqlite.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally { restored.close(); }
    expect(database!.sqlite.prepare("SELECT active FROM staff_accounts").get()).toEqual({ active: 1 });
    expect(database!.sqlite.prepare("SELECT count(*) n FROM sessions").get()).toEqual({ n: 1 });
  });
  it("rejects tampering, a wrong private key, a mismatched environment and overwrite, preserving the source", async () => {
    const fixture = await setup();
    const receipt = await createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "test" });
    const archivePath = join(fixture.storePath, receipt.objectId);
    const input = { archivePath, receipt, privateKey, targetPath: join(directory!, "new.sqlite"), environmentId: "synthetic-drill", expectedDatabaseId: receipt.databaseId, fencingEvidence: "TEST-FENCED" };
    await expect(restoreBackup({ ...input, environmentId: "wrong-clinic" })).rejects.toThrow();
    await expect(restoreBackup({ ...input, receipt: { ...receipt, keyId: "0".repeat(64) } })).rejects.toThrow();
    await expect(restoreBackup({ ...input, targetPath: database!.databasePath })).rejects.toThrow();
    const wrongKeys = await generateTestRecoveryKey();
    await expect(restoreBackup({ ...input, privateKey: wrongKeys.privateKey })).rejects.toThrow();
    const bytes = readFileSync(archivePath); bytes[bytes.length - 25] ^= 1; writeFileSync(archivePath, bytes);
    await expect(restoreBackup(input)).rejects.toThrow();
    // A forged transport checksum still cannot pass the authenticated encryption tag.
    await expect(restoreBackup({ ...input, receipt: { ...receipt, sha256: createHash("sha256").update(bytes).digest("hex") } })).rejects.toThrow();
    expect(existsSync(input.targetPath)).toBe(false);
    expect(database!.sqlite.prepare("SELECT active FROM staff_accounts").get()).toEqual({ active: 1 });
  }, 15_000);
  it("does not report success when storage read-back differs from uploaded ciphertext", async () => {
    const fixture = await setup();
    const badStore = { kind: "synthetic-directory" as const,
      put: fixture.store.put.bind(fixture.store),
      publishReceipt: fixture.store.publishReceipt.bind(fixture.store),
      retrieve: async (_key: string, target: string) => { writeFileSync(target, "corrupted receipt"); } };
    await expect(createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store: badStore, releaseId: "test" })).rejects.toThrow(/verif/i);
    expect(database!.sqlite.prepare("SELECT value FROM platform_metadata WHERE key = 'last_backup_receipt'").get()).toBeUndefined();
  });
  it("retains a verified receipt outside the source and snapshots concurrent committed evidence consistently", async () => {
    const fixture = await setup();
    database!.sqlite.prepare("INSERT INTO platform_metadata VALUES ('synthetic-padding', ?)").run("x".repeat(1024 * 1024));
    let wrote = false;
    const receipt = await createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "test", progress: () => {
      if (!wrote) {
        wrote = true;
        database!.sqlite.transaction(() => {
          for (const id of ["snapshot-concurrent-1", "snapshot-concurrent-2"]) database!.sqlite.prepare(`INSERT INTO audit_events (id, clinic_id, actor_id, actor_role, action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json) VALUES (?, 'clinic', NULL, 'system', 'maintenance.synthetic-test', 'test', 'synthetic', 1, NULL, '2026-10-09T00:00:00.000Z', '{}')`).run(id);
        }).immediate();
      }
      return 10;
    } });
    expect(wrote).toBe(true);
    expect(JSON.parse(readFileSync(join(fixture.storePath, `${receipt.objectId}.receipt.json`), "utf8"))).toEqual(receipt);
    await expect(fixture.store.put(receipt.objectId, join(fixture.storePath, receipt.objectId))).rejects.toThrow();
    await expect(fixture.store.publishReceipt(receipt)).rejects.toThrow();
    const targetPath = join(directory!, "concurrent.sqlite");
    await restoreBackup({ archivePath: join(fixture.storePath, receipt.objectId), receipt, privateKey, targetPath, environmentId: "synthetic-drill", expectedDatabaseId: receipt.databaseId, fencingEvidence: "TEST-FENCED" });
    const restored = openDatabase(targetPath, { environmentId: "synthetic-drill" });
    try { expect(restored.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action='maintenance.synthetic-test'").pluck().get()).toBe(2); }
    finally { restored.close(); }
  });
  it("keeps the previous verified receipt when publishing the recovery index fails", async () => {
    const fixture = await setup();
    const input = { database: database!, publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "test" };
    const previous = await createEncryptedBackup(input);
    const store = { kind: fixture.store.kind, put: fixture.store.put.bind(fixture.store), retrieve: fixture.store.retrieve.bind(fixture.store), publishReceipt: async () => { throw new Error("synthetic receipt unavailable"); } };
    await expect(createEncryptedBackup({ ...input, store })).rejects.toThrow("receipt unavailable");
    expect(JSON.parse(database!.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='last_backup_receipt'").pluck().get() as string)).toEqual(previous);
    expect(database!.sqlite.prepare("SELECT count(*) FROM backup_verifications").pluck().get()).toBe(1);
    expect(existsSync(join(fixture.storePath, previous.objectId))).toBe(true);
  });
  it("can recover from the external receipt when local verification metadata cannot be committed", async () => {
    const fixture = await setup();
    let externalReceipt: Awaited<ReturnType<typeof createEncryptedBackup>> | undefined;
    const store = { kind: fixture.store.kind, put: fixture.store.put.bind(fixture.store), retrieve: fixture.store.retrieve.bind(fixture.store), publishReceipt: async (receipt: NonNullable<typeof externalReceipt>) => { await fixture.store.publishReceipt(receipt); externalReceipt = receipt; } };
    // TEMP schema affects the source writer only; it is not part of the backup.
    database!.sqlite.exec("CREATE TEMP TRIGGER fail_backup_metadata BEFORE INSERT ON platform_metadata WHEN NEW.key='last_backup_receipt' BEGIN SELECT RAISE(ABORT, 'synthetic disk full'); END");
    await expect(createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store, releaseId: "test" })).rejects.toThrow("disk full");
    expect(externalReceipt).toBeDefined();
    expect(database!.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='last_backup_receipt'").get()).toBeUndefined();
    expect(database!.sqlite.prepare("SELECT count(*) FROM backup_verifications").pluck().get()).toBe(0);
    const receipt = externalReceipt!;
    await expect(restoreBackup({ archivePath: join(fixture.storePath, receipt.objectId), receipt, privateKey, targetPath: join(directory!, "metadata-failure-restore.sqlite"), environmentId: "synthetic-drill", expectedDatabaseId: receipt.databaseId, fencingEvidence: "TEST-FENCED" })).resolves.toMatchObject({ mode: "reconciling" });
  });
  it("keeps recovery closed until fresh credentials and explicit doctor/operator reconciliation evidence", async () => {
    const fixture = await setup();
    const receipt = await createEncryptedBackup({ database: database!, publicKey, stagingDirectory: fixture.staging, store: fixture.store, releaseId: "test" });
    const targetPath = join(directory!, "recovery.sqlite");
    const result = await restoreBackup({ archivePath: join(fixture.storePath, receipt.objectId), receipt, privateKey, targetPath, environmentId: "synthetic-drill", expectedDatabaseId: receipt.databaseId, fencingEvidence: "TEST-FENCED" });
    const restored = openDatabase(targetPath, { environmentId: "synthetic-drill" });
    const approval = { restoreId: result.restoreId, generation: result.generation, operatorRef: "TEST-OPERATOR-SIGNOFF", doctorId: fixture.actor.id, doctorApprovalRef: "TEST-DOCTOR-SIGNOFF",
      clinicalRef: "TEST-CLINICAL", stockRef: "TEST-STOCK", financeRef: "TEST-FINANCE", cutoffRef: "TEST-CUTOFF", accountRef: "TEST-ROSTER",
      cutoffDisposition: "NO_UNRECORDED_EFFECTS" as const, approvedAccountIds: [fixture.actor.id] };
    try {
      expect(() => approveRecovery(restored, approval)).toThrow(/credential/i);
      expect(() => approveRecovery(restored, { ...approval, stockRef: "" })).toThrow();
      const hash = await argon2.hash("synthetic-new-password-after-restore");
      restored.sqlite.prepare("UPDATE staff_accounts SET password_hash=?, last_password_changed_at=?, revision=revision+1 WHERE id=?").run(hash, new Date().toISOString(), fixture.actor.id);
      approveRecovery(restored, approval);
      expect(restored.sqlite.prepare("SELECT active FROM staff_accounts").get()).toEqual({ active: 1 });
      expect(restored.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='recovery_mode'").pluck().get()).toBe("normal");
      expect(() => approveRecovery(restored, approval)).toThrow();
      expect(restored.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='maintenance.recovery-approved'").get()).toEqual({ n: 1 });
    } finally { restored.close(); }
  });
});
