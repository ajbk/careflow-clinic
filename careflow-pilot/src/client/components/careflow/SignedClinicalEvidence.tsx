import type { ClinicalNoteAmendmentDto, SignedClinicalNoteDto, SignedMedicationDecisionDto } from "../../../shared/contracts";
import { formatThaiDateTime } from "../../lib/thai-date";
import { ActionButton } from "./ui";
export function SignedClinicalEvidence({ note, decision, amendments, onAmend, onRevise }: { note: SignedClinicalNoteDto; decision: SignedMedicationDecisionDto; amendments: ClinicalNoteAmendmentDto[]; onAmend?: () => void; onRevise?: () => void }) {
  return <section className="signed-evidence" aria-label="หลักฐานลงนาม">
    <h2>หลักฐานที่ลงนามแล้ว</h2>
    <section className="signed-evidence-record" aria-label="หลักฐาน Clinical Note ที่ลงนาม">
      <h3>Clinical Note ที่ลงนาม</h3>
      <p>ผู้ลงนาม {note.signedBy.displayName}</p>
      <time dateTime={note.signedAt}>{formatThaiDateTime(note.signedAt)}</time>
      <p>เวอร์ชัน {note.version}</p>
      <code aria-label="แฮช Clinical Note">{note.contentHash}</code>
    </section>
    <section className="signed-evidence-record" aria-label="หลักฐานการตัดสินใจยา ที่ลงนาม">
      <h3>การตัดสินใจยา ที่ลงนาม</h3>
      <p>การตัดสินใจยา: {decision.kind === "ORDER" ? "สั่งยา" : "ไม่สั่งยา"}</p>
      <p>ผู้ลงนาม {decision.signedBy.displayName}</p>
      <time dateTime={decision.signedAt}>{formatThaiDateTime(decision.signedAt)}</time>
      <p>เวอร์ชัน {decision.version}</p>
      <code aria-label="แฮชการตัดสินใจยา">{decision.contentHash}</code>
    </section>
    {amendments.map((amendment) => <p key={amendment.id}>คำแก้ไข v{amendment.version}: {amendment.reason}</p>)}
    <div className="decision-choice">{onAmend ? <ActionButton type="button" variant="secondary" onClick={onAmend}>เพิ่มคำแก้ไข</ActionButton> : null}{onRevise ? <ActionButton type="button" variant="secondary" onClick={onRevise}>แก้ไขการตัดสินใจยา</ActionButton> : null}</div>
  </section>;
}
