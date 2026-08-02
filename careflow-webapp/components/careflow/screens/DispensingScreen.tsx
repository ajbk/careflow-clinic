"use client";

import Link from "next/link";
import { CheckCircle2, PackageCheck, Pill } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import { PatientHeader } from "../PatientHeader";
import { ActionButton, Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../ui";

export function DispensingScreen({ visitId }: { visitId: string }) {
  const { state, dispatch } = useCareFlow();
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  if (!visit || !patient) return <EmptyState icon={Pill} title="ไม่พบรายการยา" detail="กรุณาเลือกผู้ป่วยจากคิว" />;
  const complete = visit.status !== "awaiting-dispensing";
  const allPrepared = visit.medications.length > 0 && visit.medications.every((item) => item.prepared);
  function confirm() { dispatch({ type: "CONFIRM_DISPENSING", payload: { visitId, dispensedAt: new Date().toISOString() } }); }
  return <div className="flow-page dispensing-page"><PageHeader eyebrow="DISPENSING" title="จัดเตรียมและจ่ายยา" description="ตรวจสอบรายการยาให้ครบก่อนยืนยันการจ่าย" actions={complete ? <Link className="care-button care-button-secondary" href={`/dispensing/${visitId}/labels`}>พิมพ์ฉลากยา</Link> : undefined} /><Card><PatientHeader patient={patient} status={complete ? "จัดยาแล้ว" : "รอจัดยา"} statusTone={complete ? "success" : "warning"} /><div className="dispensing-body"><SectionHeading icon={PackageCheck} title="รายการยาตามแผนการรักษา" description="ทำเครื่องหมายเมื่อหยิบยาและตรวจสอบแล้ว" /><div className="medication-list">{visit.medications.map((medication) => <label className={`medication-card ${medication.prepared ? "medication-ready" : ""}`} key={medication.id}><input type="checkbox" aria-label={`${medication.nameTh} จัดเตรียมแล้ว`} checked={medication.prepared} disabled={complete} onChange={() => dispatch({ type: "TOGGLE_MEDICATION_PREPARED", payload: { visitId, medicationId: medication.id } })} /><span className="medication-check"><CheckCircle2 aria-hidden="true" size={22} /></span><span className="medication-copy"><strong>{medication.nameTh} <small>{medication.strength} · {medication.form}</small></strong><span>{medication.quantityLabel}</span><em>{medication.instructionTh}</em>{medication.warning ? <i>{medication.warning}</i> : null}</span><StatusBadge tone={medication.prepared ? "success" : "neutral"}>{medication.prepared ? "ตรวจแล้ว" : "รอตรวจ"}</StatusBadge></label>)}</div><div className="dispense-footer"><p>{allPrepared ? "ตรวจยาครบทุกรายการแล้ว พร้อมยืนยันการจ่าย" : "ต้องตรวจและทำเครื่องหมายยาทุกรายการก่อนยืนยัน"}</p>{complete ? <Link className="care-button care-button-primary" href={`/dispensing/${visitId}/labels`}>ไปฉลากยา</Link> : <ActionButton icon={PackageCheck} disabled={!allPrepared} onClick={confirm}>ยืนยันการจ่ายยา</ActionButton>}</div></div></Card></div>;
}
