"use client";

import Link from "next/link";
import { Activity, CalendarDays, ClipboardList, UserRound } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectPatient } from "@/lib/careflow/selectors";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../ui";

const statusLabel: Record<string, string> = { waiting: "รอตรวจ", consulting: "กำลังตรวจ", "awaiting-dispensing": "รอรับยา", "awaiting-payment": "รอชำระเงิน", complete: "เสร็จสิ้น" };

export function PatientHistoryScreen({ patientId }: { patientId: string }) {
  const { state } = useCareFlow();
  const patient = selectPatient(state, patientId);
  if (!patient) return <EmptyState icon={UserRound} title="ไม่พบข้อมูลผู้ป่วย" detail="กรุณาค้นหาจากเลข HN หรือรายชื่อ" />;
  const visits = state.visits.filter((visit) => visit.patientId === patientId).sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
  const latest = visits[0];
  return <div className="flow-page history-page"><PageHeader eyebrow="LONGITUDINAL RECORD" title="เวชระเบียนผู้ป่วย" description="ข้อมูลการดูแลต่อเนื่องและการรับบริการที่ผ่านมา" actions={latest ? <Link className="care-button care-button-secondary" href={`/consultations/${latest.id}`}>เปิดรายการล่าสุด</Link> : undefined} /><div className="history-grid"><Card className="profile-card"><SectionHeading icon={UserRound} title="ข้อมูลผู้ป่วย" /><strong className="profile-name">{patient.name}</strong><span>HN {patient.hn}</span><dl><div><dt>อายุ</dt><dd>{patient.age} ปี</dd></div><div><dt>เพศ</dt><dd>{patient.gender}</dd></div><div><dt>โทรศัพท์</dt><dd>{patient.phone}</dd></div><div><dt>ผู้ติดต่อ</dt><dd>{patient.contactName ?? "ไม่ระบุ"}</dd></div></dl>{patient.allergies.length ? <div className="allergy-alert compact"><strong>แพ้ยา</strong><span>{patient.allergies.join(", ")}</span></div> : <StatusBadge tone="success">ไม่มีประวัติแพ้ยาที่บันทึกไว้</StatusBadge>}</Card><div className="history-main"><Card><SectionHeading icon={Activity} title="แนวโน้มน้ำหนัก" description="จากข้อมูลการรับบริการล่าสุด" /><div className="weight-trend"><span>62 กก.</span><svg viewBox="0 0 360 90" role="img" aria-label="แนวโน้มน้ำหนักคงที่"><polyline points="8,55 75,47 145,52 218,35 285,40 352,28" fill="none" stroke="#003629" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="352" cy="28" r="5" fill="#003629" /></svg><small>62 กก. ในการรับบริการล่าสุด</small></div></Card><Card><SectionHeading icon={ClipboardList} title="ไทม์ไลน์การรักษา" description={`${visits.length} รายการรับบริการ`} /><div className="visit-timeline">{visits.map((visit) => <article key={visit.id}><span className="timeline-dot" /><div><header><strong>{new Date(visit.arrivedAt).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}</strong><StatusBadge tone={visit.status === "complete" ? "success" : "info"}>{statusLabel[visit.status]}</StatusBadge></header><p>{visit.chiefComplaint}</p>{visit.clinical.diagnosis ? <small>{visit.clinical.diagnosis.code} — {visit.clinical.diagnosis.labelTh}</small> : null}</div></article>)}</div></Card></div></div></div>;
}
