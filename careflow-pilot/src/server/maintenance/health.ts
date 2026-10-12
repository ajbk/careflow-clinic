import { statfsSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseHandle } from "../db/client.js";
import { backupReceiptSchema } from "./backup.js";
import { z } from "zod";

export interface HealthPolicy { cloud: boolean; backupMaxAgeSeconds?: number; minFreeBytes?: number; maxWalBytes?: number }
const integrityChecks = new WeakMap<DatabaseHandle, { at: number; healthy: boolean }>();
export function operationalHealth(database: DatabaseHandle, policy: HealthPolicy, now: Date) {
  const reasons: string[] = [];
  let walBytes = 0; let freeBytes = 0; let backupAgeSeconds: number | null = null;
  const get = (key: string) => database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key=?").pluck().get(key);
  try {
    database.sqlite.prepare("SELECT 1").get();
    const previous = integrityChecks.get(database);
    if (!previous || now.getTime() < previous.at || now.getTime() - previous.at > 60_000) {
      const healthy = previous?.healthy !== false && database.sqlite.pragma("quick_check", { simple: true }) === "ok";
      integrityChecks.set(database, { at: now.getTime(), healthy });
    }
    if (!integrityChecks.get(database)?.healthy) reasons.push("DATABASE_CHECK_FAILED");
    if (get("recovery_mode") !== "normal") reasons.push("RECOVERY_REQUIRED");
    const disk = statfsSync(dirname(database.sqlite.name)); freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (freeBytes < (policy.minFreeBytes ?? 512 * 1024 * 1024)) reasons.push("DISK_LOW");
    try { walBytes = statSync(`${database.sqlite.name}-wal`).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (walBytes > (policy.maxWalBytes ?? 256 * 1024 * 1024)) reasons.push("WAL_HIGH");
    if (policy.cloud) {
      if (!policy.backupMaxAgeSeconds) reasons.push("BACKUP_POLICY_UNSET");
      const raw = get("last_backup_receipt");
      const receipt = backupReceiptSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : undefined);
      if (!receipt.success) reasons.push("BACKUP_UNVERIFIED");
      else {
        backupAgeSeconds = Math.floor((now.getTime() - Date.parse(receipt.data.snapshotStartedAt)) / 1000);
        if (receipt.data.storageKind !== "external") reasons.push("BACKUP_FAILURE_DOMAIN_UNVERIFIED");
        if (receipt.data.databaseId !== get("database_id") || receipt.data.environmentId !== get("environment_id") || receipt.data.generation !== get("recovery_generation")) reasons.push("BACKUP_IDENTITY_MISMATCH");
        if (receipt.data.snapshotStartedAt > receipt.data.snapshotCompletedAt || receipt.data.snapshotCompletedAt > receipt.data.verifiedAt || Date.parse(receipt.data.verifiedAt) > now.getTime() || backupAgeSeconds < 0 || (policy.backupMaxAgeSeconds && backupAgeSeconds > policy.backupMaxAgeSeconds)) reasons.push("BACKUP_STALE");
      }
      const rawDrill = get("last_restore_drill");
      const drill = z.strictObject({ verifiedAt: z.string().datetime(), keyId: z.string(), databaseId: z.string(), generation: z.string(), backupSha256: z.string(), operatorRef: z.string() })
        .safeParse(typeof rawDrill === "string" ? JSON.parse(rawDrill) : undefined);
      if (!drill.success || !receipt.success || drill.data.keyId !== receipt.data.keyId || drill.data.databaseId !== get("database_id") || drill.data.generation !== get("recovery_generation")) reasons.push("RESTORE_DRILL_MISSING");
    }
  } catch { reasons.push("HEALTH_CHECK_FAILED"); }
  const critical = ["RECOVERY_REQUIRED", "DISK_LOW", "WAL_HIGH", "DATABASE_CHECK_FAILED", "HEALTH_CHECK_FAILED"];
  // A chosen backup-age policy activates its write gate. Unconfigured synthetic work is never ready.
  const writeAllowed = !reasons.some((reason) => critical.includes(reason)) && !(policy.cloud && policy.backupMaxAgeSeconds && reasons.length);
  return { ready: reasons.length === 0, writeAllowed, reasons, freeBytes, walBytes, backupAgeSeconds };
}
