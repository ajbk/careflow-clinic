"use client";

import Link from "next/link";
import { FileSignature, LockKeyhole, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import type { ClinicalNote } from "@/lib/careflow/types";
import { PatientHeader } from "../PatientHeader";
import { ActionButton, Card, EmptyState, Field, PageHeader, SectionHeading, SelectField, TextAreaField } from "../ui";

const emptyClinical: ClinicalNote = { subjective: "", objective: "", assessment: "", plan: "", diagnosis: null };

export function ConsultationScreen({ visitId }: { visitId: string }) {
  const { state, dispatch } = useCareFlow();
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  const [clinical, setClinical] = useState<ClinicalNote>(visit?.clinical ?? emptyClinical);
  useEffect(() => setClinical(visit?.clinical ?? emptyClinical), [visit]);
  if (!visit || !patient) return <EmptyState icon={Stethoscope} title="ไม่พบข้อมูลการตรวจ" detail="กรุณากลับไปเลือกผู้ป่วยจากคิว" />;
  const signed = Boolean(visit.signedAt) || ["awaiting-dispensing", "awaiting-payment", "complete"].includes(visit.status);
  const restricted = state.role !== "doctor";
  const locked = signed || restricted;
  const change = (key: keyof ClinicalNote, value: string) => setClinical((current) => ({ ...current, [key]: value }));
  function sign() { dispatch({ type: "SIGN_VISIT", payload: { visitId, signedAt: new Date().toISOString(), clinical } }); }
  return <div className="flow-page consultation-page"><PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" description={restricted ? "หน้าจอนี้จำลองข้อจำกัดบทบาทแพทย์ ไม่ใช่ระบบความปลอดภัยจริง" : "บันทึก SOAP และลงนามเวชระเบียน"} actions={signed ? <Link className="care-button care-button-secondary" href={`/dispensing/${visitId}`}>ไปห้องยา</Link> : undefined} /><Card className="clinical-record"><PatientHeader patient={patient} status={signed ? "ลงนามแล้ว" : "กำลังตรวจ"} statusTone={signed ? "success" : "active"} />{patient.allergies.length ? <div className="allergy-alert"><strong>แจ้งเตือนการแพ้ยา</strong><span>{patient.allergies.join(", ")} — โปรดตรวจสอบก่อนสั่งยา</span></div> : null}<div className="clinical-grid"><section><SectionHeading icon={Stethoscope} title="ข้อมูลการตรวจ" description={`อาการสำคัญ: ${visit.chiefComplaint}`} /><div className="vitals-summary"><span>อุณหภูมิ <strong>{visit.vitals.temperature} °C</strong></span><span>ความดัน <strong>{visit.vitals.systolic}/{visit.vitals.diastolic}</strong></span><span>ชีพจร <strong>{visit.vitals.heartRate || "—"}</strong></span><span>SpO₂ <strong>{visit.vitals.spo2 || "—"}%</strong></span></div><div className="form-grid"><TextAreaField label="อาการและประวัติปัจจุบัน" value={clinical.subjective} disabled={locked} onChange={(event) => change("subjective", event.target.value)} /><TextAreaField label="ผลการตรวจร่างกาย" value={clinical.objective} disabled={locked} onChange={(event) => change("objective", event.target.value)} /><TextAreaField label="การประเมิน" value={clinical.assessment} disabled={locked} onChange={(event) => change("assessment", event.target.value)} /><TextAreaField label="แผนการรักษา" value={clinical.plan} disabled={locked} onChange={(event) => change("plan", event.target.value)} /></div></section><aside className="clinical-aside"><SectionHeading title="การวินิจฉัย" /><SelectField label="ICD-10" value={clinical.diagnosis?.code ?? ""} disabled={locked} onChange={(event) => { const selected = event.target.value; setClinical((current) => ({ ...current, diagnosis: selected ? { code: selected, labelTh: selected === "J06.9" ? "การติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน" : "ความดันโลหิตสูง", labelEn: selected === "J06.9" ? "Acute upper respiratory infection" : "Essential hypertension" } : null })); }}><option value="">เลือกการวินิจฉัย</option><option value="J06.9">J06.9 — การติดเชื้อทางเดินหายใจส่วนบน</option><option value="I10">I10 — ความดันโลหิตสูง</option></SelectField><div className="medication-plan"><strong>แผนยา</strong>{visit.medications.length ? visit.medications.map((medication) => <div key={medication.id}><b>{medication.nameTh}</b><span>{medication.quantityLabel}</span></div>) : <p>ยังไม่มีรายการยาในแผนการรักษา</p>}</div>{signed ? <div className="signed-note"><LockKeyhole aria-hidden="true" size={17} /> ลงนามแล้ว ข้อมูลนี้แก้ไขไม่ได้</div> : <ActionButton icon={FileSignature} disabled={restricted || !clinical.assessment.trim() || !clinical.diagnosis} onClick={sign}>ลงนามและส่งห้องยา</ActionButton>}</aside></div></Card></div>;
}
