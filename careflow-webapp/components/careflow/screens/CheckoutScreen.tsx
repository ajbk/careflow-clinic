"use client";

import Link from "next/link";
import { Banknote, CheckCircle2, CreditCard, ReceiptText } from "lucide-react";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectVisit, selectVisitPatient } from "@/lib/careflow/selectors";
import type { PaymentMethod } from "@/lib/careflow/types";
import { PatientHeader } from "../PatientHeader";
import { ActionButton, Card, EmptyState, PageHeader, SectionHeading, formatThaiCurrency } from "../ui";

export function CheckoutScreen({ visitId }: { visitId: string }) {
  const { state, dispatch } = useCareFlow();
  const visit = selectVisit(state, visitId);
  const patient = selectVisitPatient(state, visitId);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  if (!visit || !patient) return <EmptyState icon={ReceiptText} title="ไม่พบรายการชำระเงิน" detail="กรุณาเลือกผู้ป่วยจากคิว" />;
  const done = visit.status === "complete";
  const total = visit.consultationFee + visit.medicationTotal;
  return <div className="flow-page checkout-page"><PageHeader eyebrow="CHECKOUT" title="รับชำระเงิน" description="เลือกวิธีชำระเงินก่อนปิดการรับบริการ" actions={done ? <Link className="care-button care-button-secondary" href={`/visits/${visitId}/opd-card`}>ดู OPD Card</Link> : undefined} /><Card className="checkout-card"><PatientHeader patient={patient} status={done ? "ชำระเงินแล้ว" : "รอชำระเงิน"} statusTone={done ? "success" : "info"} /><div className="checkout-grid"><section><SectionHeading icon={ReceiptText} title="สรุปรายการ" /><dl className="invoice-lines"><div><dt>ค่าตรวจรักษา</dt><dd>{formatThaiCurrency(visit.consultationFee)}</dd></div><div><dt>ค่ายา</dt><dd>{formatThaiCurrency(visit.medicationTotal)}</dd></div><div className="invoice-total"><dt>ยอดชำระทั้งหมด</dt><dd>{formatThaiCurrency(total)}</dd></div></dl></section><section className="payment-section"><SectionHeading icon={CreditCard} title="วิธีชำระเงิน" description="เลือกหนึ่งวิธีก่อนยืนยัน" /><div className="payment-options"><label className={method === "cash" ? "payment-option selected" : "payment-option"}><input type="radio" name="payment" aria-label="เงินสด" checked={method === "cash"} disabled={done} onChange={() => setMethod("cash")} /><Banknote aria-hidden="true" size={22} /><span><strong>เงินสด</strong><small>ชำระที่เคาน์เตอร์</small></span></label><label className={method === "promptpay" ? "payment-option selected" : "payment-option"}><input type="radio" name="payment" aria-label="พร้อมเพย์" checked={method === "promptpay"} disabled={done} onChange={() => setMethod("promptpay")} /><CreditCard aria-hidden="true" size={22} /><span><strong>พร้อมเพย์</strong><small>สแกน QR เพื่อชำระเงิน</small></span></label></div>{done ? <Link className="care-button care-button-primary" href={`/visits/${visitId}/opd-card`}>เปิด OPD Card</Link> : <ActionButton icon={CheckCircle2} disabled={!method} onClick={() => method && dispatch({ type: "COMPLETE_PAYMENT", payload: { visitId, method, paidAt: new Date().toISOString() } })}>ยืนยันการรับเงิน</ActionButton>}</section></div></Card></div>;
}
