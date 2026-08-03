import type { ReactElement } from "react";

export type ScreenStateKind = "loading" | "error" | "denied" | "unavailable";

const copy: Record<ScreenStateKind, { title: string; message: string }> = {
  loading: { title: "กำลังโหลดข้อมูล", message: "กรุณารอสักครู่…" },
  error: { title: "ยืนยันตัวตนไม่สำเร็จ", message: "ไม่สามารถยืนยันการเข้าสู่ระบบได้ กรุณาลองใหม่" },
  denied: { title: "ไม่มีสิทธิ์ใช้งาน", message: "บัญชีนี้ไม่มีสิทธิ์เข้าถึงหน้าดังกล่าว" },
  unavailable: { title: "ระบบไม่พร้อมใช้งาน", message: "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง" },
};

export function ScreenState({
  kind,
  title,
  message,
  showPilotBanner = true,
}: {
  kind: ScreenStateKind;
  title?: string;
  message?: string;
  showPilotBanner?: boolean;
}): ReactElement {
  const defaults = copy[kind];
  return (
    <section className={`screen-state screen-state-${kind}`} aria-live="polite">
      {showPilotBanner ? <p className="pilot-banner" role="status">PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง</p> : null}
      <p className="eyebrow">CARE<span>FLOW</span> · LOCAL PILOT</p>
      <h1>{title ?? defaults.title}</h1>
      <p>{message ?? defaults.message}</p>
    </section>
  );
}
