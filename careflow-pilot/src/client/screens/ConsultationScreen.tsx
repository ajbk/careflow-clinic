import { ClipboardCheck, Clock3, FileSignature, LockKeyhole, Stethoscope } from "lucide-react";
import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { PatientHeader } from "../components/careflow/PatientHeader";
import { Card, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { useVisitWorkspace } from "../features/visit";
import { isApiError } from "../lib/api-error";
import { formatThaiDateTime } from "../lib/thai-date";

function WorkspaceState({ title, message, denied = false }: { title: string; message: string; denied?: boolean }): ReactElement {
  return <section className={`workflow-blocked ${denied ? "workflow-blocked-denied" : "workflow-blocked-unavailable"}`} role="alert"><LockKeyhole aria-hidden="true" size={24} /><div><h2>{title}</h2><p>{message}</p></div></section>;
}

export function ConsultationScreen(): ReactElement {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const workspace = useVisitWorkspace(visitId);

  if (workspace.isPending) {
    return <div className="flow-page consultation-page"><PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" description="เปิดดูข้อมูล Intake ที่บันทึกจากระบบ" /><Card className="clinical-record"><div className="consultation-skeleton" /><div className="consultation-skeleton consultation-skeleton-large" /></Card></div>;
  }
  if (workspace.error || !workspace.data) {
    const error = workspace.error;
    const denied = !auth.session?.permissions.includes("visit:start-consultation") || (isApiError(error) && error.status === 403);
    return <div className="flow-page consultation-page"><PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" description="เปิดดูข้อมูล Intake ที่บันทึกจากระบบ" /><Card><WorkspaceState denied={denied} title={denied ? "ไม่มีสิทธิ์เปิดห้องตรวจ" : "ไม่พบข้อมูลห้องตรวจ"} message={denied ? "บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลห้องตรวจนี้" : (isApiError(error) ? error.messageTh : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง")} /></Card></div>;
  }

  const data = workspace.data;
  const status = data.visit.status === "CONSULTING" ? { label: "กำลังตรวจ", tone: "active" as const } : { label: "รอตรวจ", tone: "waiting" as const };
  const vital = (value: number | null, suffix = "") => value === null ? "—" : `${value}${suffix}`;

  return (
    <div className="flow-page consultation-page">
      <PageHeader eyebrow="DOCTOR WORKSPACE" title="ห้องตรวจ" description="อ่านข้อมูล Intake ที่บันทึกจากระบบ · การบันทึก Clinical Note จะเปิดใน Milestone ถัดไป" actions={<Link className="care-button care-button-secondary" to="/queue">กลับคิวผู้ป่วย</Link>} />
      <Card className="clinical-record">
        <PatientHeader patient={data.patient} status={status.label} statusTone={status.tone} />
        <div className="consultation-meta" aria-label="สถานะ Visit"><span>Visit {data.visit.id}</span><span>revision {data.visit.revision}</span><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
        <div className="clinical-grid">
          <section>
            <SectionHeading icon={Stethoscope} title="ข้อมูลการตรวจ" description={`อาการสำคัญ: ${data.intake.chiefComplaint}`} />
            <div className="vitals-summary">
              <span>อุณหภูมิ <strong>{vital(data.intake.vitals.temperatureC, " °C")}</strong></span>
              <span>ความดัน <strong>{data.intake.vitals.systolicMmhg === null || data.intake.vitals.diastolicMmhg === null ? "—" : `${data.intake.vitals.systolicMmhg}/${data.intake.vitals.diastolicMmhg}`}</strong></span>
              <span>ชีพจร <strong>{vital(data.intake.vitals.heartRateBpm, " ครั้ง/นาที")}</strong></span>
              <span>SpO₂ <strong>{vital(data.intake.vitals.spo2Percent, "%")}</strong></span>
            </div>
            <section className="clinical-evidence" aria-label="หลักฐานจาก Intake">
              <SectionHeading icon={ClipboardCheck} title="หลักฐานจาก Intake" description="ข้อมูลนี้มาจาก snapshot ที่บันทึกแล้ว" />
              <div className="evidence-grid"><div><span>ผู้บันทึก</span><strong>{data.intake.recordedBy.displayName}</strong></div><div><span>เวลาบันทึก</span><strong>{formatThaiDateTime(data.intake.recordedAt)}</strong></div><div><span>มาถึงคลินิก</span><strong>{formatThaiDateTime(data.visit.arrivedAt)}</strong></div><div><span>เริ่มห้องตรวจ</span><strong>{data.visit.startedAt ? formatThaiDateTime(data.visit.startedAt) : "ยังไม่เริ่ม"}</strong></div></div>
            </section>
          </section>
          <aside className="clinical-aside">
            <SectionHeading icon={FileSignature} title="Clinical Note" description="ยังไม่เปิดให้บันทึกใน Milestone นี้" />
            <div className="signed-note milestone-next-copy"><LockKeyhole aria-hidden="true" size={17} />เริ่มตรวจแล้ว — การบันทึกและลงนาม Clinical Note จะเปิดใน Milestone ถัดไป</div>
            <section className="consultation-readonly" aria-label="ข้อมูลอ้างอิง Visit"><div><Clock3 aria-hidden="true" size={17} /><span>สถานะจากระบบ</span><strong>{status.label} · revision {data.visit.revision}</strong></div><p>หน้านี้เป็น workspace แบบอ่านอย่างเดียว ไม่มี SOAP, diagnosis, medication decision, order หรือ dispatch ใน Pilot นี้</p></section>
          </aside>
        </div>
      </Card>
    </div>
  );
}
