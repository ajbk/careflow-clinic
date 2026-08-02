"use client";

import Link from "next/link";
import { Clock3, UsersRound } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectPatient, selectQueueColumns } from "@/lib/careflow/selectors";
import type { Visit } from "@/lib/careflow/types";
import { ActionButton, EmptyState, PageHeader, StatusBadge } from "../ui";

function statusFor(visit: Visit) {
  if (visit.status === "consulting") return { label: "กำลังตรวจ", tone: "active" as const };
  if (visit.status === "waiting") return { label: "รอตรวจ", tone: "waiting" as const };
  if (visit.status === "awaiting-dispensing") return { label: "รอรับยา", tone: "warning" as const };
  if (visit.status === "awaiting-payment") return { label: "รอชำระเงิน", tone: "info" as const };
  return { label: "เสร็จสิ้น", tone: "success" as const };
}

export function QueueScreen() {
  const { state, dispatch } = useCareFlow();
  const columns = selectQueueColumns(state);
  const renderVisit = (visit: Visit) => {
    const patient = selectPatient(state, visit.patientId);
    if (!patient) return null;
    const status = statusFor(visit);
    return <article className="queue-card" key={visit.id}>
      <div className="queue-card-top"><span className="queue-time"><Clock3 aria-hidden="true" size={15} /> {new Date(visit.arrivedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      <strong>{patient.name}</strong><span>HN {patient.hn} · {patient.age} ปี</span><p>{visit.chiefComplaint}</p>
      {visit.status === "waiting" ? <ActionButton className="queue-action" variant="secondary" onClick={() => dispatch({ type: "START_CONSULTATION", payload: { visitId: visit.id, startedAt: new Date().toISOString() } })}>เริ่มการตรวจ</ActionButton> : null}
      {visit.status === "consulting" ? <Link className="queue-link" href={`/consultations/${visit.id}`}>เปิดห้องตรวจ</Link> : null}
      {visit.status === "awaiting-dispensing" ? <Link className="queue-link" href={`/dispensing/${visit.id}`}>ไปห้องยา</Link> : null}
      {visit.status === "awaiting-payment" ? <Link className="queue-link" href={`/checkout/${visit.id}`}>รับชำระเงิน</Link> : null}
    </article>;
  };
  const groups = [{ title: "รอพบแพทย์", detail: `${columns.waiting.length} ราย`, items: columns.waiting, tone: "waiting" }, { title: "กำลังตรวจ", detail: `${columns.inProgress.length} ราย`, items: columns.inProgress, tone: "active" }, { title: "ดำเนินการต่อ", detail: `${columns.completed.length} ราย`, items: columns.completed, tone: "success" }];
  return <div className="flow-page"><PageHeader eyebrow="LIVE QUEUE" title="คิวผู้ป่วย" description="ติดตามเส้นทางการดูแลผู้ป่วยในวันนี้" actions={<Link className="care-button care-button-primary" href="/intake">รับผู้ป่วยใหม่</Link>} /><div className="queue-board">{groups.map((group) => <section className={`queue-column queue-column-${group.tone}`} key={group.title}><header><div><h2>{group.title}</h2><p>{group.detail}</p></div><UsersRound aria-hidden="true" size={20} /></header><div className="queue-stack">{group.items.length ? group.items.map(renderVisit) : <EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วย" detail="รายการใหม่จะแสดงที่นี่" />}</div></section>)}</div></div>;
}
