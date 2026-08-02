"use client";

import { ArrowLeft, CalendarCheck2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { ActionButton, Card, Field, PageHeader, SectionHeading, SelectField, TextAreaField } from "../ui";

const slots = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];

export function NewAppointmentScreen() {
  const { state, dispatch } = useCareFlow();
  const router = useRouter();
  const [patientId, setPatientId] = useState("");
  const [date, setDate] = useState("2026-08-03");
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const patient = state.patients.find((item) => item.id === patientId);
  const occupied = useMemo(() => new Set(state.appointments.filter((appointment) => appointment.date === date).map((appointment) => appointment.time)), [date, state.appointments]);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!patient || !date || !time || !reason.trim()) { setError("กรุณาระบุผู้ป่วย วัน เวลา และเหตุผลการนัดหมาย"); return; }
    if (occupied.has(time)) { setError("ช่วงเวลานี้มีนัดหมายแล้ว กรุณาเลือกเวลาอื่น"); return; }
    dispatch({ type: "CREATE_APPOINTMENT", payload: { id: `appt-${Date.now()}`, patientId: patient.id, patientName: patient.name, date, time, durationMinutes: 60, reason: reason.trim(), notes: notes.trim(), tone: "blue" } });
    router.push("/appointments");
  }
  return <div className="operations-page appointment-form-page"><PageHeader eyebrow="NEW APPOINTMENT" title="นัดหมายใหม่" description="เลือกเวลาว่างและบันทึกข้อมูลเพื่อการติดตามที่ต่อเนื่อง" />
    <form className="appointment-form-layout" onSubmit={submit} noValidate><Card className="appointment-form-card"><SectionHeading icon={CalendarCheck2} title="รายละเอียดการนัด" description="ช่วงเวลาไม่ว่างจะถูกปิดไว้โดยอัตโนมัติ" />
      <div className="form-grid two-columns"><SelectField label="ผู้ป่วย *" value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">เลือกผู้ป่วย</option>{state.patients.map((item) => <option key={item.id} value={item.id}>{item.name} · HN {item.hn}</option>)}</SelectField><Field label="วันที่นัด *" type="date" min="2026-08-03" max="2026-08-07" value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} /></div>
      <fieldset className="time-fieldset"><legend>ช่วงเวลานัด * <small>เลือกหนึ่งช่วงเวลา</small></legend><div className="time-chips">{slots.map((slot) => { const unavailable = occupied.has(slot); return <button type="button" className={`time-chip ${time === slot ? "selected" : ""}`} key={slot} disabled={unavailable} aria-label={`${slot} ${unavailable ? "ไม่ว่าง" : "ว่าง"}`} onClick={() => setTime(slot)}>{slot}<small>{unavailable ? "ไม่ว่าง" : "ว่าง"}</small></button>; })}</div></fieldset>
      <TextAreaField label="เหตุผลการนัดหมาย *" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เช่น ตรวจติดตามอาการ" /><TextAreaField label="บันทึกเพิ่มเติม" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ข้อมูลสำหรับทีมคลินิก (ถ้ามี)" />
      {error ? <p className="stock-error" role="alert">{error}</p> : null}<div className="stock-actions"><ActionButton type="button" variant="ghost" icon={ArrowLeft} onClick={() => router.push("/appointments")}>ยกเลิก</ActionButton><ActionButton type="submit" icon={CalendarCheck2}>ยืนยันนัดหมาย</ActionButton></div>
    </Card><Card className="appointment-summary-card"><h2>สรุปก่อนบันทึก</h2><dl><div><dt>ผู้ป่วย</dt><dd>{patient?.name ?? "ยังไม่ได้เลือก"}</dd></div><div><dt>วันและเวลา</dt><dd>{date ? `${new Date(`${date}T12:00:00`).toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })}${time ? ` · ${time} น.` : ""}` : "—"}</dd></div><div><dt>เหตุผล</dt><dd>{reason || "—"}</dd></div></dl><p>ข้อมูลนัดหมายจะปรากฏในปฏิทินรายสัปดาห์ทันทีหลังบันทึก</p></Card></form>
  </div>;
}
