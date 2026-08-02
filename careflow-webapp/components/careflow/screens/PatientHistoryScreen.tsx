"use client";

import Link from "next/link";
import { Activity, ClipboardList, UserRound } from "lucide-react";
import type { CSSProperties } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectPatient } from "@/lib/careflow/selectors";
import type { Visit } from "@/lib/careflow/types";
import { RoleRestrictedCard } from "../RoleRestrictedCard";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../ui";

const statusLabel: Record<string, string> = { waiting: "รอตรวจ", consulting: "กำลังตรวจ", "awaiting-dispensing": "รอรับยา", "awaiting-payment": "รอชำระเงิน", complete: "เสร็จสิ้น" };

function thaiDate(value: string) {
  return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function visitSummary(visit: Visit) {
  const medicationNames = visit.medications.map((medication) => medication.nameTh).join(", ");
  return `น้ำหนัก ${visit.vitals.weight || "—"} กก. · ความดัน ${visit.vitals.systolic}/${visit.vitals.diastolic}${medicationNames ? ` · ยา: ${medicationNames}` : ""}`;
}

export function PatientHistoryScreen({ patientId }: { patientId: string }) {
  const { state } = useCareFlow();
  if (state.role !== "doctor") return <RoleRestrictedCard title="เวชระเบียนผู้ป่วย" />;
  const patient = selectPatient(state, patientId);
  if (!patient) return <EmptyState icon={UserRound} title="ไม่พบข้อมูลผู้ป่วย" detail="กรุณาค้นหาจากเลข HN หรือรายชื่อ" />;
  const visits = state.visits.filter((visit) => visit.patientId === patientId).sort((left, right) => right.arrivedAt.localeCompare(left.arrivedAt));
  const latest = visits[0];
  const weightVisits = [...visits].reverse().filter((visit) => visit.vitals.weight > 0);
  const latestWeight = weightVisits.at(-1)?.vitals.weight;
  const minWeight = Math.min(...weightVisits.map((visit) => visit.vitals.weight));
  const maxWeight = Math.max(...weightVisits.map((visit) => visit.vitals.weight));
  const weightRange = Math.max(maxWeight - minWeight, 1);

  return (
    <div className="flow-page history-page">
      <PageHeader eyebrow="LONGITUDINAL RECORD" title="เวชระเบียนผู้ป่วย" description="ข้อมูลการดูแลต่อเนื่องและการรับบริการที่ผ่านมา" actions={latest ? <Link className="care-button care-button-secondary" href={`/consultations/${latest.id}`}>เปิดรายการล่าสุด</Link> : undefined} />
      <div className="history-grid">
        <Card className="profile-card">
          <SectionHeading icon={UserRound} title="ข้อมูลผู้ป่วย" />
          <strong className="profile-name">{patient.name}</strong><span>HN {patient.hn}</span>
          <dl><div><dt>อายุ</dt><dd>{patient.age} ปี</dd></div><div><dt>เพศ</dt><dd>{patient.gender}</dd></div><div><dt>โทรศัพท์</dt><dd>{patient.phone}</dd></div><div><dt>ผู้ติดต่อ</dt><dd>{patient.contactName ?? "ไม่ระบุ"}</dd></div></dl>
          {patient.allergies.length ? <div className="allergy-alert compact"><strong>แพ้ยา</strong><span>{patient.allergies.join(", ")}</span></div> : <StatusBadge tone="success">ไม่มีประวัติแพ้ยาที่บันทึกไว้</StatusBadge>}
        </Card>
        <div className="history-main">
          <Card>
            <SectionHeading icon={Activity} title="แนวโน้มน้ำหนัก" description="อ้างอิงจากสัญญาณชีพในแต่ละครั้ง" />
            <div className="weight-trend">
              <span>{latestWeight ?? "—"}{latestWeight ? " กก." : ""}</span>
              {weightVisits.length ? <div className="weight-bars" aria-label="แนวโน้มน้ำหนักจากการรับบริการ">{weightVisits.map((visit) => <span title={`${thaiDate(visit.arrivedAt)} ${visit.vitals.weight} กก.`} key={visit.id} style={{ "--weight-height": `${30 + ((visit.vitals.weight - minWeight) / weightRange) * 70}%` } as CSSProperties} />)}</div> : <p className="empty-detail">ยังไม่มีข้อมูลน้ำหนักในประวัติการรักษา</p>}
              <small>{weightVisits.length ? `บันทึกจาก ${weightVisits.length} การรับบริการล่าสุด` : ""}</small>
            </div>
          </Card>
          <Card>
            <SectionHeading icon={ClipboardList} title="สรุปการรับบริการ" description={`${visits.length} รายการรับบริการ`} />
            <div className="visit-timeline">{visits.map((visit) => <article key={visit.id}><span className="timeline-dot" /><div><header><strong>{thaiDate(visit.arrivedAt)}</strong><StatusBadge tone={visit.status === "complete" ? "success" : "info"}>{statusLabel[visit.status]}</StatusBadge></header><p>{visit.chiefComplaint}</p><small>{visitSummary(visit)}</small>{visit.clinical.diagnosis ? <small>{visit.clinical.diagnosis.code} — {visit.clinical.diagnosis.labelTh}</small> : null}</div></article>)}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
