import { Barcode, ClipboardList, PackageCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import type { FulfillmentPickListDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { ActionButton, Card, PageHeader, SectionHeading, StatusBadge, TextAreaField } from "../components/careflow/ui";
import { createAbandonPreparationAttempt, createCompletePreparationAttempt, createConfirmAllocationAttempt, createHandoffAttempt, createRejectAttempt, createReleaseAttempt, createReserveDispensingAttempt, useAbandonPreparation, useCompletePreparation, useConfirmAllocation, useDispensingPickList, useHandoff, useReject, useRelease, useReserveDispensing } from "../features/dispensing";
import { isApiError } from "../lib/api-error";

function errorMessage(error: unknown): string { return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อรายการจัดยาได้ กรุณาลองใหม่อีกครั้ง"; }
function tone(status: FulfillmentPickListDto["visit"]["status"]): "waiting" | "active" | "success" | "error" | "info" {
  if (status === "PREPARING") return "active";
  if (status === "AWAITING_PREPARATION") return "waiting";
  if (status === "AWAITING_RELEASE" || status === "AWAITING_HANDOFF") return "success";
  return "info";
}
function allowed(data: FulfillmentPickListDto, action: FulfillmentPickListDto["allowedActions"][number]) { return data.allowedActions.includes(action); }

export function DispensingScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const pickList = useDispensingPickList(visitId);
  const reserve = useReserveDispensing(); const confirm = useConfirmAllocation(); const complete = useCompletePreparation(); const abandon = useAbandonPreparation(); const release = useRelease(); const reject = useReject(); const handoff = useHandoff();
  const scannerRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState(""); const [manualReason, setManualReason] = useState(""); const [abandonReason, setAbandonReason] = useState(""); const [rejectReason, setRejectReason] = useState(""); const [localError, setLocalError] = useState("");
  const canPrepare = auth.session?.permissions.includes("fulfillment:prepare") ?? false;
  const canRelease = auth.session?.permissions.includes("fulfillment:release") ?? false;
  const canHandoff = auth.session?.permissions.includes("fulfillment:handoff") ?? false;

  useEffect(() => { if (pickList.data?.visit.status === "PREPARING") scannerRef.current?.focus(); }, [pickList.data?.visit.status]);
  if (pickList.isPending) return <div className="flow-page dispensing-page"><PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" description="รายการจัดยาจากคำสั่งที่ลงนามแล้ว" /><Card><p role="status">กำลังโหลด Pick List…</p></Card></div>;
  if (pickList.error || !pickList.data) return <div className="flow-page dispensing-page"><PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" /><Card><section className="workflow-blocked workflow-blocked-unavailable" role="alert"><p>{pickList.error ? errorMessage(pickList.error) : "ไม่พบข้อมูลรายการจัดยา"}</p><button className="inline-retry-button" type="button" onClick={() => void pickList.refetch()}>โหลดข้อมูลล่าสุด</button></section></Card></div>;
  const data = pickList.data; const preparation = data.preparation?.status === "ACTIVE" ? data.preparation : null; const allocations = data.reservation?.allocations ?? [];
  const confirmed = new Set(preparation?.confirmations.map((item) => item.allocationId) ?? []); const pending = allocations.find((item) => !confirmed.has(item.id)) ?? null;
  const mutationError = reserve.error || confirm.error || complete.error || abandon.error || release.error || reject.error || handoff.error; const message = localError || (mutationError ? errorMessage(mutationError) : "");
  const focusScannerIfPending = (next: FulfillmentPickListDto) => {
    const nextPreparation = next.preparation?.status === "ACTIVE" ? next.preparation : null;
    const nextAllocations = next.reservation?.allocations ?? [];
    const nextConfirmed = new Set(nextPreparation?.confirmations.map((item) => item.allocationId) ?? []);
    if (next.visit.status === "PREPARING" && nextPreparation && nextAllocations.some((item) => !nextConfirmed.has(item.id))) {
      window.setTimeout(() => scannerRef.current?.focus(), 0);
    }
  };
  const start = () => { if (!canPrepare || !allowed(data, "START_PREPARATION")) return; setLocalError(""); reserve.mutate({ visitId: data.visit.id, attempt: createReserveDispensingAttempt(data) }); };
  const submitBarcode = () => {
    if (!preparation || !pending || !canPrepare || !allowed(data, "CONFIRM_ALLOCATION")) return;
    const barcode = scan.trim().toUpperCase();
    const allocation = data.label?.items
      .filter((item) => item.internalBarcode === barcode)
      .map((item) => allocations.find((candidate) => candidate.orderItemId === item.orderItemId && !confirmed.has(candidate.id)))
      .find((candidate) => candidate !== undefined) ?? null;
    if (!allocation) { setLocalError("บาร์โค้ดไม่ตรงกับรายการจัดยา"); scannerRef.current?.focus(); return; }
    setLocalError(""); setScan(""); confirm.mutate({ visitId: data.visit.id, attempt: createConfirmAllocationAttempt(data, { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode }) }, { onSuccess: (result) => focusScannerIfPending(result.data), onError: () => focusScannerIfPending(data) });
  };
  const submitManual = () => {
    if (!preparation || !pending || !manualReason.trim() || !canPrepare || !allowed(data, "CONFIRM_ALLOCATION")) return;
    setLocalError(""); confirm.mutate({ visitId: data.visit.id, attempt: createConfirmAllocationAttempt(data, { method: "MANUAL", preparationId: preparation.id, allocationId: pending.id, reason: manualReason }) }, { onSuccess: (result) => { setManualReason(""); focusScannerIfPending(result.data); }, onError: () => focusScannerIfPending(data) });
  };
  const finish = () => { if (!preparation || !canPrepare || !allowed(data, "COMPLETE_PREPARATION")) return; if (confirmed.size !== allocations.length) { setLocalError("ยืนยันรายการจัดยาไม่ครบ"); return; } setLocalError(""); complete.mutate({ visitId: data.visit.id, attempt: createCompletePreparationAttempt(data) }); };
  const cancelPreparation = () => { if (!preparation || !canPrepare || !allowed(data, "ABANDON_PREPARATION")) return; if (!abandonReason.trim()) { setLocalError("กรุณาระบุเหตุผลการยกเลิกการเตรียมยา"); return; } setLocalError(""); abandon.mutate({ visitId: data.visit.id, attempt: createAbandonPreparationAttempt(data, abandonReason) }, { onSuccess: () => setAbandonReason("") }); };
  const releaseMedication = () => { if (!canRelease || !allowed(data, "RELEASE")) return; setLocalError(""); release.mutate({ visitId: data.visit.id, attempt: createReleaseAttempt(data) }); };
  const rejectMedication = () => { if (!canRelease || !allowed(data, "REJECT")) return; if (!rejectReason.trim()) { setLocalError("กรุณาระบุเหตุผลการปฏิเสธ"); return; } setLocalError(""); reject.mutate({ visitId: data.visit.id, attempt: createRejectAttempt(data, rejectReason) }, { onSuccess: () => setRejectReason("") }); };
  const handoffMedication = () => { if (!canHandoff || !allowed(data, "HANDOFF")) return; setLocalError(""); handoff.mutate({ visitId: data.visit.id, attempt: createHandoffAttempt(data) }); };

  return <div className="flow-page dispensing-page">
    <PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" description="ตรวจสอบฉลากที่ลงนามและยืนยันล็อตตามรายการที่ระบบจัดสรร" />
    <Card className="dispensing-body"><div className="patient-header"><div className="patient-header-copy"><strong>{data.patient.displayName}</strong><span>HN {data.patient.hn} · Visit {data.visit.id}</span></div><StatusBadge tone={tone(data.visit.status)}>{data.visit.status}</StatusBadge></div><div className="dispensing-meta"><span>Visit revision {data.visit.revision}</span><span>{data.medicationDecision ? `Order v${data.medicationDecision.version}` : "ไม่มีคำสั่งยา"}</span></div></Card>
    <Card className="dispensing-body"><SectionHeading icon={ClipboardList} title="คำสั่งยาและฉลากที่ลงนาม" description="ใช้เฉพาะ Label เวอร์ชันปัจจุบันที่ระบบยืนยัน" />{data.label ? <div className="signed-next-actions"><span><strong>Label v{data.label.version}</strong><small>{data.label.items.map((item) => item.internalBarcode).join(" · ")}</small></span><Link className="care-button care-button-secondary" to={`/dispensing/${data.visit.id}/labels`}>เปิดฉลากยา</Link></div> : <p className="field-error" role="alert">ฉลากปัจจุบันไม่พร้อมใช้งาน กรุณากลับไปตรวจสอบคำสั่งยา</p>}</Card>
    {data.visit.status === "AWAITING_PREPARATION" ? <Card className="dispensing-body"><SectionHeading icon={PackageCheck} title="เริ่มเตรียมยา" description="ระบบจะกันสต็อกและสร้างรายการยืนยันสำหรับการจัดยา" />{canPrepare && allowed(data, "START_PREPARATION") ? <div className="dispense-footer"><p>เริ่มเมื่อพร้อมเตรียมยา โดยใช้ Label ปัจจุบันเท่านั้น</p><ActionButton type="button" icon={PackageCheck} onClick={start} disabled={reserve.isPending || !data.label}>{reserve.isPending ? "กำลังเริ่ม…" : "เริ่มเตรียมยา"}</ActionButton></div> : <p className="field-hint">รอผู้มีสิทธิ์เริ่มการเตรียมยา</p>}</Card> : null}
    {data.visit.status === "PREPARING" && preparation ? <Card className="dispensing-body"><SectionHeading icon={Barcode} title="ยืนยันรายการจัดยา" description="สแกนบาร์โค้ดยาแล้วกด Enter; ระบบจะยืนยันเฉพาะ allocation ที่ตรงกัน" /><label className="field"><span className="field-label">สแกนบาร์โค้ดยา</span><input ref={scannerRef} className="care-input" value={scan} onChange={(event) => { setScan(event.target.value); setLocalError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitBarcode(); } }} disabled={!canPrepare || !allowed(data, "CONFIRM_ALLOCATION") || confirm.isPending} /></label><div className="medication-list" aria-label="รายการ allocation">{allocations.map((item) => <article className={`medication-card ${confirmed.has(item.id) ? "medication-ready" : ""}`} key={item.id}><span className="medication-check" aria-hidden="true"><PackageCheck size={17} /></span><div className="medication-copy"><strong>{item.displayNameSnapshot} · {item.strengthSnapshot}</strong><small>{item.dosageFormSnapshot} · บาร์โค้ด {item.internalBarcode}</small><small>ล็อต {item.lotNumberSnapshot} · หมดอายุ {item.expiryDateSnapshot} · Order item {item.orderItemId}</small><em>จำนวน {item.quantity} {item.unitSnapshot}</em></div><StatusBadge tone={confirmed.has(item.id) ? "success" : "waiting"}>{confirmed.has(item.id) ? "ยืนยันแล้ว" : "รอยืนยัน"}</StatusBadge></article>)}</div>{pending && canPrepare && allowed(data, "CONFIRM_ALLOCATION") ? <><TextAreaField label="เหตุผลการยืนยันด้วยตนเอง" value={manualReason} onChange={(event) => { setManualReason(event.target.value); setLocalError(""); }} disabled={confirm.isPending} /><div className="dispense-footer"><p>ใช้เมื่อสแกนไม่ได้ และเหตุผลจะถูกบันทึกกับ allocation ที่ยังรอยืนยัน</p><ActionButton type="button" variant="secondary" onClick={submitManual} disabled={confirm.isPending || !manualReason.trim()}>ยืนยันด้วยตนเอง</ActionButton></div></> : null}<div className="dispense-footer"><p>{confirmed.size}/{allocations.length} รายการได้รับการยืนยัน</p><ActionButton type="button" onClick={finish} disabled={complete.isPending || !canPrepare || !allowed(data, "COMPLETE_PREPARATION")}>{complete.isPending ? "กำลังบันทึก…" : "เสร็จสิ้นการเตรียมยา"}</ActionButton></div>{canPrepare && allowed(data, "ABANDON_PREPARATION") ? <><TextAreaField label="เหตุผลการยกเลิกการเตรียมยา" value={abandonReason} onChange={(event) => { setAbandonReason(event.target.value); setLocalError(""); }} disabled={abandon.isPending} /><div className="dispense-footer"><p>การยกเลิกจะคืนการกันสต็อกและทำให้ฉลาก/รายการเตรียมปัจจุบันใช้ต่อไม่ได้</p><ActionButton type="button" variant="danger" onClick={cancelPreparation} disabled={abandon.isPending || !abandonReason.trim()}>{abandon.isPending ? "กำลังยกเลิก…" : "ยกเลิกการเตรียมยา"}</ActionButton></div></> : null}</Card> : null}
    {data.visit.status === "AWAITING_RELEASE" ? <Card className="dispensing-body"><SectionHeading title="ตรวจปล่อยยา" description="การเตรียมยาเสร็จแล้ว รอแพทย์ตรวจปล่อย" />{canRelease && (allowed(data, "RELEASE") || allowed(data, "REJECT")) ? <><div className="dispense-footer"><p>ยืนยันว่า Label, print request, allocation และล็อตที่จัดไว้ถูกต้องก่อนปล่อยยา</p><ActionButton type="button" onClick={releaseMedication} disabled={release.isPending || !allowed(data, "RELEASE")}>{release.isPending ? "กำลังปล่อย…" : "ปล่อยยา"}</ActionButton></div><TextAreaField label="เหตุผลการปฏิเสธ" value={rejectReason} onChange={(event) => { setRejectReason(event.target.value); setLocalError(""); }} disabled={reject.isPending} /><div className="dispense-footer"><p>การปฏิเสธจะคืนการกันสต็อก แต่ต้องมีคำขอพิมพ์ฉลากใหม่ก่อนเตรียมอีกครั้ง</p><ActionButton type="button" variant="danger" onClick={rejectMedication} disabled={reject.isPending || !allowed(data, "REJECT") || !rejectReason.trim()}>{reject.isPending ? "กำลังปฏิเสธ…" : "ปฏิเสธการจัดยา"}</ActionButton></div></> : <p className="field-hint">รอแพทย์ตรวจปล่อยยา</p>}</Card> : null}
    {data.visit.status === "AWAITING_HANDOFF" ? <Card className="dispensing-body"><SectionHeading title="ส่งมอบยา" description="ยาได้รับการตรวจปล่อยแล้ว" />{canHandoff && allowed(data, "HANDOFF") ? <div className="dispense-footer"><p>ยืนยันการส่งมอบครั้งนี้ ระบบจะบันทึก Dispense และตัดสต็อกทันที</p><ActionButton type="button" onClick={handoffMedication} disabled={handoff.isPending}>{handoff.isPending ? "กำลังส่งมอบ…" : "ยืนยันส่งมอบยา"}</ActionButton></div> : <p className="field-hint">รอขั้นตอนส่งมอบยา</p>}</Card> : null}
    {data.visit.status === "AWAITING_CHARGE" ? <Card className="dispensing-body"><SectionHeading title="จัดยาและส่งมอบแล้ว" description="ระบบบันทึกการตัดสต็อกและเปลี่ยน Visit ไปยังขั้นตอนคิดเงินแล้ว" />{data.dispense ? <p className="empty-detail">Dispense {data.dispense.id} · {data.dispense.lines.length} รายการตัดสต็อกแล้ว</p> : <p className="empty-detail">พร้อมส่งต่อไปยังขั้นตอนคิดเงิน</p>}<Link className="care-button care-button-secondary" to={`/checkout/${data.visit.id}`}>ไปหน้าชำระเงิน</Link></Card> : null}
    {message ? <p className="field-error" role="alert">{message}</p> : null}
  </div>;
}
