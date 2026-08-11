import type { FormEvent, ReactElement } from "react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ScreenState } from "../components/careflow/ScreenState";
import { ApiError } from "../lib/api-error";
import { sanitizeReturnTo, type SessionReturnState, useAuth } from "./AuthProvider";

export function AuthScreenLayout({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="auth-layout">
      <main className="auth-main">
        <p className="pilot-banner" role="status">PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง</p>
        {children}
      </main>
    </div>
  );
}

export function LoginScreen(): ReactElement {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const search = new URLSearchParams(location.search);
  const target = sanitizeReturnTo(search.get("returnTo"));
  const returnState: SessionReturnState | null = search.get("reason") === "session-expired"
    ? { authNotice: "SESSION_EXPIRED" }
    : null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await auth.login({ username, password });
      if (!session.pilotAcknowledgedAt) {
        navigate(`/pilot-rules?returnTo=${encodeURIComponent(target)}`, { replace: true });
      } else if (session.mustChangePassword) {
        navigate(`/change-password?returnTo=${encodeURIComponent(target)}`, { replace: true });
      } else {
        navigate(target, { replace: true, state: returnState });
      }
    } catch (value) {
      setError(value instanceof ApiError ? value : new ApiError({ status: 0, code: "SERVER_UNAVAILABLE", messageTh: "ระบบไม่พร้อมใช้งาน" }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="login-heading">
      <p className="eyebrow">CARE<span>FLOW</span> · LOCAL PILOT</p>
      <h1 id="login-heading">เข้าสู่ระบบ</h1>
      <p className="auth-intro">ใช้บัญชีที่ผู้ดูแลคลินิกสร้างให้ เพื่อเข้าสู่ระบบคลินิกนี้</p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="username">ชื่อผู้ใช้</label>
        <input id="username" name="username" autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="password">รหัสผ่าน</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error ? <p className="form-error" role="alert">{error.messageTh}</p> : null}
        <button className="primary-button auth-submit" disabled={submitting} type="submit">{submitting ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}</button>
      </form>
      <p className="auth-note">ระบบนี้ใช้ข้อมูลสังเคราะห์สำหรับการทดลองเท่านั้น</p>
    </section>
  );
}

export function LoginUnavailable(): ReactElement {
  return <ScreenState kind="unavailable" />;
}
