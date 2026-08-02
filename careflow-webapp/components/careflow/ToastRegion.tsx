"use client";

import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useCareFlow } from "@/lib/careflow/context";

export function ToastRegion() {
  const { state, dispatch } = useCareFlow();
  return (
    <div className="toast-region" aria-live="polite" aria-label="การแจ้งเตือน">
      {state.toasts.map((toast) => {
        const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? CircleAlert : Info;
        return (
          <div className={`toast toast-${toast.tone}`} key={toast.id} role="status">
            <Icon aria-hidden="true" size={20} />
            <span>{toast.message}</span>
            <button aria-label="ปิดการแจ้งเตือน" onClick={() => dispatch({ type: "DISMISS_TOAST", payload: { id: toast.id } })}>
              <X aria-hidden="true" size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
