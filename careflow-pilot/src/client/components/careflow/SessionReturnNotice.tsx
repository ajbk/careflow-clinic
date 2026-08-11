import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SessionReturnState } from "../../auth/AuthProvider";

function sessionNotice(state: unknown): SessionReturnState["authNotice"] | undefined {
  if (typeof state !== "object" || state === null || !("authNotice" in state)) return undefined;
  return (state as SessionReturnState).authNotice;
}

export function SessionReturnNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnedNotice = sessionNotice(location.state);
  const locationKey = `${location.pathname}${location.search}${location.hash}`;
  const [notice] = useState(returnedNotice);

  useEffect(() => {
    if (returnedNotice !== "SESSION_EXPIRED") return;
    navigate(locationKey, { replace: true, state: null });
  }, [locationKey, navigate, returnedNotice]);

  if (notice !== "SESSION_EXPIRED") return null;
  return <p className="session-return-notice" role="status">เซสชันหมดอายุ งานยังไม่ได้ถูกบันทึก</p>;
}
