import { ClipboardList, PackageCheck, ShieldCheck } from "lucide-react";
import { useRef, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import type { InventoryPickListDto, InventoryReservationAllocationDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { ActionButton, Card, PageHeader, SectionHeading, StatusBadge, TextAreaField } from "../components/careflow/ui";
import { createReleaseDispensingAttempt, createReserveDispensingAttempt, useDispensingPickList, useReleaseDispensing, useReserveDispensing, type ReleaseDispensingAttempt, type ReserveDispensingAttempt } from "../features/dispensing";
import { isApiError } from "../lib/api-error";
import { formatThaiDate } from "../lib/thai-date";

function errorMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อรายการจัดยาได้ กรุณาลองใหม่อีกครั้ง";
}

function statusTone(status: InventoryPickListDto["visit"]["status"]): "waiting" | "active" | "success" | "error" | "info" {
  if (status === "PREPARING") return "active";
  if (status === "AWAITING_PREPARATION") return "waiting";
  if (status === "AWAITING_ORDER_REVISION") return "error";
  return "info";
}

function allocationsFor(allocationRows: InventoryReservationAllocationDto[], medicationId: string): InventoryReservationAllocationDto[] {
  // Signed order DTOs intentionally omit internal order-item ids; medication id is the stable display key.
  return allocationRows.filter((allocation) => allocation.medicationId === medicationId);
}

function allocationRows(allocations: InventoryReservationAllocationDto[], medicationId: string): ReactElement | null {
  const rows = allocationsFor(allocations, medicationId);
  if (rows.length === 0) return null;
  return <div className="medication-allocations" aria-label="รายการล็อตตาม FEFO">{rows.map((allocation) => <div className="medication-allocation" key={allocation.id}><span><strong>{allocation.lotNumberSnapshot}</strong><small>หมดอายุ {formatThaiDate(allocation.expiryDateSnapshot)}</small></span><b>{allocation.quantity.toLocaleString("th-TH")} {allocation.unitSnapshot}</b></div>)}</div>;
}

function orderCards(data: InventoryPickListDto): ReactElement {
  if (data.medicationDecision.kind !== "ORDER") return <p className="empty-detail">ไม่พบรายการยาแบบ ORDER</p>;
  const allocations = data.reservation?.allocations ?? [];
  return <div className="medication-list">{data.medicationDecision.items.map((item, index) => <article className="medication-card" key={`${item.id}-${index}`}><span className="medication-check" aria-hidden="true"><PackageCheck size={17} /></span><div className="medication-copy"><strong>{item.displayName}</strong><small>{item.strengthText} · {item.dosageFormText}</small><em>จำนวน {item.quantity.toLocaleString("th-TH")} {item.canonicalUnit}</em><i>วิธีใช้: {item.directionsTh}</i>{allocationRows(allocations, item.id)}</div><StatusBadge tone={data.reservation?.status === "ACTIVE" ? "success" : "waiting"}>{data.reservation?.status === "ACTIVE" ? "จองแล้ว" : "รอจอง"}</StatusBadge></article>)}</div>;
}

export function DispensingScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const pickList = useDispensingPickList(visitId);
  const reserve = useReserveDispensing();
  const release = useReleaseDispensing();
  const [reason, setReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const reserveAttempt = useRef<ReserveDispensingAttempt | null>(null);
  const releaseAttempt = useRef<ReleaseDispensingAttempt | null>(null);
  const canReserve = auth.session?.permissions.includes("inventory:reserve") ?? false;

  if (pickList.isPending) return <div className="flow-page dispensing-page"><PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" description="รายการจัดยาจากคำสั่งที่ลงนามแล้ว" /><Card><p role="status">กำลังโหลด Pick List…</p></Card></div>;
  if (pickList.error || !pickList.data) return <div className="flow-page dispensing-page"><PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" description="รายการจัดยาจากคำสั่งที่ลงนามแล้ว" /><Card><section className="workflow-blocked workflow-blocked-unavailable" role="alert"><p>{pickList.error ? errorMessage(pickList.error) : "ไม่พบข้อมูลรายการจัดยา"}</p><button className="inline-retry-button" type="button" onClick={() => void pickList.refetch()}>โหลดข้อมูลล่าสุด</button></section></Card></div>;

  const data = pickList.data;
  const activeReservation = data.reservation?.status === "ACTIVE" ? data.reservation : null;
  const reserveError = reserve.error ? errorMessage(reserve.error) : "";
  const releaseError = release.error ? errorMessage(release.error) : "";
  const message = validationError || reserveError || releaseError;

  function reserveLots() {
    if (!canReserve || data.medicationDecision.kind !== "ORDER") return;
    try { reserveAttempt.current ??= createReserveDispensingAttempt(data); } catch { return; }
    reserve.mutate({ visitId: data.visit.id, attempt: reserveAttempt.current }, { onSuccess: () => { reserveAttempt.current = null; }, onError: () => undefined });
  }

  function changeReason(value: string) {
    releaseAttempt.current = null;
    setValidationError("");
    setReason(value);
  }

  function releaseLots() {
    if (!canReserve || !activeReservation) return;
    if (!reason.trim()) { setValidationError("กรุณาระบุเหตุผลการยกเลิกการจอง"); return; }
    try { releaseAttempt.current ??= createReleaseDispensingAttempt(data, reason); } catch { return; }
    release.mutate({ visitId: data.visit.id, attempt: releaseAttempt.current }, { onSuccess: () => { releaseAttempt.current = null; setReason(""); setValidationError(""); }, onError: () => undefined });
  }

  return <div className="flow-page dispensing-page">
    <PageHeader eyebrow="FULFILLMENT · PICK LIST" title="จัดยา" description="ตรวจสอบคำสั่งยาที่ลงนาม และจองล็อตตามวันหมดอายุก่อน" />
    <Card className="dispensing-body"><div className="patient-header"><div className="patient-header-copy"><strong>{data.patient.displayName}</strong><span>HN {data.patient.hn} · Visit {data.visit.id}</span></div><StatusBadge tone={statusTone(data.visit.status)}>{data.visit.status}</StatusBadge></div><div className="dispensing-meta"><span>คำสั่งยา version {data.medicationDecision.version}</span><span>Visit revision {data.visit.revision}</span></div></Card>
    <Card className="dispensing-body"><SectionHeading icon={ClipboardList} title="คำสั่งยาที่ลงนาม" description="รายการนี้มาจาก Signed Order ของแพทย์ และระบบจะเลือกล็อตแบบ FEFO" />{orderCards(data)}{activeReservation ? <div className="signed-next-actions"><ShieldCheck aria-hidden="true" /><span><strong>Hard Reservation ทำงานแล้ว</strong><small>จำนวนยาถูกกันไว้ในล็อตจริง ไม่หมดอายุระหว่างรอจัดยา</small></span></div> : <div className="signed-next-actions"><span><strong>ยังไม่มีการจองล็อต</strong><small>กดเริ่มจองเพื่อกันสต็อกแบบ all-or-nothing ตาม FEFO</small></span></div>}</Card>
    <Card className="dispensing-body"><SectionHeading icon={PackageCheck} title="การจัดสรรล็อต" description="ระบบเรียงล็อตที่หมดอายุก่อน และข้ามล็อตที่หมดอายุหรือกักกัน" />{activeReservation ? <><div className="dispense-footer"><p>รายการนี้ถูกกันสต็อกไว้แล้ว กรุณาดำเนินการตามขั้นตอนจัดยาที่หน้างาน</p>{canReserve ? <ActionButton type="button" variant="danger" onClick={releaseLots} disabled={release.isPending}>{release.isPending ? "กำลังยกเลิก…" : "ยกเลิกการจอง"}</ActionButton> : null}</div>{canReserve ? <TextAreaField label="เหตุผลการยกเลิกการจอง" value={reason} onChange={(event) => changeReason(event.target.value)} placeholder="เช่น ทบทวนรายการยาก่อนจัด" disabled={release.isPending} /> : <p className="field-hint">อ่านข้อมูลได้อย่างเดียว — บัญชีนี้ไม่มีสิทธิ์ยกเลิกการจอง</p>}</> : canReserve ? <div className="dispense-footer"><p>การจองจะกันล็อตทั้งหมดใน transaction เดียว หากสต็อกไม่พอระบบจะไม่เปลี่ยนแปลงรายการใด</p><ActionButton type="button" icon={PackageCheck} onClick={reserveLots} disabled={reserve.isPending}>{reserve.isPending ? "กำลังจองล็อต…" : "เริ่มจองล็อตตาม FEFO"}</ActionButton></div> : <div className="dispense-footer"><p>อ่านข้อมูลได้อย่างเดียว — บัญชีนี้ไม่มีสิทธิ์จองหรือยกเลิกรายการ</p></div>}{message ? <p className="field-error" role="alert">{message}</p> : null}</Card>
    {activeReservation ? <Card className="dispensing-body"><SectionHeading title="สถานะ Pilot" description="Hard Reservation เป็นการกันสต็อกเพื่อเตรียมจัดยาเท่านั้น" /><p className="empty-detail">การสแกนบาร์โค้ด ฉลากยา การตรวจปล่อย ส่งมอบ และตัดสต็อกจริงจะเปิดใน Pilot ระยะถัดไป</p></Card> : null}
  </div>;
}
