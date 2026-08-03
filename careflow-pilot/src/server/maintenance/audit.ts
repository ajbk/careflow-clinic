import {
  maintenanceAuditCapability,
  type AppDatabase,
  type AuditedTransaction,
  type AuditAction,
  type AuditEventDetails,
} from "../modules/platform/audit.js";

export function appendMaintenanceAuditEvent<TAction extends AuditAction>(
  input: AuditEventDetails<TAction>,
): void {
  maintenanceAuditCapability.append(input);
}

export function runMaintenanceAuditedTransaction<T>(input: {
  db: AppDatabase;
  work: (tx: AuditedTransaction) => T;
}): T {
  return maintenanceAuditCapability.run(input);
}
