import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api-error";
import { sanitizeReturnTo, useAuth } from "./AuthProvider";

export function PilotRulesScreen(): ReactElement {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const target = sanitizeReturnTo(new URLSearchParams(location.search).get("returnTo"));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accepted) {
      setError(new ApiError({ status: 422, code: "VALIDATION_FAILED", messageTh: "กรุณายืนยันว่าคุณเข้าใจกติกาการใช้ข้อมูลสังเคราะห์" }));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await auth.acknowledgePilot();
      if (auth.session?.mustChangePassword) {
        navigate(`/change-password?returnTo=${encodeURIComponent(target)}`, { replace: true });
      } else {
        navigate(target, { replace: true });
      }
    } catch (value) {
      setError(value instanceof ApiError ? value : new ApiError({ status: 0, code: "SERVER_UNAVAILABLE", messageTh: "ระบบไม่พร้อมใช้งาน" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card rules-card" aria-labelledby="pilot-rules-heading">
      <p className="eyebrow">กติกาการใช้งาน</p>
      <h1 id="pilot-rules-heading">ยืนยันกติกา Local Pilot</h1>
      <p className="auth-intro">สวัสดี {auth.session?.user.displayName} ก่อนเริ่มใช้งาน กรุณายืนยันว่าข้อมูลในระบบเป็นข้อมูลสังเคราะห์เท่านั้น</p>
      <ul className="rules-list">
        <li>ห้ามกรอกข้อมูลผู้ป่วยจริงหรือข้อมูลที่ระบุตัวบุคคลได้</li>
        <li>ข้อมูลใน Pilot ใช้เพื่อทดสอบขั้นตอนการทำงานและสามารถถูกล้างได้</li>
        <li>ระบบจะบันทึกกิจกรรมของบัญชีที่ใช้งานไว้ใน Audit</li>
      </ul>
      <form className="auth-form" onSubmit={submit}>
        <label className="checkbox-label" htmlFor="pilot-accepted">
          <input id="pilot-accepted" type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>ฉันเข้าใจและจะใช้ข้อมูลสังเคราะห์เท่านั้น</span>
        </label>
        {error ? <p className="form-error" role="alert">{error.messageTh}</p> : null}
        <button className="primary-button auth-submit" disabled={submitting} type="submit">{submitting ? "กำลังบันทึก…" : "ยืนยันและดำเนินการต่อ"}</button>
      </form>
      <button className="secondary-button auth-logout" type="button" onClick={() => void auth.logout()}>ออกจากระบบ</button>
    </section>
  );
}
