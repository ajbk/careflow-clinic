import { useEffect, useReducer, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { isApiError } from "../../lib/api-error";
import { commandRecoveryEvent } from "../../lib/command-recovery";

/** Outcome resolution never repeats a physical payment/handoff or automatically resends a command. */
export function CommandRecoveryNotice() {
  const { apiClient } = useAuth();
  const queryClient = useQueryClient();
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    window.addEventListener(commandRecoveryEvent, refresh);
    // Auth commits its API context in a layout effect after children render.
    // Re-read persisted breadcrumbs after subscribing, including on a full reload.
    refresh();
    return () => window.removeEventListener(commandRecoveryEvent, refresh);
  }, []);
  let rows;
  try { rows = apiClient.pendingCommands(); }
  catch { return <section role="alert" className="workflow-blocked"><h2>ไม่สามารถตรวจสอบคำสั่งค้างได้</h2><p>หยุดทำรายการและให้ผู้ดูแลตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์ก่อนใช้งานต่อ</p></section>; }
  if (!rows.length && !message) return null;
  const resolve = async (key: string, action: "status" | "cancel" | "retry") => {
    setBusy(true); setMessage("");
    try {
      if (action === "retry") {
        await apiClient.retryCommand(key);
        setMessage("ได้รับผลคำสั่งเดิมแล้ว กรุณาตรวจสอบข้อมูลล่าสุดก่อนทำงานต่อ");
      } else {
        const status = await apiClient.resolveCommand(key, action === "cancel");
        setMessage(status === "COMMITTED" ? "ระบบบันทึกคำสั่งเดิมแล้ว ห้ามรับเงินหรือส่งมอบยาซ้ำ กรุณาตรวจสอบข้อมูลล่าสุด"
          : status === "CANCELLED" ? "ยกเลิกคำสั่งเดิมแล้ว กรุณาตรวจสอบข้อมูลล่าสุดก่อนสร้างรายการใหม่"
          : "ยังไม่พบหลักฐานผลคำสั่ง คำขออาจกำลังเดินทาง กรุณาตรวจอีกครั้งหรือยกเลิกคำสั่งเดิมให้สำเร็จก่อน");
      }
      await queryClient.invalidateQueries();
    } catch (error) { setMessage(isApiError(error) ? error.messageTh : "ยังตรวจสอบผลไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ"); }
    finally { setBusy(false); refresh(); }
  };
  return <section className="workflow-blocked" role="alert" aria-label="ตรวจสอบผลคำสั่งค้าง">
    {rows.length ? <><h2>ยังไม่ทราบผลคำสั่งก่อนหน้า</h2><p>หยุดรับเงิน ส่งมอบยา หรือสร้างรายการซ้ำ จนกว่าจะตรวจสอบผลสำเร็จ หากอินเทอร์เน็ตขัดข้อง ให้บันทึกบนกระดาษเพื่อกระทบยอดภายหลัง</p></> : null}
    {rows.map((row) => <div key={row.key} className="dialog-actions">
      <button type="button" disabled={busy} onClick={() => void resolve(row.key, "status")}>ตรวจสอบผลคำสั่ง</button>
      {apiClient.canRetryCommand(row.key) ? <button type="button" disabled={busy} onClick={() => void resolve(row.key, "retry")}>ส่งคำสั่งเดิมอีกครั้ง</button> : null}
      <button type="button" disabled={busy} onClick={() => void resolve(row.key, "cancel")}>ยกเลิกคำสั่งเดิมที่ยังไม่บันทึก</button>
    </div>)}
    {message ? <p>{message}</p> : null}
    {!rows.length ? <button type="button" onClick={() => setMessage("")}>รับทราบและตรวจสอบข้อมูลล่าสุด</button> : null}
  </section>;
}
