"use client";

import { ArrowLeft, PackageCheck, PackagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { ActionButton, Card, Field, PageHeader, SectionHeading, SelectField } from "../ui";

type Draft = { inventoryId: string; quantity: string; unit: string; supplier: string; batchNumber: string; expiry: string };
const blank: Draft = { inventoryId: "", quantity: "", unit: "", supplier: "", batchNumber: "", expiry: "" };

export function StockReceptionScreen() {
  const { state, dispatch } = useCareFlow();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState("");
  const selected = state.inventory.find((item) => item.id === draft.inventoryId);
  const quantity = Number(draft.quantity);
  const validQuantity = Number.isFinite(quantity) && Number.isInteger(quantity) && quantity > 0;
  const preview = selected && validQuantity ? `${selected.stock.toLocaleString("th-TH")} + ${quantity.toLocaleString("th-TH")} = ${(selected.stock + quantity).toLocaleString("th-TH")}` : "เลือกยาและระบุจำนวนเต็มเพื่อดูยอดหลังรับเข้า";
  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value, ...(key === "inventoryId" ? { unit: state.inventory.find((item) => item.id === value)?.unit ?? "" } : {}) }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !draft.batchNumber.trim()) { setError("กรุณากรอกข้อมูลรับยาให้ครบถ้วน"); return; }
    if (!validQuantity) { setError("จำนวนรับยาต้องเป็นจำนวนเต็มที่มากกว่าศูนย์"); return; }
    if (!draft.expiry || draft.expiry <= "2026-08-02") { setError("วันหมดอายุต้องเป็นวันในอนาคต"); return; }
    if (!draft.supplier.trim()) { setError("กรุณากรอกข้อมูลรับยาให้ครบถ้วน"); return; }
    dispatch({ type: "RECEIVE_STOCK", payload: { inventoryId: selected.id, quantity, unit: draft.unit || selected.unit, supplier: draft.supplier.trim(), batchNumber: draft.batchNumber.trim(), expiry: draft.expiry, receivedAt: new Date().toISOString() } });
    router.push("/inventory");
  }

  return <div className="operations-page stock-page">
    <PageHeader eyebrow="STOCK RECEPTION" title="รับยาเข้าคลัง" description="เพิ่มล็อตยาใหม่พร้อมยอดคงเหลือที่ตรวจสอบได้" />
    <form className="stock-layout" onSubmit={submit} noValidate>
      <Card className="stock-form-card"><SectionHeading icon={PackagePlus} title="ข้อมูลการรับยา" description="ช่องที่มีเครื่องหมาย * จำเป็นต่อการบันทึกล็อต" />
        <div className="form-grid two-columns">
          <SelectField label="ค้นหายา (Search Medication) *" aria-label="ค้นหายา" value={draft.inventoryId} onChange={(event) => update("inventoryId", event.target.value)}><option value="">เลือกยาในทะเบียน</option>{state.inventory.map((item) => <option key={item.id} value={item.id}>{item.nameTh} · {item.name} · {item.code}</option>)}</SelectField>
          <Field label="จำนวนที่รับ *" type="number" min="1" step="1" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} placeholder="เช่น 100" />
          <Field label="หน่วยนับ" value={draft.unit} onChange={(event) => update("unit", event.target.value)} placeholder="กล่อง / เม็ด / ขวด" />
          <Field label="ผู้ผลิต / ผู้จัดจำหน่าย *" value={draft.supplier} onChange={(event) => update("supplier", event.target.value)} placeholder="เช่น องค์การเภสัชกรรม" />
          <Field label="เลขที่ล็อต (Batch Number) *" value={draft.batchNumber} onChange={(event) => update("batchNumber", event.target.value)} placeholder="เช่น PCM-2608" />
          <Field label="วันหมดอายุ *" type="date" value={draft.expiry} onChange={(event) => update("expiry", event.target.value)} />
        </div>
        {error ? <p className="stock-error" role="alert">{error}</p> : null}
        <div className="stock-actions"><ActionButton type="button" variant="ghost" icon={ArrowLeft} onClick={() => router.push("/inventory")}>ยกเลิก</ActionButton><ActionButton type="submit" icon={PackageCheck}>ยืนยันการรับยา</ActionButton></div>
      </Card>
      <Card className="stock-impact-card"><SectionHeading title="ผลกระทบต่อคงคลัง" description="ตัวอย่างก่อนยืนยันรายการ" /><div className="stock-impact"><span>ยอดปัจจุบัน</span><strong>{selected ? `${selected.stock.toLocaleString("th-TH")} ${selected.unit}` : "—"}</strong><span>ยอดหลังรับเข้า</span><strong className={selected && validQuantity ? "impact-total" : ""}>{preview}{selected && validQuantity ? ` ${selected.unit}` : ""}</strong></div><p>ระบบจะเพิ่มล็อตใหม่ และอัปเดตยอดคงเหลือของรายการยาที่เลือกทันที</p></Card>
    </form>
  </div>;
}
