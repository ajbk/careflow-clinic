import { Printer } from "lucide-react";
import type { ReactElement } from "react";
import { useParams } from "react-router-dom";
import type { OpdCardDto } from "../../shared/contracts";
import { ActionButton, Card, PageHeader } from "../components/careflow/ui";
import { useOpdCard } from "../features/finance";
import { isApiError } from "../lib/api-error";
import { formatThaiDate, formatThaiDateTime } from "../lib/thai-date";

function formatBaht(value: number): string {
  return `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(value)} บาท`;
}

function sexLabel(value: OpdCardDto["closure"]["patient"]["sex"]): string {
  return value === "female" ? "หญิง" : value === "male" ? "ชาย" : "ไม่ระบุ";
}

function vital(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value}${suffix}`;
}

function readMessage(error: unknown): string {
  return isApiError(error)
    ? error.messageTh
    : "ไม่สามารถโหลดบัตร OPD ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่";
}

function MedicationEvidence({ data }: { data: OpdCardDto["medication"] }): ReactElement {
  if (data.kind === "NO_MEDICATION") {
    return <section className="opd-section"><h2>การรักษาและยา</h2><p><strong>ไม่ได้สั่งยา:</strong> {data.noMedicationReason}</p><small>หลักฐานการตัดสินใจ {data.decision.id} · {data.decision.contentHash}</small></section>;
  }
  return <section className="opd-section"><h2>การรักษาและยา</h2><ul className="opd-medicine-list">{data.items.map((item) => <li key={item.dispenseLineId}><strong>{item.displayName}</strong><span>{item.strengthText} · {item.dosageFormText}</span><span>จำนวน {item.quantity} {item.unit} · {item.directionsTh}</span><small>ล็อต {item.lotNumber} · หมดอายุ {formatThaiDate(item.expiryDate)}</small></li>)}</ul><small>Dispense {data.dispense.id} · ส่งมอบ {formatThaiDateTime(data.dispense.handedOffAt)} · hash การตัดสินใจ {data.decision.contentHash}</small></section>;
}

function ResolutionEvidence({ data }: { data: OpdCardDto["charge"]["resolution"] }): ReactElement {
  if (data.kind === "COLLECTION_NOT_REQUIRED") {
    return <p><strong>ยกเว้นเต็มจำนวน:</strong> {formatBaht(-data.amountBaht)} · {data.reason}<br /><small>อนุมัติโดย {data.approvedBy.displayName} · {formatThaiDateTime(data.approvedAt)} · {data.contentHash}</small></p>;
  }
  return <p><strong>รับชำระ:</strong> {data.method === "CASH" ? "เงินสด" : "PromptPay"} {formatBaht(data.amountBaht)}{data.manualReference ? ` · อ้างอิง ${data.manualReference}` : ""}<br /><small>ยืนยันโดย {data.confirmedBy.displayName} · {formatThaiDateTime(data.confirmedAt)} · {data.contentHash}</small></p>;
}

export function OpdCardScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const opd = useOpdCard(visitId);

  if (opd.isPending) {
    return <div className="flow-page opd-card-page"><PageHeader eyebrow="DOCTOR · OPD CARD" title="บัตร OPD" /><Card><p role="status">กำลังโหลดบัตร OPD…</p></Card></div>;
  }
  if (opd.error || !opd.data) {
    return <div className="flow-page opd-card-page"><PageHeader eyebrow="DOCTOR · OPD CARD" title="บัตร OPD" /><Card><section className="workflow-blocked workflow-blocked-unavailable" role="alert"><p>{opd.error ? readMessage(opd.error) : "ไม่พบบัตร OPD สำหรับ Visit นี้"}</p></section></Card></div>;
  }

  const data = opd.data;
  return <div className="flow-page opd-card-page">
    <PageHeader
      eyebrow="DOCTOR · OPD CARD"
      title="บัตร OPD"
      description="เอกสารสรุปจากหลักฐานที่ลงนามแล้วสำหรับข้อมูลสังเคราะห์"
      actions={<ActionButton className="non-printable" type="button" icon={Printer} onClick={() => window.print()}>พิมพ์ OPD Card</ActionButton>}
    />
    <section className="print-area opd-card" aria-label="บัตร OPD สำหรับพิมพ์">
      <p className="opd-synthetic-banner">PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้รักษาจริง</p>
      <header>
        <div>
          <strong>{data.closure.clinic.name}</strong>
          <span>บัตร OPD · Visit {data.visit.id}</span>
        </div>
        <div className="opd-close-meta"><span>ปิด Visit</span><time dateTime={data.closure.closedAt}>{formatThaiDateTime(data.closure.closedAt)}</time></div>
      </header>

      <section className="opd-patient" aria-label="ข้อมูลผู้ป่วยจาก snapshot">
        <div><span>HN</span><strong>{data.closure.patient.hn}</strong></div>
        <div><span>ชื่อผู้ป่วย</span><strong>{data.closure.patient.displayName}</strong></div>
        <div><span>วันเกิด</span><strong>{formatThaiDate(data.closure.patient.birthDate)}</strong></div>
        <div><span>เพศ</span><strong>{sexLabel(data.closure.patient.sex)}</strong></div>
      </section>

      <section className="opd-section"><h2>ข้อมูล Visit และสัญญาณชีพ</h2><p><strong>อาการสำคัญ:</strong> {data.visit.chiefComplaint}</p><div className="opd-vitals"><span>น้ำหนัก {vital(data.visit.vitals.weightKg, " กก.")}</span><span>ส่วนสูง {vital(data.visit.vitals.heightCm, " ซม.")}</span><span>อุณหภูมิ {vital(data.visit.vitals.temperatureC, " °C")}</span><span>ความดัน {data.visit.vitals.systolicMmhg === null || data.visit.vitals.diastolicMmhg === null ? "—" : `${data.visit.vitals.systolicMmhg}/${data.visit.vitals.diastolicMmhg} mmHg`}</span><span>ชีพจร {vital(data.visit.vitals.heartRateBpm, " ครั้ง/นาที")}</span><span>SpO₂ {vital(data.visit.vitals.spo2Percent, "%")}</span></div></section>

      <section className="opd-section"><h2>บันทึกการตรวจแบบ SOAP</h2><div className="opd-soap"><div><strong>S</strong><p>{data.clinicalNote.subjective}</p></div><div><strong>O</strong><p>{data.clinicalNote.objective}</p></div><div><strong>A</strong><p>{data.clinicalNote.assessment}</p></div><div><strong>P</strong><p>{data.clinicalNote.plan}</p></div></div><p className="opd-diagnoses"><strong>การวินิจฉัย:</strong> {data.clinicalNote.diagnoses.join(", ")}</p><small>ลงนามโดย {data.clinicalNote.signedBy.displayName} · {formatThaiDateTime(data.clinicalNote.signedAt)} · hash {data.clinicalNote.contentHash}</small></section>

      {data.amendments.length > 0 ? <section className="opd-section opd-addenda"><h2>ภาคผนวกการแก้ไข</h2>{data.amendments.map((amendment) => <article key={amendment.id}><p>{amendment.content}</p><small>เหตุผล: {amendment.reason} · {amendment.signedBy.displayName} · {formatThaiDateTime(amendment.signedAt)} · {amendment.contentHash}</small></article>)}</section> : null}

      <MedicationEvidence data={data.medication} />

      <section className="opd-section"><h2>สรุปค่าใช้จ่าย</h2><dl className="opd-charge-lines">{data.charge.lines.map((line) => <div key={line.id}><dt>{line.descriptionSnapshot} · {line.quantity} รายการ</dt><dd>{formatBaht(line.lineTotalBaht)}</dd></div>)}<div><dt>ยอดรวมก่อนปรับ</dt><dd>{formatBaht(data.charge.grossTotalBaht)}</dd></div><div><dt>ปรับลด/ยกเว้น</dt><dd>{formatBaht(data.charge.adjustmentTotalBaht)}</dd></div><div className="opd-charge-total"><dt>ยอดสุทธิ</dt><dd>{formatBaht(data.charge.netDueBaht)}</dd></div></dl><ResolutionEvidence data={data.charge.resolution} /><small>Charge {data.charge.id} · hash {data.charge.contentHash}</small></section>

      <footer><span>แพทย์ผู้ปิด Visit: {data.closure.doctor.displayName}</span><span>Closure {data.closure.id}</span><code aria-label="แฮช Closure">{data.closure.contentHash}</code></footer>
    </section>
  </div>;
}
