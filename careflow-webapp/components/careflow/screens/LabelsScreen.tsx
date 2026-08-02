"use client";

import Link from "next/link";
import { Printer, Tags } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import { ActionButton, EmptyState, PageHeader } from "../ui";

const timingLabels = {
  morning: "☀ เช้า",
  noon: "◐ กลางวัน",
  evening: "◒ เย็น",
  bedtime: "☾ ก่อนนอน",
  meal: "◉ หลังอาหาร",
  symptom: "● เมื่อมีอาการ",
};

export function LabelsScreen({ visitId }: { visitId: string }) {
  const { state } = useCareFlow();
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  if (!visit || !patient) return <EmptyState icon={Tags} title="ไม่พบข้อมูลฉลาก" detail="กรุณาเลือกผู้ป่วยจากคิว" />;
  return <div className="flow-page labels-page"><PageHeader eyebrow="MEDICATION LABELS" title="ฉลากยา" description="ตรวจสอบชื่อยาและคำแนะนำก่อนพิมพ์" actions={<><ActionButton icon={Printer} onClick={() => window.print()}>พิมพ์ฉลาก</ActionButton><Link className="care-button care-button-secondary" href={`/checkout/${visitId}`}>ไปจุดชำระเงิน</Link></>} /><div className="label-sheet print-area">{visit.medications.map((medication) => <article className="medicine-label" key={medication.id}><header><strong>CareFlow Clinic</strong><span>ฉลากยา</span></header><h2>{medication.nameTh}</h2><p>{medication.name} · {medication.strength} · {medication.form}</p><dl><div><dt>ผู้ป่วย</dt><dd>{patient.name} · HN {patient.hn}</dd></div><div><dt>จำนวน</dt><dd>{medication.quantityLabel}</dd></div><div><dt>วิธีใช้</dt><dd>{medication.instructionTh}</dd></div><div><dt>ช่วงเวลา</dt><dd className="dose-symbols">{medication.timing.map((time) => <span key={time}>{timingLabels[time]}</span>)}</dd></div></dl>{medication.warning ? <footer>คำเตือน: {medication.warning}</footer> : null}</article>)}</div></div>;
}
