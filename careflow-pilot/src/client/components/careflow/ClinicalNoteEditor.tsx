import { Plus, X } from "lucide-react";
import type { ClinicalNoteDraftInput } from "../../../shared/contracts";
import { ActionButton, TextAreaField } from "./ui";

export function ClinicalNoteEditor({ value, onChange, errors = {}, disabled = false }: { value: ClinicalNoteDraftInput; onChange: (next: ClinicalNoteDraftInput) => void; errors?: Record<string, string>; disabled?: boolean }) {
  const update = (key: Exclude<keyof ClinicalNoteDraftInput, "diagnoses">, text: string) => onChange({ ...value, [key]: text });
  const addDiagnosis = () => onChange({ ...value, diagnoses: [...value.diagnoses, ""] });
  return <section className="clinical-editor" aria-label="Clinical Note editor">
    <TextAreaField label="Subjective (ข้อมูลจากผู้ป่วย)" value={value.subjective} onChange={(event) => update("subjective", event.target.value)} error={errors["payload.note.subjective"]} disabled={disabled} />
    <TextAreaField label="Objective (ผลตรวจ)" value={value.objective} onChange={(event) => update("objective", event.target.value)} error={errors["payload.note.objective"]} disabled={disabled} />
    <TextAreaField label="Assessment (การประเมิน)" value={value.assessment} onChange={(event) => update("assessment", event.target.value)} error={errors["payload.note.assessment"]} disabled={disabled} />
    <TextAreaField label="Plan (แผนการดูแล)" value={value.plan} onChange={(event) => update("plan", event.target.value)} error={errors["payload.note.plan"]} disabled={disabled} />
    <div className="diagnosis-editor"><span className="field-label">การวินิจฉัย</span>{value.diagnoses.map((diagnosis, index) => <div className="diagnosis-row" key={index}><input className="care-input" aria-label={index === 0 ? "การวินิจฉัย" : `การวินิจฉัย ${index + 1}`} value={diagnosis} onChange={(event) => { const diagnoses = [...value.diagnoses]; diagnoses[index] = event.target.value; onChange({ ...value, diagnoses }); }} disabled={disabled} /><ActionButton type="button" variant="ghost" aria-label={`ลบการวินิจฉัย ${index + 1}`} onClick={() => onChange({ ...value, diagnoses: value.diagnoses.filter((_, itemIndex) => itemIndex !== index) })} disabled={disabled} icon={X}>ลบ</ActionButton></div>)}<ActionButton type="button" variant="secondary" onClick={addDiagnosis} disabled={disabled || value.diagnoses.length >= 20} icon={Plus}>เพิ่มการวินิจฉัย</ActionButton>{errors["payload.note.diagnoses"] ? <p className="field-error">{errors["payload.note.diagnoses"]}</p> : null}</div>
  </section>;
}
