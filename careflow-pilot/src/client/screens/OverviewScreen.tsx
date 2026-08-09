import { ArrowRight, ClipboardPlus, LockKeyhole, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import { useAuth } from "../auth/AuthProvider";
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

function staleQueueState(error: unknown, fetching: boolean, onReload: () => void): ReactElement {
  return (
    <div className="queue-global-block queue-stale-block" role="alert">
      <strong>กำลังแสดงข้อมูลคิวล่าสุดที่บันทึกไว้</strong>
      <span>{isApiError(error) ? error.messageTh : "ระบบคิวไม่พร้อมใช้งาน ข้อมูลอาจไม่ใช่สถานะล่าสุด"}</span>
      <button className="inline-retry-button" type="button" onClick={onReload} disabled={fetching}>
        {fetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}
      </button>
    </div>
  );
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

const pendingMetrics = [
  { key: "waiting", label: "รอพบแพทย์", detail: "รอตรวจ" },
  { key: "consulting", label: "กำลังตรวจ", detail: "อยู่ในห้องตรวจ" },
  { key: "awaitingOrderRevision", label: "รอทบทวนคำสั่งยา", detail: "รอแพทย์ทบทวน" },
  { key: "awaitingPreparation", label: "รอจัดยา", detail: "รอขั้นตอนจัดยา" },
  { key: "preparing", label: "กำลังจัดยา", detail: "กำลังตรวจและเตรียมยา" },
  { key: "awaitingRelease", label: "รอแพทย์ปล่อยยา", detail: "รอแพทย์ตรวจทาน" },
  { key: "awaitingHandoff", label: "รอส่งมอบยา", detail: "พร้อมส่งมอบแก่ผู้ป่วย" },
  { key: "awaitingCharge", label: "รอคิดเงิน", detail: "รอขั้นตอนคิดเงิน" },
] as const;

function queueStatus(status: string): { label: string; tone: "waiting" | "active" } {
  if (status === "CONSULTING") return { label: "กำลังตรวจ", tone: "active" };
  return {
    label: ({ WAITING: "รอพบแพทย์", AWAITING_ORDER_REVISION: "รอทบทวนคำสั่งยา", AWAITING_PREPARATION: "รอจัดยา", PREPARING: "กำลังจัดยา", AWAITING_RELEASE: "รอแพทย์ปล่อยยา", AWAITING_HANDOFF: "รอส่งมอบยา", AWAITING_CHARGE: "รอคิดเงิน" } as Record<string, string>)[status] ?? status,
    tone: "waiting",
  };
}

const dispensingStatuses = new Set(["AWAITING_PREPARATION", "PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF"]);

function journeyHref(status: string, visitId: string, isDoctor: boolean, canFulfillment: boolean): string {
  if (canFulfillment && dispensingStatuses.has(status)) return `/dispensing/${visitId}`;
  if (isDoctor && ["WAITING", "CONSULTING", "AWAITING_ORDER_REVISION"].includes(status)) return `/consultations/${visitId}`;
  return "/queue";
}

export function OverviewScreen(): ReactElement {
  const auth = useAuth();
  const dashboard = useDashboardToday();
  const queue = useQueue();

  if (dashboard.isPending) {
    return (
      <div className="operations-page overview-page">
        <PageHeader eyebrow="CARE FOR THE COMMUNITY" title="ภาพรวมคลินิก" description="สถานะสดจากระบบคิวของคลินิก" />
        <section className="metric-grid" aria-label="กำลังโหลดสรุปสถานะคลินิก">
          {pendingMetrics.map((metric) => <MetricSkeleton key={metric.key} label={`กำลังโหลด${metric.label}`} />)}
        </section>
      </div>
    );
  }
  if (dashboard.error || !dashboard.data) {
    return <div className="operations-page overview-page"><PageHeader eyebrow="CARE FOR THE COMMUNITY" title="ภาพรวมคลินิก" /><div className="care-card">{dashboard.error ? errorState(dashboard.error) : <QueryState title="ระบบภาพรวมไม่พร้อมใช้งาน" message="ยังไม่มีข้อมูลจากระบบ" />}</div></div>;
  }

  const metrics = dashboard.data;
  const activeRows = queue.data?.slice(0, 6) ?? [];
  const queueError = queue.error ? errorState(queue.error) : null;
  const queueLoading = queue.isPending && !queue.data && !queue.error;
  const hasCachedQueue = Array.isArray(queue.data);
  const queueStale = Boolean(queue.error && hasCachedQueue && !(isApiError(queue.error) && queue.error.status === 403));
  const isDoctor = auth.session?.user.role === "doctor";
  const canFulfillment = auth.session?.permissions.includes("fulfillment:read") ?? false;
  const roleAction = isDoctor
    ? {
        header: { to: "/queue", label: "ไปยังคิวตรวจ", icon: UsersRound },
        empty: {
          detail: "เมื่อผู้ช่วยส่งผู้ป่วยเข้าคิว รายการจะแสดงที่นี่",
          to: "/queue",
          label: "ดูคิวผู้ป่วย",
          icon: UsersRound,
        },
      }
    : {
        header: { to: "/intake", label: "รับผู้ป่วย", icon: ClipboardPlus },
        empty: {
          detail: "เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว",
          to: "/intake",
          label: "รับผู้ป่วยเข้าคิว",
          icon: ClipboardPlus,
        },
      };
  const HeaderActionIcon = roleAction.header.icon;
  const EmptyActionIcon = roleAction.empty.icon;

  return (
    <div className="operations-page overview-page">
      <PageHeader
        eyebrow="CARE FOR THE COMMUNITY"
        title="ภาพรวมคลินิก"
        description={`สถานะสดจากระบบคิว · อัปเดตล่าสุด ${formatThaiDateTime(metrics.updatedAt)}`}
        actions={queueLoading ? undefined : <Link className="care-button care-button-primary" to={roleAction.header.to}><HeaderActionIcon aria-hidden="true" size={18} />{roleAction.header.label}</Link>}
      />

      <section className="metric-grid" aria-label="สรุปสถานะคลินิก">
        {pendingMetrics.map((metric, index) => <Card className={`metric-card metric-card-${["mint", "blue", "warm", "neutral", "blue", "rose", "mint", "neutral"][index]}`} key={metric.key}><div className="metric-value-group"><span className="metric-label">{metric.label}</span><strong>{metrics[metric.key]}</strong><small>{metric.detail}</small></div></Card>)}
      </section>

      <div className="overview-grid">
        <Card className="journey-card">
          <SectionHeading icon={UsersRound} title="เส้นทางผู้ป่วยวันนี้" description="สถานะแบบสดจากระบบคิว" action={<Link className="text-link" to="/queue">ดูคิวทั้งหมด <ArrowRight aria-hidden="true" size={16} /></Link>} />
          {queueLoading ? <div className="overview-queue-loading" role="status"><span className="queue-skeleton" /><strong>กำลังโหลดคิวผู้ป่วย</strong><p>กำลังดึงข้อมูลล่าสุดจากระบบคิว</p></div> : queueError && !queueStale ? queueError : (
            <>
              {queueStale ? staleQueueState(queue.error, queue.isFetching, () => void queue.refetch()) : null}
              {activeRows.length > 0 ? (
            <div className="journey-list">
              {activeRows.map((item) => {
                const status = queueStatus(item.visit.status);
                return (
                  <Link className="journey-row" key={item.visit.id} to={journeyHref(item.visit.status, item.visit.id, isDoctor, canFulfillment)} aria-label={`${item.patient.displayName} ${status.label}`}>
                    <span className="journey-time">{formatThaiDateTime(item.visit.arrivedAt)}</span>
                    <span className="journey-person"><strong>{item.patient.displayName}</strong><small>{item.chiefComplaint}</small></span>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </Link>
                );
              })}
            </div>
              ) : (
            <EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วยในคิว" detail={roleAction.empty.detail} />
              )}
            </>
          )}
          {!queueLoading && activeRows.length === 0 && !queueError ? <Link className="care-button care-button-secondary overview-intake-link" to={roleAction.empty.to}><EmptyActionIcon aria-hidden="true" size={18} />{roleAction.empty.label}</Link> : null}
        </Card>

      </div>
    </div>
  );
}
