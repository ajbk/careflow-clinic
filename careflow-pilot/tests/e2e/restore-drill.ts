import { generateTestRecoveryKey } from "../server/helpers/recovery-key.js";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { openDatabase, type DatabaseHandle } from "../../src/server/db/client.js";
import { createEncryptedBackup, DirectoryBackupStore } from "../../src/server/maintenance/backup.js";
import { restoreBackup } from "../../src/server/maintenance/restore.js";
import { assertDatabaseIntegrity } from "../../src/server/maintenance/integrity.js";

/** A nonempty browser-created clinical/stock/payment chain must survive encryption and restore. */
export async function verifyCompletedClinicRestore(source: DatabaseHandle): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "careflow-clinic-drill-"));
  const keys = await generateTestRecoveryKey();
  const staging = join(directory, "staging"); const storePath = join(directory, "store");
  mkdirSync(staging, { mode: 0o700 }); mkdirSync(storePath, { mode: 0o700 });
  const tables = ["clinical_notes", "medication_decisions", "fulfillment_dispenses", "fulfillment_dispense_lines", "inventory_stock_movements", "finance_charges", "finance_payments", "visit_closures", "idempotency_records"];
  const evidence = (db: DatabaseHandle) => Object.fromEntries(tables.map((table) => [table, db.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  try {
    const before = evidence(source);
    const receipt = await createEncryptedBackup({ database: source, publicKey: keys.publicKey, stagingDirectory: staging, store: new DirectoryBackupStore(storePath), releaseId: "synthetic-browser-drill" });
    const targetPath = join(directory, "restored.sqlite");
    await restoreBackup({ archivePath: join(storePath, receipt.objectId), receipt, privateKey: keys.privateKey, targetPath, environmentId: receipt.environmentId, expectedDatabaseId: receipt.databaseId, fencingEvidence: "ISOLATED-SYNTHETIC-DRILL-NO-INGRESS" });
    const restored = openDatabase(targetPath, { environmentId: receipt.environmentId });
    try {
      assertDatabaseIntegrity(restored.sqlite);
      expect(evidence(restored)).toEqual(before);
      expect(restored.sqlite.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
      expect(restored.sqlite.prepare("SELECT count(*) FROM staff_accounts WHERE active=1").pluck().get()).toBe(0);
      expect(restored.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='recovery_mode'").pluck().get()).toBe("reconciling");
    } finally { restored.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
