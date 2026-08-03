import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { roleWorkspaceFor } from "../app/role-workspace";
import { useAuth } from "../auth/AuthProvider";

export function RoleLandingScreen(): ReactElement | null {
  const { session } = useAuth();
  if (!session) return null;
  return <Navigate replace to={roleWorkspaceFor(session.user.role).homePath} />;
}
