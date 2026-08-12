import { Clock3, LockKeyhole, RefreshCw, UsersRound } from "lucide-react";
import type { ReactElement } from "react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { QueueItemDto, ReviewAllergyPayload } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { AllergyReviewDialog } from "../components/careflow/AllergyReviewDialog";
import { JourneyActionControl } from "../components/careflow/JourneyBlockerCard";
import { JourneyNextTaskCard } from "../components/careflow/JourneyNextTaskCard";
import { VisitJourneyRibbon } from "../components/careflow/VisitJourneyRibbon";
import { Card, EmptyState, PageHeader, StatusBadge } from "../components/careflow/ui";
import { allergyStateLabelTh, createReviewAllergyAttempt, useReviewAllergy, type ReviewAllergyAttempt } from "../features/allergy";
import { useQueue } from "../features/queue";
import { createStartConsultationAttempt, useStartConsultation, type StartConsultationAttempt } from "../features/visit";
import { ApiError, isApiError } from "../lib/api-error";
import { formatThaiDateTime } from "../lib/thai-date";

const queueGroups = [
  { status: "WAITING", title: "รอพบแพทย์", detail: "รอเรียกพบแพทย์", tone: "waiting" as const },
  { status: "CONSULTING", title: "กำลังตรวจ", detail: "อยู่ในห้องตรวจ", tone: "active" as const },
  { status: "AWAITING_ORDER_REVISION", title: "รอทบทวนคำสั่งยา", detail: "รอแพทย์ทบทวนคำสั่งยา", tone: "waiting" as const },
  { status: "AWAITING_PREPARATION", title: "รอจัดยา", detail: "รอขั้นตอนจัดยา", tone: "waiting" as const },
  { status: "PREPARING", title: "กำลังจัดยา", detail: "กำลังตรวจและเตรียมยา", tone: "active" as const },
  { status: "AWAITING_RELEASE", title: "รอแพทย์ปล่อยยา", detail: "รอแพทย์ตรวจทาน", tone: "waiting" as const },
  { status: "AWAITING_HANDOFF", title: "รอส่งมอบยา", detail: "พร้อมส่งมอบแก่ผู้ป่วย", tone: "active" as const },
  { status: "AWAITING_CHARGE", title: "รอคิดเงิน", detail: "รอขั้นตอนคิดเงิน", tone: "waiting" as const },
  { status: "AWAITING_PAYMENT", title: "รอรับชำระ", detail: "รอบันทึกการชำระ", tone: "waiting" as const },
  { status: "READY_TO_CLOSE", title: "พร้อมปิด Visit", detail: "รับชำระแล้ว", tone: "active" as const },
] as const;

function statusFor(status: QueueItemDto["visit"]["status"]): { label: string; tone: "waiting" | "active" } {
  if (status === "WAITING") return { label: "รอตรวจ", tone: "waiting" };
  const group = queueGroups.find((candidate) => candidate.status === status);
  return group ? { label: group.title, tone: group.tone } : { label: status, tone: "waiting" };
}

function vitalSummary(item: QueueItemDto): string {
  const temperature = item.vitals.temperatureC === null ? "—" : `${item.vitals.temperatureC}°C`;
  const bloodPressure = item.vitals.systolicMmhg === null || item.vitals.diastolicMmhg === null ? "—" : `${item.vitals.systolicMmhg}/${item.vitals.diastolicMmhg}`;
  const pulse = item.vitals.heartRateBpm === null ? "—" : `${item.vitals.heartRateBpm}/นาที`;
  const spo2 = item.vitals.spo2Percent === null ? "—" : `${item.vitals.spo2Percent}%`;
  return `อุณหภูมิ ${temperature} · ความดัน ${bloodPressure} · ชีพจร ${pulse} · SpO₂ ${spo2}`;
}

function QueryState({ error }: { error: unknown }): ReactElement {
  if (isApiError(error) && error.status === 403) return <section className="workflow-blocked workflow-blocked-denied" role="alert"><LockKeyhole aria-hidden="true" size={24} /><div><h2>ไม่มีสิทธิ์ดูคิวผู้ป่วย</h2><p>{error.messageTh}</p></div></section>;
  return <section className="workflow-blocked workflow-blocked-unavailable" role="alert"><RefreshCw aria-hidden="true" size={24} /><div><h2>ระบบคิวไม่พร้อมใช้งาน</h2><p>{isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง"}</p></div></section>;
}

function actionErrorMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถเริ่มห้องตรวจได้ กรุณาลองใหม่อีกครั้ง";
}

function allergyErrorMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

function ConflictBanner({ visible, fetching, error, onReload }: { visible: boolean; fetching: boolean; error?: unknown; onReload: () => void }): ReactElement | null {
  if (!visible) return null;
  return <div className="queue-global-block" role="alert"><strong>ข้อมูลคิวเปลี่ยนแปลง</strong><span>{isApiError(error) ? error.messageTh : "คำสั่งจากคิวถูกระงับเพื่อป้องกันการใช้ข้อมูล revision เก่า"}</span><button className="inline-retry-button" type="button" onClick={onReload} disabled={fetching}>{fetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</button></div>;
}

function StaleQueueBanner({ error, fetching, onReload }: { error: unknown; fetching: boolean; onReload: () => void }): ReactElement {
  return <div className="queue-global-block queue-stale-block" role="alert"><strong>กำลังแสดงข้อมูลคิวล่าสุดที่บันทึกไว้</strong><span>{isApiError(error) ? error.messageTh : "ระบบคิวไม่พร้อมใช้งาน ข้อมูลอาจไม่ใช่สถานะล่าสุด"}</span><button className="inline-retry-button" type="button" onClick={onReload} disabled={fetching}>{fetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</button></div>;
}

function QueueCard({ item, currentRole, pending, blocked, startError, stale, reviewPending, onStart, onReview }: { item: QueueItemDto; currentRole: "assistant" | "doctor"; pending: boolean; blocked?: ApiError; startError?: unknown; stale: boolean; reviewPending: boolean; onStart: (item: QueueItemDto) => void; onReview: (item: QueueItemDto) => void }): ReactElement {
  const status = statusFor(item.visit.status);
  const authorityReady = !stale && !blocked;
  const reviewRenderedByJourney = item.journeySummary.nextTask?.action === "REVIEW_ALLERGY" || item.journeySummary.blockers.some((blocker) => blocker.recoveryAction === "REVIEW_ALLERGY");
  const localActionHandlers = {
    ...(pending ? {} : { START_CONSULTATION: () => onStart(item) }),
    ...(reviewPending ? {} : { REVIEW_ALLERGY: () => onReview(item) }),
  };
  return <article className="queue-card" aria-label={`${item.patient.hn} ${item.visit.id}`}>
    <div className="queue-card-top"><span className="queue-time"><Clock3 aria-hidden="true" size={15} /><span>มาถึง {formatThaiDateTime(item.visit.arrivedAt)}</span>{item.visit.startedAt ? <span className="queue-start-time">เริ่มตรวจ {formatThaiDateTime(item.visit.startedAt)}</span> : null}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
    <strong>{item.patient.displayName}</strong>
    <span>HN {item.patient.hn} · Visit {item.visit.id} · revision {item.visit.revision}</span>
    <p>{item.chiefComplaint}</p><p className="queue-vitals">{vitalSummary(item)}</p>
    <p className="queue-allergy-state">ประวัติแพ้ยา: {allergyStateLabelTh(item.allergy.state)}</p>
    {blocked ? <div className="queue-blocked"><strong>{blocked.messageTh}</strong><span>ข้อมูลคิวอาจเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการต่อ</span></div> : null}
    <VisitJourneyRibbon steps={item.journeySummary.steps} />
    <JourneyNextTaskCard
      summary={item.journeySummary}
      visitId={item.visit.id}
      currentRole={currentRole}
      authorityReady={authorityReady}
      commandFailure={startError ? actionErrorMessage(startError) : undefined}
      localActionHandlers={localActionHandlers}
    />
    {!reviewRenderedByJourney ? <JourneyActionControl action="REVIEW_ALLERGY" labelTh={reviewPending ? "กำลังบันทึกการทบทวน…" : "ทบทวนข้อมูลแพ้ยา"} visitId={item.visit.id} allowedActions={item.journeySummary.allowedActions} authorityReady={authorityReady && !reviewPending} localActionHandlers={reviewPending ? undefined : { REVIEW_ALLERGY: () => onReview(item) }} /> : null}
  </article>;
}

export function QueueScreen(): ReactElement {
  const auth = useAuth(); const queue = useQueue(); const startMutation = useStartConsultation(); const allergyMutation = useReviewAllergy(); const navigate = useNavigate();
  const [blocked, setBlocked] = useState<Record<string, ApiError>>({}); const [allergyBlocked, setAllergyBlocked] = useState<Record<string, ApiError>>({}); const [startErrors, setStartErrors] = useState<Record<string, unknown>>({}); const [allergyErrors, setAllergyErrors] = useState<Record<string, unknown>>({}); const [reloadError, setReloadError] = useState<unknown>(null); const [pendingVisitId, setPendingVisitId] = useState<string | null>(null); const [reviewing, setReviewing] = useState<QueueItemDto | null>(null);
  const startAttemptsRef = useRef<Record<string, StartConsultationAttempt>>({}); const allergyAttemptsRef = useRef<Record<string, { fingerprint: string; attempt: ReviewAllergyAttempt }>>({});
  const rows = Array.isArray(queue.data) ? queue.data.filter((item) => item.visit.status !== "CLOSED") : []; const currentRole = auth.session?.user.role ?? "assistant"; const isDoctor = currentRole === "doctor";
  const queueWorkspace = isDoctor ? { eyebrow: "DOCTOR WORKSPACE · CLINICAL QUEUE", description: "เลือกผู้ป่วยเพื่อเริ่มหรือกลับเข้าห้องตรวจ", action: <Link className="care-button care-button-secondary" to="/overview">ดูภาพรวม</Link>, emptyDetail: "เมื่อผู้ช่วยส่งผู้ป่วยเข้าคิว รายการจะแสดงที่นี่" } : { eyebrow: "ASSISTANT WORKSPACE · PATIENT HANDOFF", description: "ติดตามการส่งต่อผู้ป่วยให้แพทย์", action: <Link className="care-button care-button-primary" to="/intake">รับผู้ป่วยใหม่</Link>, emptyDetail: "เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว" };

  function start(item: QueueItemDto): void {
    if (pendingVisitId || blocked[item.visit.id] || !item.journeySummary.allowedActions.includes("START_CONSULTATION")) return;
    const visitId = item.visit.id; setPendingVisitId(visitId); setStartErrors((current) => { const next = { ...current }; delete next[visitId]; return next; });
    const attempt = startAttemptsRef.current[visitId] ?? createStartConsultationAttempt(item.visit); startAttemptsRef.current[visitId] = attempt;
    startMutation.mutate({ visitId, attempt }, { onSuccess: () => { setPendingVisitId(null); setStartErrors((current) => { const next = { ...current }; delete next[visitId]; return next; }); navigate(`/consultations/${visitId}`); }, onError: (error) => { setPendingVisitId(null); if (isApiError(error) && (error.code === "REVISION_CONFLICT" || error.code === "INVALID_STATE")) { delete startAttemptsRef.current[visitId]; setBlocked((current) => ({ ...current, [visitId]: error })); return; } setStartErrors((current) => ({ ...current, [visitId]: error })); } });
  }

  function reviewAllergy(value: ReviewAllergyPayload): void {
    if (!reviewing || allergyBlocked[reviewing.visit.id]) return;
    const item = rows.find((row) => row.visit.id === reviewing.visit.id) ?? reviewing;
    if (!item.journeySummary.allowedActions.includes("REVIEW_ALLERGY")) return;
    const payload = { ...value, visitId: item.visit.id }; const fingerprint = JSON.stringify(payload); const saved = allergyAttemptsRef.current[item.visit.id];
    if (!saved || saved.fingerprint !== fingerprint) allergyAttemptsRef.current[item.visit.id] = { fingerprint, attempt: createReviewAllergyAttempt(item, payload) };
    setAllergyErrors((current) => { const next = { ...current }; delete next[item.visit.id]; return next; });
    allergyMutation.mutate({ context: item, attempt: allergyAttemptsRef.current[item.visit.id].attempt }, { onSuccess: () => { delete allergyAttemptsRef.current[item.visit.id]; setReviewing(null); }, onError: (error) => { if (isApiError(error) && (error.code === "REVISION_CONFLICT" || error.code === "INVALID_STATE")) { delete allergyAttemptsRef.current[item.visit.id]; setAllergyBlocked((current) => ({ ...current, [item.visit.id]: error })); return; } setAllergyErrors((current) => ({ ...current, [item.visit.id]: error })); } });
  }

  async function reload(): Promise<void> { const result = await queue.refetch(); if (result.isSuccess) { setReloadError(null); setBlocked({}); setAllergyBlocked({}); setStartErrors({}); setAllergyErrors({}); startAttemptsRef.current = {}; return; } setReloadError(result.error ?? new Error("Queue reload failed")); }
  const hasBlockedVisits = Object.keys(blocked).length > 0 || Object.keys(allergyBlocked).length > 0; const queueError = reloadError ?? queue.error;
  if (queue.isPending) return <div className="flow-page queue-page"><PageHeader eyebrow={queueWorkspace.eyebrow} title="คิวผู้ป่วย" description={queueWorkspace.description} /><div className="queue-board queue-board-loading"><section className="queue-column"><div className="queue-skeleton" /><div className="queue-skeleton" /></section><section className="queue-column"><div className="queue-skeleton" /></section></div></div>;
  const hasQueueData = Array.isArray(queue.data); const staleQueue = Boolean(queueError && hasQueueData); const showStaleQueue = staleQueue && !(isApiError(queueError) && queueError.status === 403);
  if (queueError && !showStaleQueue) return <div className="flow-page queue-page"><PageHeader eyebrow={queueWorkspace.eyebrow} title="คิวผู้ป่วย" description={queueWorkspace.description} actions={queueWorkspace.action} /><ConflictBanner visible={hasBlockedVisits} fetching={queue.isFetching} onReload={() => void reload()} /><Card><QueryState error={queueError} /></Card></div>;
  const renderGroup = (group: typeof queueGroups[number]) => { const items = rows.filter((item) => item.visit.status === group.status); if (items.length === 0) return null; return <section className={`queue-column queue-column-${group.tone}`} key={group.status}><header><div><h2>{group.title}</h2><p>{items.length} ราย · {group.detail}</p></div><UsersRound aria-hidden="true" size={20} /></header><div className="queue-stack">{items.map((item) => <QueueCard key={item.visit.id} item={item} currentRole={currentRole} pending={pendingVisitId === item.visit.id} blocked={blocked[item.visit.id] ?? allergyBlocked[item.visit.id]} startError={startErrors[item.visit.id]} stale={staleQueue} reviewPending={allergyMutation.isPending || Boolean(allergyBlocked[item.visit.id])} onStart={start} onReview={setReviewing} />)}</div></section>; };
  const reviewingCurrent = reviewing ? rows.find((row) => row.visit.id === reviewing.visit.id) ?? reviewing : null;
  return <div className="flow-page queue-page"><PageHeader eyebrow={queueWorkspace.eyebrow} title="คิวผู้ป่วย" description={queueWorkspace.description} actions={queueWorkspace.action} /><ConflictBanner visible={hasBlockedVisits} error={showStaleQueue ? queueError : undefined} fetching={queue.isFetching} onReload={() => void reload()} />{showStaleQueue && !hasBlockedVisits ? <StaleQueueBanner error={queueError} fetching={queue.isFetching} onReload={() => void reload()} /> : null}{rows.length === 0 ? <Card className="queue-empty-card"><EmptyState icon={UsersRound} title="ยังไม่มีผู้ป่วยในคิว" detail={queueWorkspace.emptyDetail} />{!isDoctor ? <Link className="care-button care-button-primary" to="/intake">ไปหน้ารับผู้ป่วย</Link> : null}</Card> : <div className="queue-board">{queueGroups.map(renderGroup)}</div>}{reviewingCurrent ? <AllergyReviewDialog allergy={reviewingCurrent.allergy} onClose={() => setReviewing(null)} onSave={reviewAllergy} pending={allergyMutation.isPending} error={allergyErrors[reviewingCurrent.visit.id] ? allergyErrorMessage(allergyErrors[reviewingCurrent.visit.id]) : allergyBlocked[reviewingCurrent.visit.id]?.messageTh ?? (staleQueue ? "ข้อมูลคิวอาจไม่เป็นปัจจุบัน" : undefined)} blocked={Boolean(allergyBlocked[reviewingCurrent.visit.id]) || staleQueue} onReload={() => void reload()} reloadPending={queue.isFetching} /> : null}</div>;
}
