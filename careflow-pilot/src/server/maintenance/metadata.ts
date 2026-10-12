import type Database from "better-sqlite3";

export type OperationalMetadataKey = "last_backup_receipt" | "last_backup_failure" | "last_restore_drill" | "recovery_generation" | "recovery_mode" | "recovery_manifest" | "recovery_quarantine" | "recovery_approval";
/** Preserve the existing protected INSERT guard: update known keys explicitly under a write lock. */
export function setOperationalMetadata(sqlite: Database.Database, key: OperationalMetadataKey, value: string): void {
  sqlite.transaction(() => {
    if (sqlite.prepare("UPDATE platform_metadata SET value=? WHERE key=?").run(value, key).changes === 0) {
      sqlite.prepare("INSERT INTO platform_metadata (key, value) VALUES (?, ?)").run(key, value);
    }
  }).immediate();
}
