import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import type { Permission } from "../../shared/contracts";
import { ScreenState } from "../components/careflow/ScreenState";
import { isApiError } from "../lib/api-error";
import { sanitizeReturnTo, useAuth } from "./AuthProvider";

function loginTarget(pathname: string, search: string): string {
  const returnTo = sanitizeReturnTo(`${pathname}${search}`);
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function returnTarget(search: string): string {
  return sanitizeReturnTo(new URLSearchParams(search).get("returnTo"));
}

export function SessionOnlyRoute({
  children,
  requiredState,
}: {
  children: ReactNode;
  requiredState?: "pilot-rules" | "change-password";
}): ReactElement {
  const location = useLocation();
  const auth = useAuth();
  if (auth.isLoading) return <ScreenState kind="loading" />;
  if (auth.error) {
    if (isApiError(auth.error) && auth.error.status === 401) {
      return <Navigate replace to={loginTarget(location.pathname, location.search)} />;
    }
    return <ScreenState kind={auth.error.code === "SERVER_UNAVAILABLE" ? "unavailable" : "error"} />;
  }
  if (!auth.session) return <Navigate replace to={loginTarget(location.pathname, location.search)} />;
  if (requiredState === "pilot-rules") {
    if (auth.session.pilotAcknowledgedAt) {
      const target = returnTarget(location.search);
      if (auth.session.mustChangePassword) {
        return <Navigate replace to={`/change-password?returnTo=${encodeURIComponent(target)}`} />;
      }
      return <Navigate replace to={target} />;
    }
  }
  if (requiredState === "change-password") {
    const target = returnTarget(location.search);
    if (!auth.session.pilotAcknowledgedAt) {
      return <Navigate replace to={`/pilot-rules?returnTo=${encodeURIComponent(target)}`} />;
    }
    if (!auth.session.mustChangePassword) return <Navigate replace to={target} />;
  }
  return <>{children}</>;
}

export function AuthGate({ children, requiredPermission }: { children: ReactNode; requiredPermission?: Permission }): ReactElement {
  const location = useLocation();
  const auth = useAuth();
  if (auth.isLoading) return <ScreenState kind="loading" />;
  if (auth.error) {
    if (isApiError(auth.error) && auth.error.status === 401) {
      return <Navigate replace to={loginTarget(location.pathname, location.search)} />;
    }
    return <ScreenState kind={auth.error.code === "SERVER_UNAVAILABLE" ? "unavailable" : "error"} />;
  }
  if (!auth.session) return <Navigate replace to={loginTarget(location.pathname, location.search)} />;
  if (requiredPermission && !auth.session.permissions.includes(requiredPermission)) return <ScreenState kind="denied" />;
  const target = sanitizeReturnTo(`${location.pathname}${location.search}`);
  if (!auth.session.pilotAcknowledgedAt && location.pathname !== "/pilot-rules") {
    return <Navigate replace to={`/pilot-rules?returnTo=${encodeURIComponent(target)}`} />;
  }
  if (auth.session.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate replace to={`/change-password?returnTo=${encodeURIComponent(target)}`} />;
  }
  return <>{children}</>;
}
