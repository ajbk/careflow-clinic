import type { ReactElement } from "react";
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { CheckoutDto } from "../../shared/contracts";
import { ActionButton, Card, Field, PageHeader, SectionHeading, StatusBadge, TextAreaField } from "../components/careflow/ui";
import {
  createApproveFullWaiverAttempt,
  createConfirmPromptPayAttempt,
  createFinalizeChargeAttempt,
  createFinalizeFullWaiverAttempt,
  createRecordCashAttempt,
  useApproveWaiver,
  useCheckout,
  useConfirmPromptPay,
  useFinalizeCharge,
  useRecordCash,
  type ApproveFullWaiverAttempt,
  type ConfirmPromptPayAttempt,
  type FinalizeChargeAttempt,
  type RecordCashAttempt,
} from "../features/finance";
import { isApiError } from "../lib/api-error";

type WaiverMode = "finalize" | "approve";
type SavedAttempt<T> = { fingerprint: string; attempt: T };

const bahtFormatter = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

function formatBaht(value: number): string {
  return `${bahtFormatter.format(value)} บาท`;
}

function checkoutStatus(data: CheckoutDto): { label: string; tone: "waiting" | "active" | "success" | "neutral" } {
  if (data.visit.status === "AWAITING_CHARGE") return { label: "รอยืนยันยอด", tone: "waiting" };
  if (data.visit.status === "AWAITING_PAYMENT") return { label: "รอรับชำระ", tone: "active" };
  if (data.visit.status === "READY_TO_CLOSE") return { label: "พร้อมปิด Visit", tone: "success" };
  if (data.visit.status === "CLOSED") return { label: "Visit ปิดแล้ว", tone: "neutral" };
  return { label: data.visit.status, tone: "neutral" };
}

function commandMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

function fieldError(error: unknown, field: string): string | undefined {
  return isApiError(error) ? error.fieldErrors?.[field] : undefined;
}

function can(data: CheckoutDto, action: CheckoutDto["allowedActions"][number]): boolean {
  return data.allowedActions.includes(action);
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

function CheckoutEvidence({ data }: { data: CheckoutDto }): ReactElement {
  const status = checkoutStatus(data);
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
        <section className="checkout-state-summary" aria-label="สถานะการชำระเงิน">
          <SectionHeading title="สถานะการชำระเงิน" description="สถานะและสิทธิ์ที่ระบบอนุญาตสำหรับ Visit นี้" />
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <dl className="checkout-state-meta">
            <div><dt>Collection</dt><dd>{data.collectionState}</dd></div>
            <div><dt>Charge</dt><dd>{data.charge ? data.charge.id : "ยังไม่ยืนยันยอด"}</dd></div>
            <div><dt>Source</dt><dd>{data.sourceKind}</dd></div>
          </dl>
        </section>
      </div>
    </Card>
  );
}

function ReadOnlyState({ data }: { data: CheckoutDto }): ReactElement | null {
  if (data.visit.status === "READY_TO_CLOSE") {
    return <Card className="checkout-card checkout-readonly"><p>รับชำระแล้ว รอแพทย์ปิด Visit</p></Card>;
  }
  if (data.visit.status === "CLOSED") {
    return <Card className="checkout-card checkout-readonly"><p>ปิด Visit แล้ว</p></Card>;
  }
  return null;
}

export function CheckoutScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const checkout = useCheckout(visitId);
  const finalize = useFinalizeCharge();
  const approveWaiver = useApproveWaiver();
  const recordCash = useRecordCash();
  const confirmPromptPay = useConfirmPromptPay();
  const finalizeAttempt = useRef<FinalizeChargeAttempt | null>(null);
  const finalizeWaiverAttempt = useRef<SavedAttempt<FinalizeChargeAttempt> | null>(null);
  const approveWaiverAttempt = useRef<SavedAttempt<ApproveFullWaiverAttempt> | null>(null);
  const cashAttempt = useRef<RecordCashAttempt | null>(null);
  const promptPayAttempt = useRef<SavedAttempt<ConfirmPromptPayAttempt> | null>(null);
  const [waiverMode, setWaiverMode] = useState<WaiverMode | null>(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [manualReference, setManualReference] = useState("");
  const [commandError, setCommandError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState(false);
  const [localError, setLocalError] = useState("");

  const resetAttempts = () => {
    finalizeAttempt.current = null;
    finalizeWaiverAttempt.current = null;
    approveWaiverAttempt.current = null;
    cashAttempt.current = null;
    promptPayAttempt.current = null;
  };

  const reload = async () => {
    const result = await checkout.refetch();
    if (!result.isSuccess) return;
    resetAttempts();
    setBlocked(false);
    setCommandError(null);
    setLocalError("");
  };

  const commandPending = finalize.isPending || approveWaiver.isPending || recordCash.isPending || confirmPromptPay.isPending;
  const stale = Boolean(checkout.error && checkout.data);
  const disabled = commandPending || stale || blocked;
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
  const fieldErrors = {
    waiver: fieldError(commandError, waiverMode === "finalize" ? "payload.waiverReason" : "payload.reason"),
    promptPay: fieldError(commandError, "payload.manualReference"),
  };

  const submitFinalize = () => {
    if (disabled || !can(data, "FINALIZE_CHARGE")) return;
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
    if (disabled) return;
    setLocalError("");
    setCommandError(null);
    setWaiverMode(mode);
  };

  const submitWaiver = () => {
    if (disabled || !waiverMode) return;
    const reason = waiverReason.trim();
    if (!reason) { setLocalError("กรุณาระบุเหตุผลการยกเว้น"); return; }
    setCommandError(null);
    setLocalError("");
    if (waiverMode === "finalize") {
      if (!can(data, "FINALIZE_CHARGE")) return;
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
    if (!can(data, "APPROVE_FULL_WAIVER")) return;
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
    if (disabled || !can(data, "RECORD_CASH")) return;
    setCommandError(null);
    setLocalError("");
    cashAttempt.current ??= createRecordCashAttempt(data);
    recordCash.mutate(
      { visitId: data.visit.id, attempt: cashAttempt.current },
      { onSuccess: () => { cashAttempt.current = null; commandCommitted(); }, onError: commandFailed },
    );
  };

  const submitPromptPay = () => {
    if (disabled || !can(data, "CONFIRM_PROMPTPAY")) return;
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

  return (
    <div className="flow-page checkout-page">
      <PageHeader eyebrow="FINANCE · CHECKOUT" title="ชำระเงิน" description="ตรวจสอบหลักฐานยอดชำระและดำเนินการตามสิทธิ์ที่ระบบอนุญาต" />
      {stale ? <div className="checkout-stale" role="alert"><strong>ข้อมูลการชำระเงินอาจไม่เป็นปัจจุบัน</strong><span>{commandMessage(checkout.error)}</span><ActionButton type="button" variant="secondary" onClick={() => void reload()} disabled={checkout.isFetching}>โหลดข้อมูลล่าสุด</ActionButton></div> : null}
      {(commandError || localError) && !waiverMode ? <div className="checkout-command-error" role="alert"><strong>{localError || commandMessage(commandError)}</strong>{blocked ? <span>คำสั่งถูกระงับจนกว่าจะโหลดข้อมูลล่าสุด</span> : null}{blocked ? <ActionButton type="button" variant="secondary" onClick={() => void reload()} disabled={checkout.isFetching}>โหลดข้อมูลล่าสุด</ActionButton> : null}</div> : null}
      <CheckoutEvidence data={data} />
      <ReadOnlyState data={data} />
      {data.visit.status === "AWAITING_CHARGE" ? (
        <Card className="checkout-card checkout-actions">
          <SectionHeading title="ยืนยันยอด" description="ยืนยันยอดจากหลักฐานที่แสดงเพื่อเปิดขั้นตอนรับชำระ หรือยกเว้นเต็มจำนวนในคำสั่งเดียว" />
          {can(data, "FINALIZE_CHARGE") ? <div className="checkout-action-row"><ActionButton type="button" onClick={submitFinalize} disabled={disabled}>{finalize.isPending ? "กำลังยืนยันยอด…" : "ยืนยันยอดเพื่อรับชำระ"}</ActionButton><ActionButton type="button" variant="secondary" onClick={() => openWaiver("finalize")} disabled={disabled}>ยกเว้นเต็มจำนวน</ActionButton></div> : <p className="field-hint">รอผู้มีสิทธิ์ยืนยันยอดจากระบบ</p>}
        </Card>
      ) : null}
      {data.visit.status === "AWAITING_PAYMENT" ? (
        <Card className="checkout-card checkout-actions">
          <SectionHeading title="รับชำระเงิน" description="ยอดที่ส่งคำสั่งจะใช้ยอดสุทธิจากระบบโดยตรง" />
          <div className="checkout-payment-actions">
            {can(data, "RECORD_CASH") ? <ActionButton type="button" onClick={submitCash} disabled={disabled}>{recordCash.isPending ? "กำลังบันทึกเงินสด…" : `ยืนยันรับเงินสด ${formatBaht(data.netDueBaht)}`}</ActionButton> : null}
            {can(data, "CONFIRM_PROMPTPAY") ? <div className="checkout-promptpay"><Field label="เลขอ้างอิง PromptPay" value={manualReference} error={fieldErrors.promptPay} onChange={(event) => { promptPayAttempt.current = null; setManualReference(event.target.value); setCommandError(null); setLocalError(""); }} disabled={disabled} /><ActionButton type="button" variant="secondary" onClick={submitPromptPay} disabled={disabled || !manualReference.trim()}>{confirmPromptPay.isPending ? "กำลังยืนยัน PromptPay…" : "ยืนยัน PromptPay"}</ActionButton></div> : null}
            {can(data, "APPROVE_FULL_WAIVER") ? <ActionButton type="button" variant="secondary" onClick={() => openWaiver("approve")} disabled={disabled}>ยกเว้นเต็มจำนวน</ActionButton> : null}
          </div>
          {!can(data, "RECORD_CASH") && !can(data, "CONFIRM_PROMPTPAY") && !can(data, "APPROVE_FULL_WAIVER") ? <p className="field-hint">รอผู้มีสิทธิ์รับชำระจากระบบ</p> : null}
        </Card>
      ) : null}
      {waiverMode ? <div className="dialog-backdrop"><section className="care-card sign-dialog checkout-waiver-dialog" role="dialog" aria-modal="true" aria-label="ยกเว้นเต็มจำนวน"><h2>ยกเว้นเต็มจำนวน</h2><p>เหตุผลจะถูกบันทึกเป็นหลักฐานการยกเว้นของ Visit นี้</p><TextAreaField label="เหตุผลการยกเว้น" value={waiverReason} error={fieldErrors.waiver} onChange={(event) => { if (waiverMode === "finalize") finalizeWaiverAttempt.current = null; else approveWaiverAttempt.current = null; setWaiverReason(event.target.value); setCommandError(null); setLocalError(""); }} disabled={disabled} />{commandError ? <p className="field-error" role="alert">{commandMessage(commandError)}</p> : null}{localError ? <p className="field-error" role="alert">{localError}</p> : null}<div className="dialog-actions"><ActionButton type="button" variant="secondary" onClick={() => setWaiverMode(null)} disabled={commandPending}>ยกเลิก</ActionButton><ActionButton type="button" onClick={submitWaiver} disabled={disabled || !waiverReason.trim()}>{finalize.isPending || approveWaiver.isPending ? "กำลังบันทึก…" : "ยืนยันยกเว้นเต็มจำนวน"}</ActionButton></div></section></div> : null}
    </div>
  );
}
