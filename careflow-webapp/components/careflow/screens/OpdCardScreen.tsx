"use client";

import { Printer, ShieldCheck } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import { EmptyState, PageHeader, ActionButton } from "../ui";
import { RoleRestrictedCard } from "../RoleRestrictedCard";

export function OpdCardScreen({ visitId }: { visitId: string }) {
  const { state } = useCareFlow();
  if (state.role !== "doctor") return <RoleRestrictedCard title="OPD Card" />;
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  if (!visit || !patient) return <EmptyState icon={ShieldCheck} title="ไม่พบ OPD Card" detail="กรุณาเลือกการรับบริการที่ต้องการ" />;
  return <div className="flow-page opd-page"><PageHeader eyebrow="PRINTABLE OPD CARD" title="OPD Card" description="เอกสารสรุปการรับบริการที่ลงนามแล้ว" actions={<ActionButton icon={Printer} onClick={() => window.print()}>พิมพ์ OPD Card</ActionButton>} /><article className="opd-card print-area"><header><div><strong>CareFlow Rural Clinic</strong><span>บัตรผู้ป่วยนอก / Outpatient Department Card</span></div><ShieldCheck aria-hidden="true" size={38} /></header><section className="opd-patient"><div><span>ชื่อผู้ป่วย</span><strong>{patient.name}</strong></div><div><span>HN</span><strong>{patient.hn}</strong></div><div><span>อายุ / เพศ</span><strong>{patient.age} ปี / {patient.gender}</strong></div><div><span>วันที่รับบริการ</span><strong>{new Date(visit.arrivedAt).toLocaleDateString("th-TH")}</strong></div></section><section><h2>อาการสำคัญ</h2><p>{visit.chiefComplaint}</p></section><section className="opd-soap"><div><h2>Subjective</h2><p>{visit.clinical.subjective || "—"}</p></div><div><h2>Objective</h2><p>{visit.clinical.objective || "—"}</p></div><div><h2>Assessment</h2><p>{visit.clinical.assessment || "—"}</p></div><div><h2>Plan</h2><p>{visit.clinical.plan || "—"}</p></div></section><section><h2>การวินิจฉัย</h2><p>{visit.clinical.diagnosis ? `${visit.clinical.diagnosis.code} — ${visit.clinical.diagnosis.labelTh}` : "—"}</p></section><section><h2>รายการยา</h2><ul>{visit.medications.map((medication) => <li key={medication.id}>{medication.nameTh} {medication.strength} — {medication.quantityLabel}</li>)}</ul></section><footer><span>ลงนามโดย {visit.doctorName ?? "แพทย์ประจำคลินิก"}</span><span>{visit.signedAt ? new Date(visit.signedAt).toLocaleString("th-TH") : "รอการลงนาม"}</span></footer></article></div>;
}
