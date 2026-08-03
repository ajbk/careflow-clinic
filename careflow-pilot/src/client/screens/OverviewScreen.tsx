import { ArrowRight, ClipboardPlus, LockKeyhole, Stethoscope, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { useDashboardToday } from "../features/dashboard";
import { useQueue } from "../features/queue";
import { isApiError } from "../lib/api-error";
import { formatThaiDateTime } from "../lib/thai-date";

function QueryState({ title, message, kind = "unavailable" }: { title: string; message: string; kind?: "error" | "denied" | "unavailable" }): ReactElement {
  return (
    <section className={`workflow-blocked workflow-blocked-${kind}`} role="alert">
      <LockKeyhole aria-hidden="true" size={22} />
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

function errorState(error: unknown): ReactElement {
  if (isApiError(error) && error.status === 403) {
    return <QueryState kind="denied" title="ไม่มีสิทธิ์ดูภาพรวม" message="บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลคิวของคลินิก" />;
  }
  if (isApiError(error)) return <QueryState title="ระบบภาพรวมไม่พร้อมใช้งาน" message={error.messageTh} />;
  return <QueryState title="ระบบภาพรวมไม่พร้อมใช้งาน" message="ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง" />;
}

function MetricSkeleton({ label }: { label: string }) {
  return (
    <Card className="metric-card metric-card-loading" aria-label={label}>
      <span className="metric-skeleton metric-skeleton-label" />
      <span className="metric-skeleton metric-skeleton-value" />
      <span className="metric-skeleton metric-skeleton-detail" />
    </Card>
  );
}

export function OverviewScreen(): ReactElement {
  const dashboard = useDashboardToday();
  const queue = useQueue();

  if (dashboard.isPending) {
    return (
      <div className="operations-page overview-page">
        <PageHeader eyebrow="CARE FOR THE COMMUNITY" title="ภาพรวมคลินิก" description="สถานะสดจากระบบคิวของคลินิก" />
        <section className="metric-grid" aria-label="กำลังโหลดสรุปสถานะคลินิก">
          <MetricSkeleton label="กำลังโหลดผู้ป่วยในระบบวันนี้" />
          <MetricSkeleton label="กำลังโหลดคิวรอตรวจ" />
          <MetricSkeleton label="กำลังโหลดห้องตรวจ" />
          <MetricSkeleton label="กำลังโหลดเวลาอัปเดต" />
        </section>
      </div>
    );
  }
  if (dashboard.error || !dashboard.data) return <div className="operations-page overview-page"><PageHeader eyebrow="CARE FOR THE COMMUNITY" title="ภาพรวมคลินิก" /><div className="care-card"><QueryState title="ระบบภาพรวมไม่พร้อมใช้งาน" message={dashboard.error ? (isApiError(dashboard.error) ? dashboard.error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้") : "ยังไม่มีข้อมูลจากระบบ"} /></div></div>;

  const metrics = dashboard.data;
  const activeRows = queue.data?.slice(0, 6) ?? [];
  const queueError = queue.error ? errorState(queue.error) : null;

  return (
    <div className="operations-page overview-page">
      <PageHeader
        eyebrow="CARE FOR THE COMMUNITY"
        title="ภาพรวมคลินิก"
        description={`สถานะสดจากระบบคิว · อัปเดตล่าสุด ${formatThaiDateTime(metrics.updatedAt)}`}
        actions={<Link className="care-button care-button-primary" to="/intake"><ClipboardPlus aria-hidden="true" size={18} />รับผู้ป่วย</Link>}
      />

      <section className="metric-grid" aria-label="สรุปสถานะคลินิก">
        <Card className="metric-card metric-card-mint"><div className="metric-value-group"><span className="metric-label">ผู้ป่วยในระบบวันนี้</span><strong>{metrics.waiting + metrics.consulting}</strong><small>อยู่ในเส้นทางการดูแล</small></div></Card>
        <Card className="metric-card metric-card-blue"><div className="metric-value-group"><span className="metric-label">รอตรวจ</span><strong>{metrics.waiting}</strong><small>รอเรียกพบแพทย์</small></div></Card>
        <Card className="metric-card metric-card-warm"><div className="metric-value-group"><span className="metric-label">กำลังตรวจ</span><strong>{metrics.consulting}</strong><small>อยู่ในห้องตรวจ</small></div></Card>
        <Card className="metric-card metric-card-neutral"><div className="metric-value-group"><span className="metric-label">ข้อมูลอัปเดต</span><strong className="metric-time">{formatThaiDateTime(metrics.updatedAt)}</strong><small>เวลาจากระบบคิว</small></div></Card>
      </section>

      <div className="overview-grid">
        <Card className="journey-card">
          <SectionHeading icon={UsersRound} title="เส้นทางผู้ป่วยวันนี้" description="สถานะแบบสดจากระบบคิว" action={<Link className="text-link" to="/queue">ดูคิวทั้งหมด <ArrowRight aria-hidden="true" size={16} /></Link>} />
          {queueError ? queueError : activeRows.length > 0 ? (
            <div className="journey-list">
              {activeRows.map((item) => {
                const status = item.visit.status === "CONSULTING" ? { label: "กำลังตรวจ", tone: "active" as const } : { label: "รอตรวจ", tone: "waiting" as const };
                return (
                  <article className="journey-row" key={item.visit.id}>
                    <span className="journey-time">{formatThaiDateTime(item.visit.arrivedAt)}</span>
                    <span className="journey-person"><strong>{item.patient.displayName}</strong><small>{item.chiefComplaint}</small></span>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วยในคิว" detail="เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว" />
          )}
          {activeRows.length === 0 && !queueError ? <Link className="care-button care-button-secondary overview-intake-link" to="/intake"><ClipboardPlus aria-hidden="true" size={18} />รับผู้ป่วยเข้าคิว</Link> : null}
        </Card>

        <Card className="quick-actions-card">
          <SectionHeading icon={Stethoscope} title="สถานะ Milestone" description="ส่วนที่ยังไม่เปิดใช้งานใน Pilot" />
          <div className="quick-actions pilot-unavailable-actions">
            {[
              ["การจัดยา", "ยังไม่พร้อมใน Pilot"],
              ["การชำระเงิน", "ยังไม่พร้อมใน Pilot"],
              ["คลังยา", "ยังไม่พร้อมใน Pilot"],
            ].map(([label, detail]) => <div className="quick-action-unavailable" key={label}><span className="quick-action-icon"><LockKeyhole aria-hidden="true" size={20} /></span><span><strong>{label}</strong><small>{detail}</small></span></div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
