import { ArrowLeft, PackageCheck, PackagePlus, Search } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { MedicationDto, ReceiveInventoryPayload } from "../../shared/contracts";
import { sanitizeJourneyReturnTo, visitIdFromJourneyReturnTo } from "../app/journey-navigation";
import { ActionButton, Card, Field, PageHeader, SectionHeading, TextAreaField } from "../components/careflow/ui";
import { createReceiveInventoryAttempt, useInventory, useInventoryMedicationSearch, useReceiveInventory, type ReceiveInventoryAttempt } from "../features/inventory";
import { isApiError } from "../lib/api-error";

type Draft = {
  medicationSearch: string;
  quantity: string;
  lotNumber: string;
  expiryDate: string;
  supplierName: string;
  note: string;
};

const blankDraft: Draft = { medicationSearch: "", quantity: "", lotNumber: "", expiryDate: "", supplierName: "", note: "" };

function todayInBangkok(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function tomorrowInBangkok(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
}

function messageFor(error: unknown): string {
  if (isApiError(error)) return error.messageTh;
  return "ยังบันทึกรับยาไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

export function StockReceptionScreen(): ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeJourneyReturnTo(searchParams.get("returnTo"));
  const recoveryMedicationId = searchParams.get("medicationId");
  const returnVisitId = visitIdFromJourneyReturnTo(returnTo);
  const inventory = useInventory();
  const receive = useReceiveInventory(returnVisitId ?? undefined);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [selectionOverride, setSelectionOverride] = useState<MedicationDto | null | undefined>(undefined);
  const [validationError, setValidationError] = useState("");
  const attempt = useRef<ReceiveInventoryAttempt | null>(null);
  const recoveredMedication = inventory.data?.find((item) => item.medication.id === recoveryMedicationId)?.medication ?? null;
  const selected = selectionOverride === undefined ? recoveredMedication : selectionOverride;
  const medicationSearch = selectionOverride === undefined && selected ? selected.displayName : draft.medicationSearch;
  const search = useInventoryMedicationSearch(medicationSearch, !selected || selected.displayName !== medicationSearch);
  const quantity = Number(draft.quantity);
  const validQuantity = Number.isInteger(quantity) && quantity > 0;
  const current = inventory.data?.find((item) => item.medication.id === selected?.id);

  function change(key: keyof Draft, value: string) {
    attempt.current = null;
    setValidationError("");
    if (key === "medicationSearch" && selected?.displayName !== value) setSelectionOverride(null);
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  function chooseMedication(medication: MedicationDto) {
    attempt.current = null;
    setValidationError("");
    setSelectionOverride(medication);
    setDraft((currentDraft) => ({ ...currentDraft, medicationSearch: medication.displayName }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !validQuantity || !draft.lotNumber.trim() || !draft.expiryDate || !draft.supplierName.trim()) {
      setValidationError("กรุณากรอกข้อมูลรับยาให้ครบถ้วน และระบุจำนวนเต็มที่มากกว่าศูนย์");
      return;
    }
    if (draft.expiryDate <= todayInBangkok()) {
      setValidationError("วันหมดอายุต้องเป็นวันในอนาคต");
      return;
    }
    const payload: ReceiveInventoryPayload = {
      medicationId: selected.id,
      quantity,
      lotNumber: draft.lotNumber.trim(),
      expiryDate: draft.expiryDate,
      supplierName: draft.supplierName.trim(),
      note: draft.note.trim(),
    };
    attempt.current ??= createReceiveInventoryAttempt(selected, payload);
    receive.mutate(attempt.current, { onSuccess: () => navigate(returnTo) });
  }

  const impact = selected && validQuantity
    ? `${(current?.onHand ?? 0).toLocaleString("th-TH")} + ${quantity.toLocaleString("th-TH")} = ${((current?.onHand ?? 0) + quantity).toLocaleString("th-TH")} ${selected.canonicalUnit}`
    : "เลือกยาและระบุจำนวนเต็มเพื่อดูยอดหลังรับเข้า";
  const error = validationError || (receive.error ? messageFor(receive.error) : "");

  return (
    <div className="operations-page stock-page">
      <PageHeader eyebrow="STOCK RECEPTION" title="รับยาเข้าคลัง" description="เพิ่มล็อตยาใหม่พร้อมยอดคงเหลือที่ตรวจสอบได้" />
      <form className="stock-layout" onSubmit={submit} noValidate>
        <Card className="stock-form-card"><SectionHeading icon={PackagePlus} title="ข้อมูลการรับยา" description="เลือกทะเบียนยา แล้วบันทึกล็อตที่ตรวจสอบได้" />
          <div className="form-grid two-columns">
            <label className="field" htmlFor="inventory-medication-search"><span className="field-label">ค้นหายา</span><div className="medication-search"><Search aria-hidden="true" size={18} /><input id="inventory-medication-search" className="care-input" role="combobox" aria-autocomplete="list" aria-expanded={Boolean(search.data?.length && !selected)} aria-controls="inventory-medication-options" value={medicationSearch} onChange={(event) => change("medicationSearch", event.target.value)} placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" disabled={receive.isPending} /></div>
              {search.isFetching ? <span className="field-hint">กำลังค้นหาทะเบียนยา…</span> : null}
              {search.error ? <span className="field-error">{messageFor(search.error)}</span> : null}
              {search.data?.length && !selected ? <div id="inventory-medication-options" className="stock-medication-results" role="listbox" aria-label="ผลการค้นหายา">{search.data.map((medication) => <button key={medication.id} role="option" aria-selected="false" type="button" onClick={() => chooseMedication(medication)}><strong>{medication.displayName}</strong><small>{medication.strengthText} · {medication.dosageFormText} · {medication.canonicalUnit}</small></button>)}</div> : null}
            </label>
            <Field label="จำนวนที่รับ" type="number" min="1" step="1" value={draft.quantity} onChange={(event) => change("quantity", event.target.value)} placeholder="เช่น 100" disabled={receive.isPending} />
            <Field label="หน่วยนับ (ตามทะเบียนยา)" value={selected?.canonicalUnit ?? ""} readOnly placeholder="เลือกยาเพื่อแสดงหน่วยนับ" />
            <Field label="ผู้ผลิต / ผู้จัดจำหน่าย" value={draft.supplierName} onChange={(event) => change("supplierName", event.target.value)} placeholder="เช่น องค์การเภสัชกรรม" disabled={receive.isPending} />
            <Field label="เลขที่ล็อต" value={draft.lotNumber} onChange={(event) => change("lotNumber", event.target.value)} placeholder="เช่น PCM-2608" disabled={receive.isPending} />
            <Field label="วันหมดอายุ" type="date" min={tomorrowInBangkok()} value={draft.expiryDate} onChange={(event) => change("expiryDate", event.target.value)} disabled={receive.isPending} />
            <TextAreaField className="form-span-full" label="หมายเหตุ" value={draft.note} onChange={(event) => change("note", event.target.value)} placeholder="ถ้ามี" disabled={receive.isPending} />
          </div>
          {error ? <p className="stock-error" role="alert">{error}</p> : null}
          <div className="stock-actions"><Link className="care-button care-button-ghost" to={returnTo}><ArrowLeft aria-hidden="true" size={19} />ยกเลิก</Link><ActionButton type="submit" icon={PackageCheck} disabled={receive.isPending}>{receive.isPending ? "กำลังบันทึก…" : "ยืนยันการรับยา"}</ActionButton></div>
        </Card>
        <Card className="stock-impact-card"><SectionHeading title="ผลกระทบต่อคงคลัง" description="ตัวอย่างก่อนยืนยันรายการ" /><div className="stock-impact"><span>ยอดปัจจุบัน</span><strong>{selected ? `${(current?.onHand ?? 0).toLocaleString("th-TH")} ${selected.canonicalUnit}` : "—"}</strong><span>ยอดหลังรับเข้า</span><strong className={selected && validQuantity ? "impact-total" : ""}>{impact}</strong></div><p>ระบบจะสร้างล็อตใหม่ พร้อมบันทึกความเคลื่อนไหวคงคลังแบบตรวจสอบย้อนหลังได้</p></Card>
      </form>
    </div>
  );
}
