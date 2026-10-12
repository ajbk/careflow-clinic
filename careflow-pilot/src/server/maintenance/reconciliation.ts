import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseHandle } from "../db/client.js";
import { assertDatabaseIntegrity } from "./integrity.js";
import { setOperationalMetadata } from "./metadata.js";

const evidenceRef = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/);
export const recoveryApprovalSchema = z.strictObject({
  restoreId: z.string().uuid(), generation: z.string().min(1).max(80), operatorRef: evidenceRef,
  doctorId: z.string().min(1).max(128), doctorApprovalRef: evidenceRef,
  clinicalRef: evidenceRef, stockRef: evidenceRef, financeRef: evidenceRef, cutoffRef: evidenceRef, accountRef: evidenceRef,
  // Unrecorded physical events need a separately approved correction workflow before reopening.
  cutoffDisposition: z.literal("NO_UNRECORDED_EFFECTS"),
  approvedAccountIds: z.array(z.string().min(1).max(128)).min(1).max(20),
});
export type RecoveryApproval = z.infer<typeof recoveryApprovalSchema>;

/** Offline operator action. References identify separately retained doctor/operator attestations.
 * Never infers roster validity or replays medication, stock or financial events. */
export function approveRecovery(database: DatabaseHandle, approval: RecoveryApproval): void {
  const input = recoveryApprovalSchema.parse(approval);
  if (new Set(input.approvedAccountIds).size !== input.approvedAccountIds.length || input.operatorRef === input.doctorApprovalRef) throw new Error("Separate approvals and unique account roster required");
  database.sqlite.transaction(() => {
    const get = (key: string) => database.sqlite.prepare("SELECT value FROM platform_metadata WHERE key=?").pluck().get(key);
    if (get("recovery_mode") !== "reconciling" || get("recovery_generation") !== input.generation) throw new Error("Recovery approval is stale or not required");
    const restored = z.object({ restoreId: z.string(), restoredAt: z.string().datetime(), sourceGeneration: z.string() }).parse(JSON.parse(String(get("recovery_manifest"))));
    if (restored.restoreId !== input.restoreId) throw new Error("Recovery identity mismatch");
    const baseline = z.array(z.strictObject({ id: z.string(), credentialFingerprint: z.string() })).parse(JSON.parse(String(get("recovery_quarantine"))));
    let approvedDoctor = false;
    for (const id of input.approvedAccountIds) {
      const account = database.sqlite.prepare("SELECT role, password_hash, last_password_changed_at FROM staff_accounts WHERE id=?").get(id) as { role: string; password_hash: string; last_password_changed_at: string } | undefined;
      if (!account || !account.password_hash.startsWith("$argon2id$") || account.last_password_changed_at < restored.restoredAt ||
          baseline.find((row) => row.id === id)?.credentialFingerprint === createHash("sha256").update(account.password_hash).digest("hex")) throw new Error("Fresh reviewed credentials required for every approved account");
      if (id === input.doctorId && account.role === "doctor") approvedDoctor = true;
    }
    if (!approvedDoctor) throw new Error("Doctor approval must identify an approved doctor account");
    assertDatabaseIntegrity(database.sqlite);
    const approvedAt = new Date().toISOString();
    database.sqlite.prepare("UPDATE staff_accounts SET active=0, disabled_at=COALESCE(disabled_at, ?), revision=revision+1, updated_at=?").run(approvedAt, approvedAt);
    for (const id of input.approvedAccountIds) database.sqlite.prepare("UPDATE staff_accounts SET active=1, disabled_at=NULL, must_change_password=1 WHERE id=?").run(id);
    database.sqlite.exec("DELETE FROM sessions");
    setOperationalMetadata(database.sqlite, "recovery_approval", JSON.stringify({ ...input, sourceGeneration: restored.sourceGeneration, approvedAt }));
    setOperationalMetadata(database.sqlite, "recovery_mode", "normal");
    database.sqlite.prepare(`INSERT INTO audit_events (id, clinic_id, actor_id, actor_role, action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json)
      VALUES (?, 'clinic', NULL, 'system', 'maintenance.recovery-approved', 'recovery', ?, 1, NULL, ?, ?)`)
      .run(randomUUID(), input.restoreId, approvedAt, JSON.stringify(input));
  }).immediate();
}
