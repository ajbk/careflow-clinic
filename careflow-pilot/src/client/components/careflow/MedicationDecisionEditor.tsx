import { Search, X } from "lucide-react";
import { useState } from "react";
import type { MedicationDecisionDraftInput, MedicationDto } from "../../../shared/contracts";
import { useMedicationSearch } from "../../features/medications";
import { ActionButton, TextAreaField } from "./ui";

type OrderItem = Extract<MedicationDecisionDraftInput, { kind: "ORDER" }>["items"][number];
type MedicationDisplay = Pick<MedicationDto, "id" | "revision" | "displayName">;
export function MedicationDecisionEditor({ value, medications = [], onChange, errors = {}, disabled = false }: { value: MedicationDecisionDraftInput; medications?: readonly MedicationDisplay[]; onChange: (value: MedicationDecisionDraftInput) => void; errors?: Record<string, string>; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  // Display metadata must survive edits without entering the strict command payload.
  const [selectedMedications, setSelectedMedications] = useState<MedicationDisplay[]>([]);
  const search = useMedicationSearch(query, value.kind === "ORDER" && !disabled);
  const items: OrderItem[] = value.kind === "ORDER" ? value.items : [];
  const displayMedications = [...selectedMedications, ...medications];
  const select = (medication: MedicationDto) => { if (items.some((item) => item.medicationId === medication.id)) return; setSelectedMedications((current) => [...current.filter((entry) => entry.id !== medication.id), { id: medication.id, revision: medication.revision, displayName: medication.displayName }]); onChange({ kind: "ORDER", items: [...items, { medicationId: medication.id, medicationRevision: medication.revision, quantity: 1, directionsTh: "" }] }); setQuery(""); };
  const update = (index: number, patch: Partial<OrderItem>) => { const next = items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item); onChange({ kind: "ORDER", items: next }); };
  return <section className="medication-editor" aria-label="Medication decision">
    <div className="decision-choice"><ActionButton type="button" variant={value.kind === "ORDER" ? "primary" : "secondary"} onClick={() => onChange({ kind: "ORDER", items })} disabled={disabled}>สั่งยาจากรายการทดสอบ</ActionButton><ActionButton type="button" variant={value.kind === "NO_MEDICATION" ? "primary" : "secondary"} onClick={() => onChange({ kind: "NO_MEDICATION", noMedicationReason: "" })} disabled={disabled}>ไม่สั่งยา</ActionButton></div>
    {value.kind === "UNDECIDED" ? <p className="field-hint">ยังบันทึกร่างได้ และต้องเลือกการตัดสินใจเรื่องยาอย่างชัดเจนก่อนลงนาม</p> : null}
    {value.kind === "NO_MEDICATION" ? <TextAreaField label="เหตุผลที่ไม่สั่งยา" value={value.noMedicationReason} onChange={(event) => onChange({ kind: "NO_MEDICATION", noMedicationReason: event.target.value })} error={errors["payload.medicationDecision.noMedicationReason"]} disabled={disabled} /> : null}
    {value.kind === "ORDER" ? <div className="medication-order"><label className="field"><span className="field-label">ค้นหารายการยา</span><div className="search-input"><Search aria-hidden="true" size={18} /><input className="care-input" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} /></div></label>{search.isError ? <p className="field-error">ค้นหารายการยาไม่ได้</p> : null}{search.data?.map((medication) => <button className="catalog-result" type="button" onClick={() => select(medication)} key={medication.id}>เลือก {medication.displayName} · {medication.strengthText}</button>)}{items.map((item, index) => <div className="medication-item" key={item.medicationId}><strong>{displayMedications.find((medication) => medication.id === item.medicationId && medication.revision === item.medicationRevision)?.displayName ?? item.medicationId}</strong><label className="field"><span className="field-label">จำนวน</span><input className="care-input" aria-label="จำนวน" type="number" min="1" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) })} disabled={disabled} /></label><TextAreaField label="วิธีใช้ยา" value={item.directionsTh} onChange={(event) => update(index, { directionsTh: event.target.value })} disabled={disabled} /><ActionButton type="button" variant="ghost" icon={X} onClick={() => onChange({ kind: "ORDER", items: items.filter((_, itemIndex) => itemIndex !== index) })} disabled={disabled}>ลบ</ActionButton></div>)}{errors["payload.medicationDecision.items"] ? <p className="field-error">{errors["payload.medicationDecision.items"]}</p> : null}</div> : null}
  </section>;
}
