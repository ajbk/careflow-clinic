import { useRef, useState } from "react";
import type { AllergyAssessmentDto, ReviewAllergyPayload } from "../../../shared/contracts";
import { allergySeverityLabelTh, allergyStateLabelTh } from "../../features/allergy";
import { ActionButton, SelectField, TextAreaField } from "./ui";

type AllergyItemInput = ReviewAllergyPayload["items"][number];
type EditableAllergyItem = AllergyItemInput & { key: string };

function initialItems(allergy: AllergyAssessmentDto): EditableAllergyItem[] {
  if (allergy.items.length > 0) return allergy.items.map((item, index) => ({ ...item, key: `existing-${index}` }));
  return [{ key: "new-0", substance: "", reaction: "", severity: "UNKNOWN", note: null }];
}

export function AllergyReviewDialog({ allergy, onClose, onSave, pending, error, blocked = false, onReload, reloadPending = false }: {
  allergy: AllergyAssessmentDto;
  onClose: () => void;
  onSave: (value: ReviewAllergyPayload) => void;
  pending: boolean;
  error?: string;
  blocked?: boolean;
  onReload?: () => void;
  reloadPending?: boolean;
}) {
  const [state, setState] = useState<ReviewAllergyPayload["state"]>(allergy.state);
  const [sourceText, setSourceText] = useState(allergy.sourceText ?? "ทบทวนข้อมูลแพ้ยา");
  const [reason, setReason] = useState(allergy.reason ?? "ทบทวนก่อนการรักษา");
  const [items, setItems] = useState<EditableAllergyItem[]>(() => initialItems(allergy));
  const nextItemId = useRef(Math.max(allergy.items.length, 1));
  const updateItem = (key: string, patch: Partial<AllergyItemInput>) => setItems((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  const addItem = () => {
    const key = `new-${nextItemId.current}`;
    nextItemId.current += 1;
    setItems((current) => [...current, { key, substance: "", reaction: "", severity: "UNKNOWN", note: null }]);
  };
  const removeItem = (key: string) => setItems((current) => current.filter((item) => item.key !== key));
  const validItems = state !== "PRESENT" || (items.length >= 1 && items.length <= 20 && items.every((item) => item.substance.trim().length > 0 && item.reaction.trim().length > 0));
  const canSubmit = !pending && !blocked && sourceText.trim().length > 0 && reason.trim().length > 0 && validItems;
  const submit = () => {
    if (!canSubmit) return;
    onSave({
      visitId: "",
      state,
      sourceText,
      reason,
      items: state === "PRESENT" ? items.map((item) => ({ substance: item.substance, reaction: item.reaction, severity: item.severity, note: item.note?.trim() ? item.note : null })) : [],
    });
  };
  return <div className="dialog-backdrop" role="presentation"><section className="care-card allergy-dialog" role="dialog" aria-modal="true" aria-label="ทบทวนประวัติแพ้ยา"><h2>ทบทวนประวัติแพ้ยา</h2><div className="decision-choice">{(["UNKNOWN", "NONE_KNOWN", "PRESENT"] as const).map((option) => <ActionButton type="button" key={option} variant={state === option ? "primary" : "secondary"} onClick={() => setState(option)} disabled={pending || reloadPending}>{allergyStateLabelTh(option)}</ActionButton>)}</div>{state === "PRESENT" ? <div className="allergy-items">{items.map((item, index) => <section className="allergy-item-editor" aria-label={`รายการแพ้ ${index + 1}`} key={item.key}><div className="allergy-item-heading"><strong>รายการแพ้ {index + 1}</strong><ActionButton type="button" variant="ghost" aria-label={`ลบรายการแพ้ ${index + 1}`} onClick={() => removeItem(item.key)} disabled={pending || reloadPending || items.length <= 1}>ลบรายการ</ActionButton></div><label className="field"><span className="field-label">สารที่แพ้</span><input className="care-input" value={item.substance} onChange={(event) => updateItem(item.key, { substance: event.target.value })} disabled={pending || reloadPending} /></label><label className="field"><span className="field-label">อาการแพ้</span><input className="care-input" value={item.reaction} onChange={(event) => updateItem(item.key, { reaction: event.target.value })} disabled={pending || reloadPending} /></label><SelectField label="ความรุนแรง" value={item.severity} onChange={(event) => updateItem(item.key, { severity: event.target.value as AllergyItemInput["severity"] })} disabled={pending || reloadPending}>{(["UNKNOWN", "MILD", "MODERATE", "SEVERE"] as const).map((severity) => <option key={severity} value={severity}>{allergySeverityLabelTh(severity)}</option>)}</SelectField><TextAreaField label="หมายเหตุ" value={item.note ?? ""} onChange={(event) => updateItem(item.key, { note: event.target.value })} disabled={pending || reloadPending} /></section>)}<ActionButton type="button" variant="secondary" onClick={addItem} disabled={pending || reloadPending || items.length >= 20}>เพิ่มรายการแพ้</ActionButton></div> : null}<TextAreaField label="แหล่งข้อมูล" value={sourceText} onChange={(event) => setSourceText(event.target.value)} disabled={pending || reloadPending} /><TextAreaField label="เหตุผลการทบทวน" value={reason} onChange={(event) => setReason(event.target.value)} disabled={pending || reloadPending} />{error ? <p className="field-error" role="alert">{error}</p> : null}{blocked && onReload ? <div className="conflict-alert"><span>ต้องโหลดข้อมูลล่าสุดก่อนบันทึกอีกครั้ง</span><ActionButton type="button" variant="secondary" onClick={onReload} disabled={reloadPending}>{reloadPending ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</ActionButton></div> : null}<div className="dialog-actions"><ActionButton type="button" variant="secondary" onClick={onClose} disabled={pending || reloadPending}>ยกเลิก</ActionButton><ActionButton type="button" onClick={submit} disabled={!canSubmit}>{pending ? "กำลังบันทึก…" : "บันทึกการทบทวน"}</ActionButton></div></section></div>;
}
