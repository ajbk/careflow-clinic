"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, ClipboardPlus, PackageOpen, Stethoscope, UsersRound } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectDashboardMetrics, selectPatient } from "@/lib/careflow/selectors";
import { Card, PageHeader, SectionHeading, StatusBadge } from "../ui";

const journeyLabels = {
  waiting: ["รอตรวจ", "waiting"] as const,
  consulting: ["กำลังตรวจ", "active"] as const,
  "awaiting-dispensing": ["รอรับยา", "warning"] as const,
  "awaiting-payment": ["รอชำระเงิน", "info"] as const,
  complete: ["เสร็จสิ้น", "success"] as const,
  intake: ["รับข้อมูล", "neutral"] as const,
};

export function OverviewScreen() {
  const { state } = useCareFlow();
  const metrics = selectDashboardMetrics(state);
  const activeVisits = state.visits
    .filter((visit) => visit.status !== "complete" && visit.status !== "intake")
    .slice(0, 6);
  const metricCards = [
    { label: "ผู้ป่วยในระบบวันนี้", value: metrics.currentPatients, detail: "กำลังอยู่ในเส้นทางการดูแล", tone: "mint" },
    { label: "รอตรวจ", value: metrics.waiting, detail: "รอเรียกพบแพทย์", tone: "blue" },
    { label: "รอรับยา", value: metrics.dispensing, detail: "ต้องตรวจยาก่อนส่งมอบ", tone: "warm" },
    { label: "คลังยาแจ้งเตือน", value: metrics.lowStock, detail: "ต่ำกว่าเกณฑ์หรือหมด", tone: "rose" },
  ];

  return (
    <div className="operations-page overview-page">
      <PageHeader
        eyebrow="CARE FOR THE COMMUNITY"
        title="ภาพรวมคลินิก"
        description="เช้าวันเสาร์ที่ 2 สิงหาคม 2569 · ทุกอย่างที่ทีมต้องใช้เพื่อดูแลผู้ป่วยอย่างต่อเนื่อง"
        actions={<><Link className="care-button care-button-secondary" href="/appointments/new"><CalendarDays aria-hidden="true" size={18} />นัดหมายใหม่</Link><Link className="care-button care-button-primary" href="/intake"><ClipboardPlus aria-hidden="true" size={18} />รับผู้ป่วย</Link></>}
      />

      <section className="metric-grid" aria-label="สรุปสถานะคลินิก">
        {metricCards.map((metric) => <Card className={`metric-card metric-card-${metric.tone}`} key={metric.label}>
          <div aria-label={metric.label} className="metric-value-group"><span className="metric-label">{metric.label}</span>
          <strong>{metric.value}</strong>
          <small>{metric.detail}</small></div>
        </Card>)}
      </section>

      <div className="overview-grid">
        <Card className="journey-card">
          <SectionHeading icon={UsersRound} title="เส้นทางผู้ป่วยวันนี้" description="สถานะแบบสดจากข้อมูลตัวอย่าง" action={<Link className="text-link" href="/queue">ดูคิวทั้งหมด <ArrowRight aria-hidden="true" size={16} /></Link>} />
          <div className="journey-list">
            {activeVisits.map((visit) => {
              const patient = selectPatient(state, visit.patientId);
              const [label, tone] = journeyLabels[visit.status];
              return <article className="journey-row" key={visit.id}>
                <span className="journey-time">{new Date(visit.arrivedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="journey-person"><strong>{patient?.name ?? "ไม่พบชื่อผู้ป่วย"}</strong><small>{visit.chiefComplaint}</small></span>
                <StatusBadge tone={tone}>{label}</StatusBadge>
              </article>;
            })}
          </div>
        </Card>
        <Card className="quick-actions-card">
          <SectionHeading icon={Stethoscope} title="ทางลัดการทำงาน" description="เริ่มงานหลักได้จากที่เดียว" />
          <div className="quick-actions">
            <Link href="/queue"><span className="quick-action-icon"><UsersRound aria-hidden="true" size={20} /></span><span><strong>จัดการคิวผู้ป่วย</strong><small>เรียกและส่งต่อรายการตรวจ</small></span><ArrowRight aria-hidden="true" size={18} /></Link>
            <Link href="/inventory/receive"><span className="quick-action-icon"><PackageOpen aria-hidden="true" size={20} /></span><span><strong>รับยาเข้าคลัง</strong><small>เพิ่มล็อตและอัปเดตคงเหลือ</small></span><ArrowRight aria-hidden="true" size={18} /></Link>
            <Link href="/appointments"><span className="quick-action-icon"><CalendarDays aria-hidden="true" size={20} /></span><span><strong>ดูตารางนัดหมาย</strong><small>นัดติดตามและตรวจสอบช่วงว่าง</small></span><ArrowRight aria-hidden="true" size={18} /></Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
