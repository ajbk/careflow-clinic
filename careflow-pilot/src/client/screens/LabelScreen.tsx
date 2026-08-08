import { Printer } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { ActionButton, Card, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { createPrintLabelAttempt, useDispensingPickList, usePrintLabel } from "../features/dispensing";
import { isApiError } from "../lib/api-error";

function message(error: unknown) { return isApiError(error) ? error.messageTh : "ไม่สามารถบันทึกคำขอพิมพ์ได้ กรุณาลองใหม่อีกครั้ง"; }

export function LabelScreen(): ReactElement {
  const { visitId = "" } = useParams(); const auth = useAuth(); const pickList = useDispensingPickList(visitId); const print = usePrintLabel(); const [requested, setRequested] = useState(false);
  if (pickList.isPending) return <div className="flow-page labels-page"><PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" /><Card><p role="status">กำลังโหลด Label…</p></Card></div>;
  if (pickList.error || !pickList.data) return <div className="flow-page labels-page"><PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" /><Card><p role="alert">{pickList.error ? message(pickList.error) : "ไม่พบ Label ปัจจุบัน"}</p></Card></div>;
  const data = pickList.data; const label = data.label; const canPrint = Boolean(label && data.allowedActions.includes("PRINT_LABEL") && auth.session?.permissions.includes("label:print"));
  const requestPrint = () => {
    if (!label || !canPrint) return;
    print.mutate({ visitId: data.visit.id, labelVersionId: label.id, attempt: createPrintLabelAttempt(data) }, { onSuccess: () => { setRequested(true); window.print(); } });
  };
  return <div className="flow-page labels-page">
    <PageHeader eyebrow="FULFILLMENT · LABEL" title="ฉลากยา" description="แสดงเฉพาะฉลากปัจจุบันที่ลงนามแล้ว" />
    {!label ? <Card><section className="workflow-blocked" role="alert"><p>ฉลากปัจจุบันไม่พร้อมใช้งานหรือถูกยกเลิกแล้ว จึงไม่สามารถพิมพ์ฉลากเดิมได้</p></section></Card> : <>
      <Card className="dispensing-body"><SectionHeading icon={Printer} title={`Label v${label.version}`} description="ขนาดสื่อ 80 × 100 มม." action={<StatusBadge tone="success">CURRENT</StatusBadge>} /><div className="dispense-footer"><p>{requested ? "บันทึกคำขอพิมพ์แล้ว และเปิดหน้าต่างพิมพ์ให้ตรวจสอบ" : "บันทึกคำขอพิมพ์ก่อนเปิดหน้าต่างพิมพ์; การบันทึกไม่ยืนยันว่าพิมพ์ทางกายภาพสำเร็จ"}</p>{canPrint ? <ActionButton type="button" icon={Printer} onClick={requestPrint} disabled={print.isPending}>{print.isPending ? "กำลังบันทึกคำขอ…" : "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์"}</ActionButton> : <p className="field-hint">รอผู้มีสิทธิ์ขอพิมพ์ฉลาก</p>}</div>{print.error ? <p className="field-error" role="alert">{message(print.error)}</p> : null}</Card>
      <section className="print-area label-sheet" aria-label="ฉลากปัจจุบัน">{label.items.map((item) => <Card as="article" className="medicine-label" key={item.orderItemId}><p className="page-eyebrow">CARE<span>FLOW</span> · SIGNED LABEL</p><h2>{data.patient.displayName}</h2><p>HN {data.patient.hn}</p><p>Visit {data.visit.id}</p><hr /><strong>Medication {item.medicationId}</strong><p>Order item {item.orderItemId}</p><code>{item.internalBarcode}</code><small>Label version {label.version} · 80 × 100 mm</small></Card>)}</section>
    </>}
  </div>;
}
