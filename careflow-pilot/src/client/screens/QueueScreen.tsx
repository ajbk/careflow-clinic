import { Clock3, LockKeyhole, RefreshCw, UsersRound } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { QueueItemDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { ActionButton, Card, EmptyState, PageHeader, StatusBadge } from "../components/careflow/ui";
import { createStartConsultationAttempt, useStartConsultation } from "../features/visit";
import { useQueue } from "../features/queue";
import { ApiError, isApiError } from "../lib/api-error";
import { formatThaiDateTime } from "../lib/thai-date";

function statusFor(status: QueueItemDto["visit"]["status"]): { label: string; tone: "waiting" | "active" } {
  return status === "CONSULTING" ? { label: "กำลังตรวจ", tone: "active" } : { label: "รอตรวจ", tone: "waiting" };
}

function vitalSummary(item: QueueItemDto): string {
  const temperature = item.vitals.temperatureC === null ? "—" : `${item.vitals.temperatureC}°C`;
  const bloodPressure = item.vitals.systolicMmhg === null || item.vitals.diastolicMmhg === null
    ? "—"
    : `${item.vitals.systolicMmhg}/${item.vitals.diastolicMmhg}`;
  const pulse = item.vitals.heartRateBpm === null ? "—" : `${item.vitals.heartRateBpm}/นาที`;
  const spo2 = item.vitals.spo2Percent === null ? "—" : `${item.vitals.spo2Percent}%`;
  return `อุณหภูมิ ${temperature} · ความดัน ${bloodPressure} · ชีพจร ${pulse} · SpO₂ ${spo2}`;
}

function QueryState({ error }: { error: unknown }): ReactElement {
  if (isApiError(error) && error.status === 403) {
    return <section className="workflow-blocked workflow-blocked-denied" role="alert"><LockKeyhole aria-hidden="true" size={24} /><div><h2>ไม่มีสิทธิ์ดูคิวผู้ป่วย</h2><p>{error.messageTh}</p></div></section>;
  }
  return <section className="workflow-blocked workflow-blocked-unavailable" role="alert"><RefreshCw aria-hidden="true" size={24} /><div><h2>ระบบคิวไม่พร้อมใช้งาน</h2><p>{isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง"}</p></div></section>;
}

function QueueCard({
  item,
  canStart,
  pending,
  blocked,
  onStart,
}: {
  item: QueueItemDto;
  canStart: boolean;
  pending: boolean;
  blocked?: ApiError;
  onStart: (item: QueueItemDto) => void;
}): ReactElement {
  const status = statusFor(item.visit.status);
  const serverAllowsStart = item.allowedActions.includes("START_CONSULTATION");
  const startAllowed = canStart && serverAllowsStart && item.visit.status === "WAITING";
  return (
    <article className="queue-card" aria-label={`${item.patient.hn} ${item.visit.id}`}>
      <div className="queue-card-top"><span className="queue-time"><Clock3 aria-hidden="true" size={15} /> {formatThaiDateTime(item.visit.arrivedAt)}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      <strong>{item.patient.displayName}</strong>
      <span>HN {item.patient.hn} · Visit {item.visit.id} · revision {item.visit.revision}</span>
      <p>{item.chiefComplaint}</p>
      <p className="queue-vitals">{vitalSummary(item)}</p>
      {blocked ? <div className="queue-blocked"><strong>{blocked.messageTh}</strong><span>ข้อมูลคิวอาจเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการต่อ</span></div> : null}
      {item.visit.status === "WAITING" && startAllowed ? <ActionButton className="queue-action" variant="secondary" onClick={() => onStart(item)} disabled={pending || Boolean(blocked)}>{pending ? "กำลังเริ่มห้องตรวจ…" : "เริ่มการตรวจ"}</ActionButton> : null}
      {item.visit.status === "WAITING" && !startAllowed && !blocked ? <span className="queue-waiting-action" aria-label="รอแพทย์เริ่มการตรวจ">รอแพทย์เริ่มการตรวจ</span> : null}
      {item.visit.status === "CONSULTING" ? <Link className="queue-link" to={`/consultations/${item.visit.id}`}>เปิดห้องตรวจ</Link> : null}
    </article>
  );
}

export function QueueScreen(): ReactElement {
  const auth = useAuth();
  const queue = useQueue();
  const startMutation = useStartConsultation();
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<Record<string, ApiError>>({});
  const [pendingVisitId, setPendingVisitId] = useState<string | null>(null);

  const rows = Array.isArray(queue.data) ? queue.data : [];
  const waiting = rows.filter((item) => item.visit.status === "WAITING");
  const consulting = rows.filter((item) => item.visit.status === "CONSULTING");
  const canStart = auth.session?.permissions.includes("visit:start-consultation") ?? false;

  function start(item: QueueItemDto): void {
    if (pendingVisitId || blocked[item.visit.id]) return;
    const visitId = item.visit.id;
    setPendingVisitId(visitId);
    startMutation.mutate({ visitId, attempt: createStartConsultationAttempt(item) }, {
      onSuccess: () => {
        setPendingVisitId(null);
        navigate(`/consultations/${visitId}`);
      },
      onError: (error) => {
        setPendingVisitId(null);
        if (isApiError(error) && (error.code === "REVISION_CONFLICT" || error.code === "INVALID_STATE")) {
          setBlocked((current) => ({ ...current, [visitId]: error }));
          return;
        }
      },
    });
  }

  async function reload(): Promise<void> {
    await queue.refetch();
    setBlocked({});
  }

  if (queue.isPending) {
    return <div className="flow-page queue-page"><PageHeader eyebrow="LIVE QUEUE" title="คิวผู้ป่วย" description="ติดตามเส้นทางการดูแลผู้ป่วยในวันนี้" /><div className="queue-board queue-board-loading"><section className="queue-column"><div className="queue-skeleton" /><div className="queue-skeleton" /></section><section className="queue-column"><div className="queue-skeleton" /></section></div></div>;
  }
  if (queue.error) {
    return <div className="flow-page queue-page"><PageHeader eyebrow="LIVE QUEUE" title="คิวผู้ป่วย" description="ติดตามเส้นทางการดูแลผู้ป่วยในวันนี้" actions={<Link className="care-button care-button-primary" to="/intake">รับผู้ป่วยใหม่</Link>} /><Card><QueryState error={queue.error} /></Card></div>;
  }

  const renderGroup = (title: string, detail: string, items: QueueItemDto[], tone: "waiting" | "active") => (
    <section className={`queue-column queue-column-${tone}`} key={title}>
      <header><div><h2>{title}</h2><p>{detail}</p></div><UsersRound aria-hidden="true" size={20} /></header>
      <div className="queue-stack">
        {items.length > 0 ? items.map((item) => <QueueCard key={item.visit.id} item={item} canStart={canStart} pending={pendingVisitId === item.visit.id} blocked={blocked[item.visit.id]} onStart={start} />) : <EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วย" detail="รายการใหม่จะแสดงที่นี่" />}
      </div>
    </section>
  );

  return (
    <div className="flow-page queue-page">
      <PageHeader eyebrow="LIVE QUEUE" title="คิวผู้ป่วย" description="ติดตามเส้นทางการดูแลผู้ป่วยในวันนี้" actions={<Link className="care-button care-button-primary" to="/intake">รับผู้ป่วยใหม่</Link>} />
      {Object.keys(blocked).length > 0 ? <div className="queue-global-block" role="alert"><strong>ข้อมูลคิวเปลี่ยนแปลง</strong><span>การเริ่มห้องตรวจถูกระงับเพื่อป้องกันการใช้ข้อมูล revision เก่า</span><button className="inline-retry-button" type="button" onClick={() => void reload()} disabled={queue.isFetching}>{queue.isFetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</button></div> : null}
      {rows.length === 0 ? <Card className="queue-empty-card"><EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วยในคิว" detail="เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว" /><Link className="care-button care-button-primary" to="/intake">ไปหน้ารับผู้ป่วย</Link></Card> : <div className="queue-board">{renderGroup("รอพบแพทย์", `${waiting.length} ราย`, waiting, "waiting")}{renderGroup("กำลังตรวจ", `${consulting.length} ราย`, consulting, "active")}</div>}
    </div>
  );
}
