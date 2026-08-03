import { useRef, useState } from "react";
import type { SignedDecisionInput, SignedMedicationDecisionDto } from "../../../shared/contracts";
import { createCommandAttempt, type CommandAttempt } from "../../lib/idempotency";
import { MedicationDecisionEditor } from "./MedicationDecisionEditor";
import { ActionButton, TextAreaField } from "./ui";

function fromSigned(decision: SignedMedicationDecisionDto): SignedDecisionInput {
  return decision.kind === "ORDER"
    ? { kind: "ORDER", items: decision.items.map((item) => ({ medicationId: item.id, medicationRevision: item.revision, quantity: item.quantity, directionsTh: item.directionsTh })) }
    : { kind: "NO_MEDICATION", noMedicationReason: decision.noMedicationReason };
}

export function MedicationDecisionRevisionDialog({ decision, expectedRevisions, pending, error, onCancel, onSubmit }: { decision: SignedMedicationDecisionDto; expectedRevisions: { visit: number; patient: number; medicationDecision: number }; pending: boolean; error?: string; onCancel: () => void; onSubmit: (attempt: CommandAttempt<{ revisionReason: string; decision: SignedDecisionInput }, { visit: number; patient: number; medicationDecision: number }>) => void }) {
  const [next, setNext] = useState<SignedDecisionInput>(fromSigned(decision));
  const [reason, setReason] = useState("");
  const attempt = useRef<CommandAttempt<{ revisionReason: string; decision: SignedDecisionInput }, { visit: number; patient: number; medicationDecision: number }> | null>(null);
  const reset = () => { attempt.current = null; };
  const valid = reason.trim().length > 0 && (next.kind === "NO_MEDICATION" ? next.noMedicationReason.trim().length > 0 : next.items.length > 0 && next.items.every((item) => item.quantity >= 1 && item.directionsTh.trim().length > 0));
  return <div className="dialog-backdrop"><section className="care-card sign-dialog" role="dialog" aria-modal="true" aria-label="แก้ไขการตัดสินใจยา"><h2>แก้ไขการตัดสินใจยา</h2><MedicationDecisionEditor value={next} onChange={(value) => { setNext(value as SignedDecisionInput); reset(); }} disabled={pending} /><TextAreaField label="เหตุผล" value={reason} onChange={(event) => { setReason(event.target.value); reset(); }} disabled={pending} />{error ? <p className="field-error" role="alert">{error}</p> : null}<div className="dialog-actions"><ActionButton type="button" variant="secondary" onClick={onCancel} disabled={pending}>ยกเลิก</ActionButton><ActionButton type="button" onClick={() => { if (!valid) return; attempt.current ??= createCommandAttempt(expectedRevisions, { revisionReason: reason, decision: next }); onSubmit(attempt.current); }} disabled={pending || !valid}>{pending ? "กำลังลงนาม…" : "ลงนาม"}</ActionButton></div></section></div>;
}
