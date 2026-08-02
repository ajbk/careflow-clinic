"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Rows3 } from "lucide-react";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../ui";

const week = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const times = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
const dayFormat = new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function toneFor(tone: string) { return tone === "rose" ? "warning" : tone === "blue" ? "info" : "success" as const; }

export function AppointmentsScreen() {
  const { state } = useCareFlow();
  const [view, setView] = useState<"week" | "list">("week");
  const events = state.appointments.filter((item) => week.includes(item.date));

  return <div className="operations-page appointments-page">
    <PageHeader eyebrow="APPOINTMENT CALENDAR" title="ปฏิทินนัดหมาย" description="สัปดาห์ 3–7 สิงหาคม 2569 · แสดงปีพุทธศักราชเพื่อการทำงานในคลินิก" actions={<Link className="care-button care-button-primary" href="/appointments/new"><Plus aria-hidden="true" size={18} />นัดหมายใหม่</Link>} />
    <Card className="calendar-card"><div className="calendar-toolbar"><div><SectionHeading icon={CalendarDays} title="สัปดาห์นี้" description="3–7 สิงหาคม 2569" /></div><div className="calendar-controls"><button className="calendar-arrow" aria-label="สัปดาห์ก่อนหน้า" disabled><ChevronLeft aria-hidden="true" size={19} /></button><button className="calendar-arrow" aria-label="สัปดาห์ถัดไป" disabled><ChevronRight aria-hidden="true" size={19} /></button><div className="view-toggle" aria-label="รูปแบบปฏิทิน"><button type="button" className={view === "week" ? "is-active" : ""} onClick={() => setView("week")}><Rows3 aria-hidden="true" size={16} />รายสัปดาห์</button><button type="button" className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><List aria-hidden="true" size={16} />รายการ</button></div></div></div>
      {view === "week" ? <section className="calendar-scroll" aria-label="ปฏิทินนัดหมายประจำสัปดาห์"><div className="week-calendar"><div className="time-column"><span>เวลา</span>{times.map((time) => <span key={time}>{time}</span>)}</div>{week.map((date) => <div className={`calendar-day ${date === "2026-08-03" ? "calendar-day-current" : ""}`} key={date}><header><strong>{dayFormat.format(new Date(`${date}T12:00:00`))}</strong>{date === "2026-08-03" ? <small>วันนี้</small> : null}</header>{times.map((time) => { const matching = events.filter((event) => event.date === date && event.time === time); return <div className="calendar-slot" key={time}>{matching.map((event) => <article className={`appointment-event event-${event.tone}`} key={event.id}><strong>{event.patientName}</strong><span>{event.reason}</span><small>{event.time} น.</small></article>)}</div>; })}</div>)}</div></section> : <div className="appointment-list-view">{events.length ? events.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map((event) => <article key={event.id}><span>{dayFormat.format(new Date(`${event.date}T12:00:00`))} · {event.time} น.</span><strong>{event.patientName}</strong><p>{event.reason}</p><StatusBadge tone={toneFor(event.tone)}>นัดหมาย</StatusBadge></article>) : <EmptyState icon={CalendarDays} title="ยังไม่มีนัดหมาย" detail="เริ่มบันทึกนัดติดตามได้จากปุ่มด้านบน" />}</div>}
    </Card>
  </div>;
}
