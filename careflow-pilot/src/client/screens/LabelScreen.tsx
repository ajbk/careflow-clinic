import { Printer } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import type { FulfillmentCurrentLabelDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { ActionButton, Card, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { createPrintLabelAttempt, useCurrentLabel, useDispensingPickList, usePrintLabel } from "../features/dispensing";
import { isApiError } from "../lib/api-error";

function message(error: unknown) { return isApiError(error) ? error.messageTh : "ไม่สามารถบันทึกคำขอพิมพ์ได้ กรุณาลองใหม่อีกครั้ง"; }
function readMessage(error: unknown) { return isApiError(error) ? error.messageTh : "ไม่สามารถโหลดฉลากปัจจุบันได้ กรุณาลองใหม่อีกครั้ง"; }
function labelIsStale(label: NonNullable<FulfillmentCurrentLabelDto>, pickListLabel: FulfillmentCurrentLabelDto | null | undefined): boolean {
  return Boolean(pickListLabel && (pickListLabel.id !== label.id || pickListLabel.version !== label.version));
}

export function LabelScreen(): ReactElement {
  const { visitId = "" } = useParams(); const auth = useAuth(); const currentLabel = useCurrentLabel(visitId); const pickList = useDispensingPickList(visitId); const print = usePrintLabel(); const [requested, setRequested] = useState(false);
  if (currentLabel.isPending) return <div className="flow-page labels-page"><PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" /><Card><p role="status">กำลังโหลด Label…</p></Card></div>;
  if (currentLabel.error) return <div className="flow-page labels-page"><PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" /><Card><p role="alert">{readMessage(currentLabel.error)}</p></Card></div>;
  const label = currentLabel.data;
  if (!label) return <div className="flow-page labels-page"><PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" /><Card><section className="workflow-blocked" role="alert"><p>ฉลากปัจจุบันไม่พร้อมใช้งานหรือถูกยกเลิกแล้ว จึงไม่สามารถพิมพ์ฉลากเดิมได้</p></section></Card></div>;
  const pickListLabel = pickList.data?.label ?? null; const stale = labelIsStale(label, pickListLabel); const canPrint = Boolean(!stale && pickList.data?.allowedActions.includes("PRINT_LABEL") && auth.session?.permissions.includes("label:print"));
  const requestPrint = () => {
    const data = pickList.data;
    if (!data || !canPrint) return;
    print.mutate({ visitId: data.visit.id, labelVersionId: label.id, attempt: createPrintLabelAttempt(data) }, { onSuccess: () => { setRequested(true); window.print(); } });
  };
  return <div className="flow-page labels-page">
    <PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" description="แสดงเฉพาะฉลากปัจจุบันที่ลงนามแล้ว" />
    <Card className="dispensing-body label-controls non-printable"><SectionHeading icon={Printer} title={`Label v${label.version}`} description="ขนาดสื่อ 80 × 100 มม." action={<StatusBadge tone={stale ? "error" : "success"}>{stale ? "STALE" : "CURRENT"}</StatusBadge>} /><div className="dispense-footer"><p>{stale ? "ข้อมูลฉลากไม่ตรงกับรายการปัจจุบัน จึงไม่สามารถพิมพ์ได้" : requested ? "บันทึกคำขอพิมพ์แล้ว และเปิดหน้าต่างพิมพ์ให้ตรวจสอบ" : "บันทึกคำขอพิมพ์ก่อนเปิดหน้าต่างพิมพ์; การบันทึกไม่ยืนยันว่าพิมพ์ทางกายภาพสำเร็จ"}</p>{canPrint ? <ActionButton type="button" icon={Printer} onClick={requestPrint} disabled={print.isPending}>{print.isPending ? "กำลังบันทึกคำขอ…" : "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์"}</ActionButton> : <p className="field-hint">{stale ? "ฉลากเดิมใช้พิมพ์ไม่ได้" : "รอผู้มีสิทธิ์ขอพิมพ์ฉลาก"}</p>}</div>{print.error ? <p className="field-error" role="alert">{message(print.error)}</p> : null}</Card>
    {!stale ? <section className={`print-area label-sheet${canPrint ? "" : " non-printable"}`} aria-label="ฉลากปัจจุบัน">{label.items.map((item) => <Card as="article" className="medicine-label" key={item.orderItemId}><p className="page-eyebrow">{label.clinicNameSnapshot}</p><h2>{label.patientDisplayNameSnapshot}</h2><p>HN {label.patientHnSnapshot}</p><hr /><strong>{item.displayNameSnapshot}</strong><p>{item.strengthSnapshot} · {item.dosageFormSnapshot}</p><p>จำนวน {item.quantity} {item.unitSnapshot}</p><p>{item.directionsThSnapshot}</p><p>Medication {item.medicationId} · revision {item.medicationRevision}</p><p>Order item {item.orderItemId}</p><code>{item.internalBarcode}</code><small>Label version {label.version} · 80 × 100 mm</small></Card>)}</section> : <section className="workflow-blocked non-printable" role="alert"><p>ฉลากเดิมไม่พร้อมใช้งานสำหรับการพิมพ์ กรุณาโหลดฉลากปัจจุบันอีกครั้ง</p></section>}
  </div>;
}
