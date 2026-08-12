import type { KeyboardEvent, ReactElement, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CheckoutDto, JourneyAction } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { JourneyAuthorityBanner, JourneyNextTaskCard } from "../components/careflow/JourneyNextTaskCard";
import { VisitJourneyRibbon } from "../components/careflow/VisitJourneyRibbon";
import { ActionButton, Card, Field, PageHeader, SectionHeading, StatusBadge, TextAreaField } from "../components/careflow/ui";
import {
  createApproveFullWaiverAttempt,
  createCloseVisitAttempt,
  createConfirmPromptPayAttempt,
  createFinalizeChargeAttempt,
  createFinalizeFullWaiverAttempt,
  createRecordCashAttempt,
  useApproveWaiver,
  useCheckout,
  useCloseVisit,
  useConfirmPromptPay,
  useFinalizeCharge,
  useRecordCash,
  type ApproveFullWaiverAttempt,
  type CloseVisitAttempt,
  type ConfirmPromptPayAttempt,
  type FinalizeChargeAttempt,
  type RecordCashAttempt,
} from "../features/finance";
import { journeyAuthorityUnavailable, useVisitJourney } from "../features/journey";
import { isApiError } from "../lib/api-error";

type WaiverMode = "finalize" | "approve";
type SavedAttempt<T> = { fingerprint: string; attempt: T };

const bahtFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

function formatBaht(value: number): string {
  return `${bahtFormatter.format(value)} บาท`;
}

function checkoutStatus(data: CheckoutDto): { label: string; tone: "waiting" | "active" | "success" | "neutral" } {
  const labels: Record<CheckoutDto["visit"]["status"], string> = {
    WAITING: "รอพบแพทย์",
    CONSULTING: "กำลังตรวจ",
    AWAITING_PREPARATION: "รอจัดยา",
    PREPARING: "กำลังจัดยา",
    AWAITING_RELEASE: "รอแพทย์ปล่อยยา",
    AWAITING_HANDOFF: "รอส่งมอบยา",
    AWAITING_ORDER_REVISION: "รอทบทวนคำสั่งยา",
    AWAITING_CHARGE: "รอยืนยันยอด",
    AWAITING_PAYMENT: "รอรับชำระ",
    READY_TO_CLOSE: "พร้อมปิด Visit",
    CLOSED: "Visit ปิดแล้ว",
  };
  if (data.visit.status === "AWAITING_CHARGE") return { label: labels[data.visit.status], tone: "waiting" };
  if (data.visit.status === "AWAITING_PAYMENT") return { label: labels[data.visit.status], tone: "active" };
  if (data.visit.status === "READY_TO_CLOSE") return { label: labels[data.visit.status], tone: "success" };
  return { label: labels[data.visit.status], tone: "neutral" };
}

function collectionStateLabel(data: CheckoutDto): string {
  const labels: Record<CheckoutDto["collectionState"], string> = {
    PENDING_CHARGE: "รอยืนยันยอด",
    AWAITING_COLLECTION: "รอรับชำระ",
    PAID_CASH: "รับเงินสดแล้ว",
    PAID_PROMPTPAY: "ยืนยัน PromptPay แล้ว",
    COLLECTION_NOT_REQUIRED: "ยกเว้นเต็มจำนวน · ไม่ต้องรับชำระ",
    CLOSED: "ปิด Visit แล้ว",
  };
  return labels[data.collectionState];
}

function sourceKindLabel(data: CheckoutDto): string {
  return data.sourceKind === "ORDER" ? "มีคำสั่งยา" : "ไม่มีคำสั่งยา";
}

function commandMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

function fieldError(error: unknown, field: string): string | undefined {
  return isApiError(error) ? error.fieldErrors?.[field] : undefined;
}

function journeyActionForCheckout(action: CheckoutDto["allowedActions"][number]): JourneyAction | null {
  if (action === "FINALIZE_CHARGE") return "FINALIZE_CHARGE";
  if (action === "APPROVE_FULL_WAIVER") return "APPROVE_FULL_WAIVER";
  if (action === "RECORD_CASH") return "RECORD_CASH";
  if (action === "CONFIRM_PROMPTPAY") return "RECORD_PROMPTPAY";
  if (action === "CLOSE_VISIT") return "CLOSE_VISIT";
  if (action === "READ_OPD") return "OPEN_OPD_CARD";
  return null;
}

function CheckoutUnavailable({ error, onReload }: { error: unknown; onReload: () => void }): ReactElement {
  const denied = isApiError(error) && error.status === 403;
  return (
    <Card className="checkout-card">
      <section className={`workflow-blocked ${denied ? "workflow-blocked-denied" : "workflow-blocked-unavailable"}`} role="alert">
        <div>
          <h2>{denied ? "ไม่สามารถเข้าถึงข้อมูลชำระเงิน" : "ไม่สามารถโหลด Checkout ได้"}</h2>
          <p>{commandMessage(error)}</p>
          {!denied ? <button className="inline-retry-button" type="button" onClick={onReload}>โหลดข้อมูลล่าสุด</button> : null}
        </div>
      </section>
    </Card>
  );
}

function CheckoutEvidence({ data, jobPanel }: { data: CheckoutDto; jobPanel: ReactElement }): ReactElement {
  return (
    <Card className="checkout-card">
      <div className="checkout-grid">
        <section aria-label="หลักฐานรายการคิดเงิน">
          <SectionHeading title="หลักฐานรายการคิดเงิน" description="รายการและจำนวนเงินจากระบบ ไม่สามารถแก้ไขจากหน้านี้" />
          <div className="checkout-patient-meta">
            <strong>{data.patient.displayName}</strong>
            <span>HN {data.patient.hn} · Visit {data.visit.id} · revision {data.visit.revision}</span>
            <span>Pricing revision {data.clinicPricingRevision}</span>
          </div>
          <dl className="invoice-lines">
            {data.lines.map((line) => (
              <div key={line.id ?? `preview-${line.position}`}>
                <dt><strong>{line.descriptionSnapshot}</strong><small>{line.quantity} รายการ · {formatBaht(line.unitPriceBaht)} / รายการ</small></dt>
                <dd>{formatBaht(line.lineTotalBaht)}</dd>
              </div>
            ))}
            <div><dt>ยอดรวมก่อนปรับ</dt><dd>{formatBaht(data.grossTotalBaht)}</dd></div>
            <div><dt>ปรับลด/ยกเว้น</dt><dd>{formatBaht(data.adjustmentTotalBaht)}</dd></div>
            <div className="invoice-total"><dt>ยอดที่ต้องชำระ</dt><dd>{formatBaht(data.netDueBaht)}</dd></div>
          </dl>
        </section>
        {jobPanel}
      </div>
    </Card>
  );
}

interface CheckoutJobPanelProps {
  data: CheckoutDto;
  panelRef: Ref<HTMLElement>;
  waitingForRole?: "assistant" | "doctor";
  disabled: boolean;
  canAction(action: CheckoutDto["allowedActions"][number]): boolean;
  finalizePending: boolean;
  cashPending: boolean;
  promptPayPending: boolean;
  closePending: boolean;
  manualReference: string;
  promptPayError?: string;
  onFinalize(): void;
  onOpenWaiver(mode: WaiverMode): void;
  onCash(): void;
  onPromptPay(): void;
  onClose(): void;
  onManualReferenceChange(value: string): void;
}

function CheckoutJobPanel({
  data,
  panelRef,
  waitingForRole,
  disabled,
  canAction,
  finalizePending,
  cashPending,
  promptPayPending,
  closePending,
  manualReference,
  promptPayError,
  onFinalize,
  onOpenWaiver,
  onCash,
  onPromptPay,
  onClose,
  onManualReferenceChange,
}: CheckoutJobPanelProps): ReactElement {
  const status = checkoutStatus(data);
  const hasCollectionAction = canAction("RECORD_CASH") || canAction("CONFIRM_PROMPTPAY") || canAction("APPROVE_FULL_WAIVER");
  const canClose = canAction("CLOSE_VISIT");
  const canReadOpd = canAction("READ_OPD");
  const waitingForDoctor = waitingForRole === "doctor";

  return (
    <section ref={panelRef} className="checkout-state-summary checkout-job-panel" aria-label="งานชำระเงินปัจจุบัน" tabIndex={-1}>
      <SectionHeading title="งานชำระเงินปัจจุบัน" description="สถานะและงานที่ระบบอนุญาตสำหรับ Visit นี้" />
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      <dl className="checkout-state-meta">
        <div><dt>สถานะรับชำระ</dt><dd>{collectionStateLabel(data)}</dd></div>
        <div><dt>หลักฐานยอด</dt><dd>{data.charge ? data.charge.id : "ยังไม่ยืนยันยอด"}</dd></div>
        <div><dt>ที่มารายการ</dt><dd>{sourceKindLabel(data)}</dd></div>
      </dl>
      <div className="checkout-job-body">
        {data.visit.status === "AWAITING_CHARGE" ? (
          canAction("FINALIZE_CHARGE") ? (
            <>
              <div><h3>ยืนยันยอด</h3><p>ยืนยันจากหลักฐานที่แสดงเพื่อเปิดขั้นตอนรับชำระ หรือยกเว้นเต็มจำนวนในคำสั่งเดียว</p></div>
              <div className="checkout-action-row">
                <ActionButton type="button" onClick={onFinalize} disabled={disabled}>{finalizePending ? "กำลังยืนยันยอด…" : "ยืนยันยอดเพื่อรับชำระ"}</ActionButton>
                <ActionButton type="button" variant="secondary" onClick={() => onOpenWaiver("finalize")} disabled={disabled}>ยกเว้นเต็มจำนวน</ActionButton>
              </div>
            </>
          ) : <p className="field-hint">{waitingForDoctor ? "รอแพทย์ยืนยันยอด" : "ระบบยังไม่อนุญาตให้ยืนยันยอด"}</p>
        ) : null}
        {data.visit.status === "AWAITING_PAYMENT" ? (
          <>
            <div><h3>รับชำระเงิน</h3><p>ยอดที่ส่งคำสั่งจะใช้ยอดสุทธิจากระบบโดยตรง</p></div>
            {hasCollectionAction ? <div className="checkout-payment-actions">
              {canAction("RECORD_CASH") ? <ActionButton type="button" onClick={onCash} disabled={disabled}>{cashPending ? "กำลังบันทึกเงินสด…" : `ยืนยันรับเงินสด ${formatBaht(data.netDueBaht)}`}</ActionButton> : null}
              {canAction("CONFIRM_PROMPTPAY") ? <div className="checkout-promptpay"><Field label="เลขอ้างอิง PromptPay" value={manualReference} error={promptPayError} onChange={(event) => onManualReferenceChange(event.target.value)} disabled={disabled} /><ActionButton type="button" variant="secondary" onClick={onPromptPay} disabled={disabled || !manualReference.trim()}>{promptPayPending ? "กำลังยืนยัน PromptPay…" : "ยืนยัน PromptPay"}</ActionButton></div> : null}
              {canAction("APPROVE_FULL_WAIVER") ? <ActionButton type="button" variant="secondary" onClick={() => onOpenWaiver("approve")} disabled={disabled}>ยกเว้นเต็มจำนวน</ActionButton> : null}
            </div> : <p className="field-hint">รอผู้มีสิทธิ์รับชำระจากระบบ</p>}
          </>
        ) : null}
        {data.visit.status === "READY_TO_CLOSE" ? (
          canClose ? <>
            <div><h3>ปิด Visit</h3><p>ระบบจะตรึงหลักฐาน Visit, Charge และการรับชำระที่แสดงไว้ในคำสั่งเดียว</p></div>
            <div className="checkout-action-row"><ActionButton type="button" onClick={onClose} disabled={disabled}>{closePending ? "กำลังปิด Visit…" : "ปิด Visit"}</ActionButton></div>
          </> : <p className="checkout-readonly-copy">{waitingForDoctor ? "รับชำระแล้ว รอแพทย์ปิด Visit" : "หลักฐานการเงินพร้อมแล้ว แต่สิทธิ์ปิด Visit ไม่พร้อม"}</p>
        ) : null}
        {data.visit.status === "CLOSED" ? <div className="checkout-action-row"><p className="checkout-readonly-copy">ปิด Visit แล้ว</p>{canReadOpd ? <Link className="care-button care-button-secondary" to={`/visits/${data.visit.id}/opd-card`}>เปิดบัตร OPD</Link> : null}</div> : null}
        {!(["AWAITING_CHARGE", "AWAITING_PAYMENT", "READY_TO_CLOSE", "CLOSED"] as string[]).includes(data.visit.status) ? <p className="field-hint">ยังไม่ถึงขั้นตอนชำระเงิน</p> : null}
      </div>
    </section>
  );
}

interface WaiverDialogProps {
  reason: string;
  reasonError?: string;
  commandError?: string;
  localError: string;
  authorized: boolean;
  stale: boolean;
  blocked: boolean;
  commandPending: boolean;
  reloadPending: boolean;
  onReasonChange(value: string): void;
  onClose(): void;
  onSubmit(): void;
  onReload(): void;
}

const waiverFocusableSelector = "textarea:not([disabled]), input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

function WaiverDialog({ reason, reasonError, commandError, localError, authorized, stale, blocked, commandPending, reloadPending, onReasonChange, onClose, onSubmit, onReload }: WaiverDialogProps): ReactElement {
  const dialogRef = useRef<HTMLElement>(null);
  const actionDisabled = commandPending || blocked || stale || !authorized;
  const unavailableMessage = stale
    ? "ข้อมูลการชำระเงินไม่เป็นปัจจุบัน จึงยังยกเว้นไม่ได้"
    : !authorized
      ? "สิทธิ์ยกเว้นเต็มจำนวนไม่พร้อมสำหรับสถานะล่าสุด"
      : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const reasonField = dialog?.querySelector<HTMLTextAreaElement>("#checkout-waiver-reason");
    (reasonField ?? dialog)?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(waiverFocusableSelector));
    if (focusable.includes(document.activeElement as HTMLElement)) return;
    (focusable[0] ?? dialog).focus();
  }, [authorized, blocked, commandPending, reloadPending, stale]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !commandPending) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(waiverFocusableSelector));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIsFocusable = focusable.includes(document.activeElement as HTMLElement);
    if (event.shiftKey && (document.activeElement === first || !activeIsFocusable)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeIsFocusable)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <section ref={dialogRef} className="care-card sign-dialog checkout-waiver-dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-waiver-title" aria-describedby="checkout-waiver-description" tabIndex={-1} onKeyDown={handleKeyDown}>
        <h2 id="checkout-waiver-title">ยกเว้นเต็มจำนวน</h2>
        <p id="checkout-waiver-description">เหตุผลจะถูกบันทึกเป็นหลักฐานการยกเว้นของ Visit นี้</p>
        <TextAreaField id="checkout-waiver-reason" name="waiverReason" label="เหตุผลการยกเว้น" value={reason} error={reasonError} onChange={(event) => onReasonChange(event.target.value)} disabled={actionDisabled} />
        {commandError ? <p className="field-error" role="alert">{commandError}</p> : null}
        {localError ? <p className="field-error" role="alert">{localError}</p> : null}
        {unavailableMessage ? <p className="field-hint" role="status">{unavailableMessage}</p> : null}
        <div className="dialog-actions">
          {blocked || stale ? <ActionButton type="button" variant="secondary" onClick={onReload} disabled={reloadPending}>{reloadPending ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</ActionButton> : null}
          <ActionButton type="button" variant="secondary" onClick={onClose} disabled={commandPending}>ยกเลิก</ActionButton>
          <ActionButton type="button" onClick={onSubmit} disabled={actionDisabled || !reason.trim()}>{commandPending ? "กำลังบันทึก…" : "ยืนยันยกเว้นเต็มจำนวน"}</ActionButton>
        </div>
      </section>
    </div>
  );
}

export function CheckoutScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const checkout = useCheckout(visitId);
  const journey = useVisitJourney(visitId);
  const finalize = useFinalizeCharge();
  const approveWaiver = useApproveWaiver();
  const recordCash = useRecordCash();
  const confirmPromptPay = useConfirmPromptPay();
  const closeVisit = useCloseVisit();
  const finalizeAttempt = useRef<FinalizeChargeAttempt | null>(null);
  const finalizeWaiverAttempt = useRef<SavedAttempt<FinalizeChargeAttempt> | null>(null);
  const approveWaiverAttempt = useRef<SavedAttempt<ApproveFullWaiverAttempt> | null>(null);
  const cashAttempt = useRef<RecordCashAttempt | null>(null);
  const promptPayAttempt = useRef<SavedAttempt<ConfirmPromptPayAttempt> | null>(null);
  const closeAttempt = useRef<CloseVisitAttempt | null>(null);
  const jobPanelRef = useRef<HTMLElement>(null);
  const waiverOpener = useRef<HTMLElement | null>(null);
  const waiverWasOpen = useRef(false);
  const [waiverMode, setWaiverMode] = useState<WaiverMode | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [commandError, setCommandError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (waiverMode) {
      waiverWasOpen.current = true;
      return;
    }
    if (!waiverWasOpen.current) return;
    waiverWasOpen.current = false;
    const opener = waiverOpener.current;
    waiverOpener.current = null;
    if (opener?.isConnected) {
      opener.focus();
      if (document.activeElement === opener) return;
    }
    jobPanelRef.current?.focus();
  }, [waiverMode]);

  const resetAttempts = () => {
    finalizeAttempt.current = null;
    finalizeWaiverAttempt.current = null;
    approveWaiverAttempt.current = null;
    cashAttempt.current = null;
    promptPayAttempt.current = null;
    closeAttempt.current = null;
  };

  const reload = async () => {
    const [checkoutResult, journeyResult] = await Promise.all([checkout.refetch(), journey.refetch()]);
    if (!checkoutResult.isSuccess || !journeyResult.isSuccess) return;
    resetAttempts();
    setBlocked(false);
    setCommandError(null);
    setLocalError("");
  };

  const commandPending = finalize.isPending || approveWaiver.isPending || recordCash.isPending || confirmPromptPay.isPending || closeVisit.isPending;
  const authorityUnavailable = journeyAuthorityUnavailable(journey);
  const stale = Boolean(checkout.error && checkout.data);
  const disabled = commandPending || stale || blocked || authorityUnavailable;
  const commandFailed = (error: unknown) => {
    setCommandError(error);
    if (isApiError(error) && error.status === 409) setBlocked(true);
  };
  const commandCommitted = () => {
    setCommandError(null);
    setLocalError("");
  };

  if (checkout.isPending) {
    return <div className="flow-page checkout-page"><PageHeader eyebrow="FINANCE · CHECKOUT" title="ชำระเงิน" description="หลักฐานยอดชำระจากระบบคลินิก" /><Card className="checkout-card"><p role="status">กำลังโหลดข้อมูลชำระเงิน…</p></Card></div>;
  }
  if (checkout.error && !checkout.data) {
    return <div className="flow-page checkout-page"><PageHeader eyebrow="FINANCE · CHECKOUT" title="ชำระเงิน" description="หลักฐานยอดชำระจากระบบคลินิก" /><CheckoutUnavailable error={checkout.error} onReload={() => void reload()} /></div>;
  }
  if (!checkout.data) {
    return <div className="flow-page checkout-page"><PageHeader eyebrow="FINANCE · CHECKOUT" title="ชำระเงิน" description="หลักฐานยอดชำระจากระบบคลินิก" /><Card className="checkout-card"><section className="workflow-blocked workflow-blocked-unavailable" role="alert"><div><h2>ไม่พบข้อมูลการชำระเงิน</h2><p>กรุณาโหลดข้อมูลล่าสุดก่อนดำเนินการต่อ</p></div></section></Card></div>;
  }

  const data = checkout.data;
  const canAction = (action: CheckoutDto["allowedActions"][number]) => {
    const journeyAction = journeyActionForCheckout(action);
    return !authorityUnavailable && Boolean(journeyAction && journey.data?.allowedActions.includes(journeyAction));
  };
  const waiverAuthorized = waiverMode ? canAction(waiverMode === "finalize" ? "FINALIZE_CHARGE" : "APPROVE_FULL_WAIVER") : false;
  const fieldErrors = {
    waiver: fieldError(commandError, waiverMode === "finalize" ? "payload.waiverReason" : "payload.reason"),
    promptPay: fieldError(commandError, "payload.manualReference"),
  };

  const submitFinalize = () => {
    if (disabled || !canAction("FINALIZE_CHARGE")) return;
    setCommandError(null);
    setLocalError("");
    finalizeAttempt.current ??= createFinalizeChargeAttempt(data);
    finalize.mutate(
      { visitId: data.visit.id, attempt: finalizeAttempt.current },
      {
        onSuccess: () => { finalizeAttempt.current = null; commandCommitted(); },
        onError: commandFailed,
      },
    );
  };

  const openWaiver = (mode: WaiverMode) => {
    if (disabled || !canAction(mode === "finalize" ? "FINALIZE_CHARGE" : "APPROVE_FULL_WAIVER")) return;
    waiverOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLocalError("");
    setCommandError(null);
    setWaiverMode(mode);
  };

  const closeWaiver = () => {
    if (commandPending) return;
    setWaiverMode(null);
  };

  const submitWaiver = () => {
    if (disabled || !waiverMode || !waiverAuthorized) return;
    const reason = waiverReason.trim();
    if (!reason) { setLocalError("กรุณาระบุเหตุผลการยกเว้น"); return; }
    setCommandError(null);
    setLocalError("");
    if (waiverMode === "finalize") {
      if (!canAction("FINALIZE_CHARGE")) return;
      const fingerprint = reason;
      if (!finalizeWaiverAttempt.current || finalizeWaiverAttempt.current.fingerprint !== fingerprint) {
        finalizeWaiverAttempt.current = { fingerprint, attempt: createFinalizeFullWaiverAttempt(data, waiverReason) };
      }
      finalize.mutate(
        { visitId: data.visit.id, attempt: finalizeWaiverAttempt.current.attempt },
        {
          onSuccess: () => { finalizeWaiverAttempt.current = null; setWaiverMode(null); commandCommitted(); },
          onError: commandFailed,
        },
      );
      return;
    }
    if (!canAction("APPROVE_FULL_WAIVER")) return;
    const fingerprint = reason;
    if (!approveWaiverAttempt.current || approveWaiverAttempt.current.fingerprint !== fingerprint) {
      approveWaiverAttempt.current = { fingerprint, attempt: createApproveFullWaiverAttempt(data, waiverReason) };
    }
    approveWaiver.mutate(
      { visitId: data.visit.id, attempt: approveWaiverAttempt.current.attempt },
      {
        onSuccess: () => { approveWaiverAttempt.current = null; setWaiverMode(null); commandCommitted(); },
        onError: commandFailed,
      },
    );
  };

  const submitCash = () => {
    if (disabled || !canAction("RECORD_CASH")) return;
    setCommandError(null);
    setLocalError("");
    cashAttempt.current ??= createRecordCashAttempt(data);
    recordCash.mutate(
      { visitId: data.visit.id, attempt: cashAttempt.current },
      { onSuccess: () => { cashAttempt.current = null; commandCommitted(); }, onError: commandFailed },
    );
  };

  const submitPromptPay = () => {
    if (disabled || !canAction("CONFIRM_PROMPTPAY")) return;
    const reference = manualReference.trim();
    if (!reference) { setLocalError("กรุณาระบุเลขอ้างอิง PromptPay"); return; }
    setCommandError(null);
    setLocalError("");
    if (!promptPayAttempt.current || promptPayAttempt.current.fingerprint !== reference) {
      promptPayAttempt.current = { fingerprint: reference, attempt: createConfirmPromptPayAttempt(data, manualReference) };
    }
    confirmPromptPay.mutate(
      { visitId: data.visit.id, attempt: promptPayAttempt.current.attempt },
      { onSuccess: () => { promptPayAttempt.current = null; commandCommitted(); }, onError: commandFailed },
    );
  };

  const submitClose = () => {
    if (disabled || !canAction("CLOSE_VISIT")) return;
    setCommandError(null);
    setLocalError("");
    closeAttempt.current ??= createCloseVisitAttempt(data);
    closeVisit.mutate(
      { visitId: data.visit.id, attempt: closeAttempt.current },
      { onSuccess: () => { closeAttempt.current = null; commandCommitted(); }, onError: commandFailed },
    );
  };

  return (
    <div className="flow-page checkout-page">
      <PageHeader eyebrow="FINANCE · CHECKOUT" title="ชำระเงิน" description="ตรวจสอบหลักฐานยอดชำระและดำเนินการตามสิทธิ์ที่ระบบอนุญาต" />
      {journey.data ? <><VisitJourneyRibbon steps={journey.data.steps} /><JourneyNextTaskCard summary={journey.data} visitId={data.visit.id} currentRole={auth.session?.user.role ?? "assistant"} authorityReady={!authorityUnavailable} /></> : null}
      {authorityUnavailable ? <JourneyAuthorityBanner error={journey.error} fetching={journey.isFetching} onReload={() => void journey.refetch()} /> : null}
      {stale ? <div className="checkout-stale" role="alert"><strong>ข้อมูลการชำระเงินอาจไม่เป็นปัจจุบัน</strong><span>{commandMessage(checkout.error)}</span><ActionButton type="button" variant="secondary" onClick={() => void reload()} disabled={checkout.isFetching}>โหลดข้อมูลล่าสุด</ActionButton></div> : null}
      {(commandError || localError) && !waiverMode ? <div className="checkout-command-error" role="alert"><strong>{localError || commandMessage(commandError)}</strong>{blocked ? <span>คำสั่งถูกระงับจนกว่าจะโหลดข้อมูลล่าสุด</span> : null}{blocked ? <ActionButton type="button" variant="secondary" onClick={() => void reload()} disabled={checkout.isFetching}>โหลดข้อมูลล่าสุด</ActionButton> : null}</div> : null}
      <CheckoutEvidence data={data} jobPanel={<CheckoutJobPanel
        data={data}
        panelRef={jobPanelRef}
        waitingForRole={journey.data?.nextTask?.primaryRole}
        disabled={disabled}
        canAction={canAction}
        finalizePending={finalize.isPending}
        cashPending={recordCash.isPending}
        promptPayPending={confirmPromptPay.isPending}
        closePending={closeVisit.isPending}
        manualReference={manualReference}
        promptPayError={fieldErrors.promptPay}
        onFinalize={submitFinalize}
        onOpenWaiver={openWaiver}
        onCash={submitCash}
        onPromptPay={submitPromptPay}
        onClose={submitClose}
        onManualReferenceChange={(value) => { promptPayAttempt.current = null; setManualReference(value); setCommandError(null); setLocalError(""); }}
      />} />
      {waiverMode ? <WaiverDialog
        reason={waiverReason}
        reasonError={fieldErrors.waiver}
        commandError={commandError ? commandMessage(commandError) : undefined}
        localError={localError}
        authorized={waiverAuthorized}
        stale={stale}
        blocked={blocked}
        commandPending={commandPending}
        reloadPending={checkout.isFetching}
        onReasonChange={(value) => { if (waiverMode === "finalize") finalizeWaiverAttempt.current = null; else approveWaiverAttempt.current = null; setWaiverReason(value); setCommandError(null); setLocalError(""); }}
        onClose={closeWaiver}
        onSubmit={submitWaiver}
        onReload={() => void reload()}
      /> : null}
    </div>
  );
}
