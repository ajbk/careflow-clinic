import type { DatabaseHandle } from "../db/client.js";
import type { BackupReceipt } from "./backup.js";
import { setOperationalMetadata } from "./metadata.js";

export interface OperationalAlert { code: "BACKUP_FAILED"; occurredAt: string }
/** One process owns the SQLite connection and the schedule; close waits for the current snapshot. */
export function createBackupCoordinator(input: {
  database: DatabaseHandle; intervalSeconds: number; run: () => Promise<BackupReceipt>;
  alert: (event: OperationalAlert) => Promise<void>;
}) {
  if (!Number.isSafeInteger(input.intervalSeconds) || input.intervalSeconds < 60) throw new Error("Backup interval must be at least 60 seconds");
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: Promise<void> | undefined; let stopped = false;
  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (current) return current;
    current = (async () => {
      try { await input.run(); }
      catch {
        const event: OperationalAlert = { code: "BACKUP_FAILED", occurredAt: new Date().toISOString() };
        try { setOperationalMetadata(input.database.sqlite, "last_backup_failure", JSON.stringify(event)); } catch { /* Alert still runs on disk failure. */ }
        try { await input.alert(event); } catch { /* Provider adapter failure cannot expose raw errors or crash the host. */ }
      }
    })().finally(() => { current = undefined; });
    return current;
  };
  return { runNow,
    start(): void { if (timer || stopped) return; timer = setInterval(() => { void runNow(); }, input.intervalSeconds * 1000); timer.unref(); void runNow(); },
    async stop(): Promise<void> { stopped = true; if (timer) clearInterval(timer); await current; },
  };
}
