"use client";

import { ClipboardPlus, Send, UserPlus } from "lucide-react";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import type { Patient, Vitals } from "@/lib/careflow/types";
import { ActionButton, Card, Field, PageHeader, SectionHeading, TextAreaField } from "../ui";

type IntakeDraft = {
  name: string;
  phone: string;
  age: string;
  gender: string;
  temperature: string;
  systolic: string;
  diastolic: string;
  weight: string;
  height: string;
  heartRate: string;
  spo2: string;
  chiefComplaint: string;
};

const initialDraft: IntakeDraft = {
  name: "", phone: "", age: "", gender: "", temperature: "", systolic: "", diastolic: "",
  weight: "", height: "", heartRate: "", spo2: "", chiefComplaint: "",
};

export function IntakeScreen() {
  const { dispatch } = useCareFlow();
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof IntakeDraft, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  function submit() {
    const nextErrors: Record<string, string> = {};
    if (!draft.name.trim()) nextErrors.name = "กรุณาระบุชื่อผู้ป่วย";
    if (!draft.temperature) nextErrors.temperature = "กรุณาระบุอุณหภูมิ";
    if (!draft.systolic || !draft.diastolic) nextErrors.pressure = "กรุณาระบุความดันโลหิต";
    if (!draft.chiefComplaint.trim()) nextErrors.chiefComplaint = "กรุณาระบุอาการสำคัญ";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const id = `patient-${Date.now()}`;
    const now = new Date().toISOString();
    const patient: Patient = {
      id,
      hn: `69-${String(Date.now()).slice(-5)}`,
      name: draft.name.trim(),
      phone: draft.phone.trim() || "ไม่ระบุ",
      age: Number(draft.age) || 0,
      gender: draft.gender || "ไม่ระบุ",
      allergies: [],
      totalVisits: 0,
    };
    const vitals: Vitals = {
      temperature: Number(draft.temperature), systolic: Number(draft.systolic), diastolic: Number(draft.diastolic),
      weight: Number(draft.weight) || 0, height: Number(draft.height) || 0, heartRate: Number(draft.heartRate) || 0, spo2: Number(draft.spo2) || 0,
    };
    dispatch({ type: "SUBMIT_INTAKE", payload: { patient, visit: { id: `visit-${Date.now()}`, arrivedAt: now, vitals, chiefComplaint: draft.chiefComplaint.trim() } } });
    setDraft(initialDraft);
    if (typeof window !== "undefined") window.history.pushState({}, "", "/queue");
  }

  return (
    <div className="flow-page intake-page">
      <PageHeader eyebrow="PATIENT INTAKE" title="รับผู้ป่วย" description="บันทึกข้อมูลที่จำเป็นก่อนส่งเข้าคิวแพทย์" />
      <form className="intake-layout" onSubmit={(event) => { event.preventDefault(); submit(); }} noValidate>
        <Card className="intake-card">
          <SectionHeading icon={UserPlus} title="ข้อมูลผู้ป่วย" description="กรอกข้อมูลพื้นฐานเพื่อสร้างเลขรับบริการ" />
          <div className="form-grid two-columns">
            <Field label="ชื่อ–นามสกุล *" value={draft.name} onChange={(event) => set("name", event.target.value)} error={errors.name} placeholder="เช่น สมชาย ใจดี" />
            <Field label="เบอร์โทรศัพท์" value={draft.phone} onChange={(event) => set("phone", event.target.value)} placeholder="08x-xxx-xxxx" inputMode="tel" />
            <Field label="อายุ" value={draft.age} onChange={(event) => set("age", event.target.value)} type="number" min="0" placeholder="ปี" />
            <label className="field"><span className="field-label">เพศ</span><select className="care-input care-select" value={draft.gender} onChange={(event) => set("gender", event.target.value)}><option value="">เลือกเพศ</option><option>หญิง</option><option>ชาย</option><option>ไม่ระบุ</option></select></label>
          </div>
        </Card>
        <Card className="intake-card">
          <SectionHeading icon={ClipboardPlus} title="สัญญาณชีพและอาการ" description="กรอกข้อมูลสำคัญก่อนพบแพทย์" />
          <div className="form-grid vital-grid">
            <Field label="อุณหภูมิ *" value={draft.temperature} onChange={(event) => set("temperature", event.target.value)} error={errors.temperature} type="number" step="0.1" placeholder="°C" />
            <Field label="ความดันตัวบน *" value={draft.systolic} onChange={(event) => set("systolic", event.target.value)} error={errors.pressure} type="number" placeholder="mmHg" />
            <Field label="ความดันตัวล่าง *" value={draft.diastolic} onChange={(event) => set("diastolic", event.target.value)} error={errors.pressure} type="number" placeholder="mmHg" />
            <Field label="ชีพจร" value={draft.heartRate} onChange={(event) => set("heartRate", event.target.value)} type="number" placeholder="ครั้ง/นาที" />
            <Field label="ออกซิเจนปลายนิ้ว" value={draft.spo2} onChange={(event) => set("spo2", event.target.value)} type="number" placeholder="%" />
            <Field label="น้ำหนัก" value={draft.weight} onChange={(event) => set("weight", event.target.value)} type="number" step="0.1" placeholder="กก." />
            <Field label="ส่วนสูง" value={draft.height} onChange={(event) => set("height", event.target.value)} type="number" placeholder="ซม." />
          </div>
          <div className="form-spacer"><TextAreaField label="อาการสำคัญ *" value={draft.chiefComplaint} onChange={(event) => set("chiefComplaint", event.target.value)} error={errors.chiefComplaint} placeholder="อาการที่มาพบแพทย์ ระยะเวลา และข้อมูลสำคัญ" /></div>
          <div className="form-actions"><ActionButton type="submit" icon={Send}>ส่งพบแพทย์</ActionButton></div>
        </Card>
      </form>
    </div>
  );
}
