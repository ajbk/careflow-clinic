import { createBrowserRouter, Outlet, type RouteObject } from "react-router-dom";
import { AuthGate, SessionOnlyRoute } from "../auth/AuthGate";
import { AuthProvider } from "../auth/AuthProvider";
import { ChangePasswordScreen } from "../auth/ChangePasswordScreen";
import { AuthScreenLayout, LoginScreen } from "../auth/LoginScreen";
import { PilotRulesScreen } from "../auth/PilotRulesScreen";
import { AppShell } from "../components/careflow/AppShell";
import { PilotUnavailableScreen } from "../screens/PilotUnavailableScreen";

function ShellRoute() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function AuthRootRoute() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export const appRoutes: RouteObject[] = [
  {
    element: <AuthRootRoute />,
    children: [
      { path: "login", element: <AuthScreenLayout><LoginScreen /></AuthScreenLayout> },
      { path: "pilot-rules", element: <SessionOnlyRoute><AuthScreenLayout><PilotRulesScreen /></AuthScreenLayout></SessionOnlyRoute> },
      { path: "change-password", element: <SessionOnlyRoute><AuthScreenLayout><ChangePasswordScreen /></AuthScreenLayout></SessionOnlyRoute> },
      {
        element: <AuthGate><ShellRoute /></AuthGate>,
        children: [
          { index: true, element: <PilotUnavailableScreen title="ภาพรวม" /> },
          { path: "intake", element: <PilotUnavailableScreen title="รับผู้ป่วย" /> },
          { path: "queue", element: <PilotUnavailableScreen title="คิวผู้ป่วย" /> },
          { path: "consultations/:visitId", element: <PilotUnavailableScreen title="ห้องตรวจ" /> },
          { path: "dispensing/:visitId", element: <PilotUnavailableScreen title="จัดยา" /> },
          { path: "dispensing/:visitId/labels", element: <PilotUnavailableScreen title="ฉลากยา" /> },
          { path: "checkout/:visitId", element: <PilotUnavailableScreen title="ชำระเงิน" /> },
          { path: "visits/:visitId/opd-card", element: <PilotUnavailableScreen title="บัตร OPD" /> },
          { path: "inventory", element: <PilotUnavailableScreen title="คลังยา" /> },
          { path: "inventory/receive", element: <PilotUnavailableScreen title="รับยาเข้าคลัง" /> },
        ],
      },
    ],
  },
];

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes);
}
