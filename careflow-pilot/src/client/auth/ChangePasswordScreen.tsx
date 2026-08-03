import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api-error";
import { sanitizeReturnTo, useAuth } from "./AuthProvider";

export function ChangePasswordScreen(): ReactElement {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const target = sanitizeReturnTo(new URLSearchParams(location.search).get("returnTo"));

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError(new ApiError({ status: 422, code: "VALIDATION_FAILED", messageTh: "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน" }));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await auth.changePassword({ currentPassword, newPassword });
      navigate(target, { replace: true });
    } catch (value) {
      setError(value instanceof ApiError ? value : new ApiError({ status: 0, code: "SERVER_UNAVAILABLE", messageTh: "ระบบไม่พร้อมใช้งาน" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="change-password-heading">
      <p className="eyebrow">ความปลอดภัยบัญชี</p>
      <h1 id="change-password-heading">เปลี่ยนรหัสผ่าน</h1>
      <p className="auth-intro">บัญชีของคุณต้องเปลี่ยนรหัสผ่านก่อนใช้งาน รหัสผ่านต้องยาว 12–128 ตัวอักษร</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="current-password">รหัสผ่านปัจจุบัน</label>
        <input id="current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <label htmlFor="new-password">รหัสผ่านใหม่</label>
        <input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <label htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</label>
        <input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        {error ? <p className="form-error" role="alert">{error.messageTh}</p> : null}
        <button className="primary-button auth-submit" disabled={submitting} type="submit">{submitting ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}</button>
      </form>
      <button className="secondary-button auth-logout" type="button" onClick={() => void auth.logout()}>ออกจากระบบ</button>
    </section>
  );
}
