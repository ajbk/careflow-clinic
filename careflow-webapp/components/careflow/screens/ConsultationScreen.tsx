"use client";

import Link from "next/link";
import { FileSignature, LockKeyhole, Pill, Plus, Stethoscope } from "lucide-react";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import type { ClinicalNote } from "@/lib/careflow/types";
import { PatientHeader } from "../PatientHeader";
import { RoleRestrictedCard } from "../RoleRestrictedCard";
import { ActionButton, Card, EmptyState, Field, PageHeader, SectionHeading, SelectField, TextAreaField } from "../ui";

const emptyClinical: ClinicalNote = { subjective: "", objective: "", assessment: "", plan: "", diagnosis: null };

function thaiDate(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

export function ConsultationScreen({ visitId }: { visitId: string }) {
  const { state, dispatch } = useCareFlow();
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  const [clinical, setClinical] = useState<ClinicalNote>(() => visit?.clinical ?? emptyClinical);
  const [inventoryId, setInventoryId] = useState("");
  const [quantity, setQuantity] = useState("1");

  if (state.role !== "doctor") return <RoleRestrictedCard title="ห้องตรวจ" />;
  if (!visit || !patient) return <EmptyState icon={Stethoscope} title="ไม่พบข้อมูลการตรวจ" detail="กรุณากลับไปเลือกผู้ป่วยจากคิว" />;

  const signed = Boolean(visit.signedAt) || ["awaiting-dispensing", "awaiting-payment", "complete"].includes(visit.status);
  const recentVisits = state.visits
    .filter((item) => item.patientId === patient.id && item.id !== visit.id)
    .sort((left, right) => right.arrivedAt.localeCompare(left.arrivedAt))
    .slice(0, 3);
  const change = (key: keyof ClinicalNote, value: string) => setClinical((current) => ({ ...current, [key]: value }));
  const addPrescription = () => {
    if (!inventoryId) return;
    dispatch({ type: "ADD_PRESCRIPTION", payload: { visitId, inventoryId, quantity: Number(quantity) } });
    setInventoryId("");
    setQuantity("1");
  };
  const sign = () => dispatch({ type: "SIGN_VISIT", payload: { visitId, signedAt: new Date().toISOString(), clinical } });

  return (
    <div className="flow-page consultation-page">
      <PageHeader
        eyebrow="DOCTOR WORKSPACE"
        title="ห้องตรวจ"
        description="บันทึก SOAP วางแผนยา และลงนามเวชระเบียน"
        actions={signed ? <Link className="care-button care-button-secondary" href={`/dispensing/${visitId}`}>ไปห้องยา</Link> : undefined}
      />
      <Card className="clinical-record">
        <PatientHeader patient={patient} status={signed ? "ลงนามแล้ว" : "กำลังตรวจ"} statusTone={signed ? "success" : "active"} />
        {patient.allergies.length ? <div className="allergy-alert"><strong>แจ้งเตือนการแพ้ยา</strong><span>{patient.allergies.join(", ")} — โปรดตรวจสอบก่อนสั่งยา</span></div> : null}
        <div className="clinical-grid">
          <section>
            <SectionHeading icon={Stethoscope} title="ข้อมูลการตรวจ" description={`อาการสำคัญ: ${visit.chiefComplaint}`} />
            <div className="vitals-summary">
              <span>อุณหภูมิ <strong>{visit.vitals.temperature} °C</strong></span>
              <span>ความดัน <strong>{visit.vitals.systolic}/{visit.vitals.diastolic}</strong></span>
              <span>ชีพจร <strong>{visit.vitals.heartRate || "—"}</strong></span>
              <span>SpO₂ <strong>{visit.vitals.spo2 || "—"}%</strong></span>
            </div>
            <div className="form-grid">
              <TextAreaField label="อาการและประวัติปัจจุบัน" value={clinical.subjective} disabled={signed} onChange={(event) => change("subjective", event.target.value)} />
              <TextAreaField label="ผลการตรวจร่างกาย" value={clinical.objective} disabled={signed} onChange={(event) => change("objective", event.target.value)} />
              <TextAreaField label="การประเมิน" value={clinical.assessment} disabled={signed} onChange={(event) => change("assessment", event.target.value)} />
              <TextAreaField label="แผนการรักษา" value={clinical.plan} disabled={signed} onChange={(event) => change("plan", event.target.value)} />
            </div>
          </section>
          <aside className="clinical-aside">
            <SectionHeading title="การวินิจฉัย" />
            <SelectField label="ICD-10" value={clinical.diagnosis?.code ?? ""} disabled={signed} onChange={(event) => {
              const code = event.target.value;
              setClinical((current) => ({ ...current, diagnosis: code ? { code, labelTh: code === "J06.9" ? "การติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน" : "ความดันโลหิตสูง", labelEn: code === "J06.9" ? "Acute upper respiratory infection" : "Essential hypertension" } : null }));
            }}>
              <option value="">เลือกการวินิจฉัย</option>
              <option value="J06.9">J06.9 — การติดเชื้อทางเดินหายใจส่วนบน</option>
              <option value="I10">I10 — ความดันโลหิตสูง</option>
            </SelectField>
            <div className="medication-plan">
              <strong><Pill aria-hidden="true" size={16} /> แผนยา</strong>
              {visit.medications.length ? visit.medications.map((medication) => <div key={medication.id}><b>{medication.nameTh}</b><span>{medication.quantityLabel}</span></div>) : <p>ยังไม่มีรายการยาในแผนการรักษา</p>}
            </div>
            {!signed ? <div className="prescription-form">
              <SelectField label="เพิ่มยาเข้ารายการ" value={inventoryId} onChange={(event) => setInventoryId(event.target.value)}>
                <option value="">เลือกยาในคลัง</option>
                {state.inventory.filter((item) => item.stock > 0).map((item) => <option value={item.id} key={item.id}>{item.nameTh} {item.strength} — คงเหลือ {item.stock}</option>)}
              </SelectField>
              <Field label="จำนวน" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
              <ActionButton variant="secondary" icon={Plus} disabled={!inventoryId || Number(quantity) <= 0} onClick={addPrescription}>เพิ่มยา</ActionButton>
            </div> : null}
            <section className="recent-visits" aria-label="ประวัติการรับบริการล่าสุด">
              <strong>การรับบริการล่าสุด</strong>
              {recentVisits.length ? recentVisits.map((item) => <span key={item.id}>{thaiDate(item.arrivedAt)} · {item.chiefComplaint}</span>) : <span>ยังไม่มีประวัติก่อนหน้านี้ในข้อมูลตัวอย่าง</span>}
            </section>
            {signed ? <div className="signed-note"><LockKeyhole aria-hidden="true" size={17} /> ลงนามแล้ว ข้อมูลนี้แก้ไขไม่ได้</div> : <ActionButton icon={FileSignature} disabled={!clinical.assessment.trim() || !clinical.diagnosis} onClick={sign}>ลงนามและส่งห้องยา</ActionButton>}
          </aside>
        </div>
      </Card>
    </div>
  );
}
