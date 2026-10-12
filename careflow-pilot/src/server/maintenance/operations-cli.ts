import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { openDatabase } from "../db/client.js";
import { initializeCloudDatabase } from "./deployment.js";
import { backupReceiptSchema, createEncryptedBackup, DirectoryBackupStore } from "./backup.js";
import { restoreBackup } from "./restore.js";
import { approveRecovery, recoveryApprovalSchema } from "./reconciliation.js";
import { migrateCloudDatabase } from "./migrations.js";
import { operationalHealth } from "./health.js";
import { currentGeneration } from "../modules/platform/operations.js";
import { setOperationalMetadata } from "./metadata.js";

function absolute(value: string | undefined): string { if (!value || !isAbsolute(value)) throw new Error("Explicit absolute path required"); return value; }
function textFile(path: string, secret = false): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128 * 1024 ||
      (secret && process.platform !== "win32" && (stat.mode & 0o077) !== 0)) throw new Error("Unsafe operations input file");
  return readFileSync(path, "utf8");
}
export async function runOperationsCli(io: { argv: string[]; stdout: (line: string) => void; stderr: (line: string) => void }): Promise<number> {
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    const parsed = parseArgs({ args: io.argv, allowPositionals: true, strict: true, options: {
      "allow-pending-migrations": { type: "boolean", default: false },
      db: { type: "string" }, environment: { type: "string" }, confirm: { type: "string" },
      "public-key-file": { type: "string" }, "private-key-file": { type: "string" }, staging: { type: "string" },
      "synthetic-store": { type: "string" }, "release-id": { type: "string" }, "receipt-file": { type: "string" },
      archive: { type: "string" }, target: { type: "string" }, "expected-database-id": { type: "string" },
      "fencing-evidence": { type: "string" }, "approval-file": { type: "string" }, "operator-ref": { type: "string" }, "max-backup-age": { type: "string" },
    } });
    const v = parsed.values; const command = parsed.positionals[0];
    if (parsed.positionals.length !== 1 || v.confirm !== "SYNTHETIC-ONLY") throw new Error("Explicit synthetic acknowledgement required");
    const path = absolute(v.db); const environmentId = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).parse(v.environment);
    if (command === "initialize") { initializeCloudDatabase(path, environmentId); io.stdout(JSON.stringify({ status: "initialized", syntheticOnly: true })); return 0; }
    if (command === "restore" || command === "restore-drill") {
      const receipt = backupReceiptSchema.parse(JSON.parse(textFile(absolute(v["receipt-file"]))));
      const result = await restoreBackup({ archivePath: absolute(v.archive), receipt, privateKey: textFile(absolute(v["private-key-file"]), true),
        targetPath: absolute(v.target), environmentId, expectedDatabaseId: z.string().uuid().parse(v["expected-database-id"]), fencingEvidence: v["fencing-evidence"] ?? "", allowPendingMigrations: v["allow-pending-migrations"] });
      if (command === "restore-drill") {
        const operatorRef = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).parse(v["operator-ref"]);
        database = openDatabase(path, { environmentId });
        if (database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key='database_id'").pluck().get() !== receipt.databaseId || currentGeneration(database) !== result.sourceGeneration) throw new Error("Drill source identity mismatch");
        setOperationalMetadata(database.sqlite, "last_restore_drill", JSON.stringify({ verifiedAt: new Date().toISOString(), keyId: receipt.keyId, databaseId: receipt.databaseId,
          generation: currentGeneration(database), backupSha256: receipt.sha256, operatorRef }));
      }
      io.stdout(JSON.stringify(result)); return 0;
    }
    if (command === "backup" || command === "migrate") {
      const common = { publicKey: textFile(absolute(v["public-key-file"])), stagingDirectory: absolute(v.staging), store: new DirectoryBackupStore(absolute(v["synthetic-store"])), releaseId: z.string().min(1).max(100).parse(v["release-id"]) };
      const receiptPath = absolute(v["receipt-file"]);
      let receipt;
      if (command === "migrate") receipt = (await migrateCloudDatabase({ ...common, databasePath: path, environmentId })).backup;
      else { database = openDatabase(path, { environmentId }); receipt = await createEncryptedBackup({ ...common, database }); }
      writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
      io.stdout(JSON.stringify({ status: command === "backup" ? "verified-synthetic-backup" : "migrated", receipt })); return 0;
    }
    if (command !== "status" && command !== "approve-recovery") throw new Error("Unsupported operation");
    database = openDatabase(path, { environmentId });
    if (command === "approve-recovery") {
      approveRecovery(database, recoveryApprovalSchema.parse(JSON.parse(textFile(absolute(v["approval-file"])))));
      io.stdout(JSON.stringify({ status: "reconciliation-approved" }));
    } else {
      const backupMaxAgeSeconds = v["max-backup-age"] === undefined ? undefined : z.coerce.number().int().min(60).max(604800).parse(v["max-backup-age"]);
      io.stdout(JSON.stringify(operationalHealth(database, { cloud: true, backupMaxAgeSeconds }, new Date())));
    }
    return 0;
  } catch { io.stderr("CareFlow operation failed; verify explicit paths, synthetic acknowledgement, identity, locks and the operations runbook. No cloud readiness is implied."); return 1; }
  finally { database?.close(); }
}
