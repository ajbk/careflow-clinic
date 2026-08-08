import { createBrowserRouter, Outlet, type RouteObject } from "react-router-dom";
import { AuthGate, SessionOnlyRoute } from "../auth/AuthGate";
import { AuthProvider } from "../auth/AuthProvider";
import { ChangePasswordScreen } from "../auth/ChangePasswordScreen";
import { AuthScreenLayout, LoginScreen } from "../auth/LoginScreen";
import { PilotRulesScreen } from "../auth/PilotRulesScreen";
import { AppShell } from "../components/careflow/AppShell";
import { RoleLandingScreen } from "../screens/RoleLandingScreen";
import { OverviewScreen } from "../screens/OverviewScreen";
import { QueueScreen } from "../screens/QueueScreen";
import { ConsultationScreen } from "../screens/ConsultationScreen";
import { IntakeScreen } from "../screens/IntakeScreen";
import { InventoryScreen } from "../screens/InventoryScreen";
import { StockReceptionScreen } from "../screens/StockReceptionScreen";
import { DispensingScreen } from "../screens/DispensingScreen";
import { LabelScreen } from "../screens/LabelScreen";
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
      { path: "pilot-rules", element: <SessionOnlyRoute requiredState="pilot-rules"><AuthScreenLayout><PilotRulesScreen /></AuthScreenLayout></SessionOnlyRoute> },
      { path: "change-password", element: <SessionOnlyRoute requiredState="change-password"><AuthScreenLayout><ChangePasswordScreen /></AuthScreenLayout></SessionOnlyRoute> },
      {
        element: <AuthGate><ShellRoute /></AuthGate>,
        children: [
          { index: true, element: <RoleLandingScreen /> },
          { path: "intake", element: <AuthGate requiredPermission="visit:submit-intake" showPilotBanner={false}><IntakeScreen /></AuthGate> },
          { path: "queue", element: <AuthGate requiredPermission="visit:read-queue" showPilotBanner={false}><QueueScreen /></AuthGate> },
          { path: "overview", element: <AuthGate requiredPermission="visit:read-queue" showPilotBanner={false}><OverviewScreen /></AuthGate> },
          { path: "consultations/:visitId", element: <AuthGate requiredPermission="clinical:read" showPilotBanner={false}><ConsultationScreen /></AuthGate> },
          { path: "dispensing/:visitId", element: <AuthGate requiredPermission="fulfillment:read" showPilotBanner={false}><DispensingScreen /></AuthGate> },
          { path: "dispensing/:visitId/labels", element: <AuthGate requiredPermission="fulfillment:read" showPilotBanner={false}><LabelScreen /></AuthGate> },
          { path: "checkout/:visitId", element: <PilotUnavailableScreen title="ชำระเงิน" /> },
          { path: "visits/:visitId/opd-card", element: <PilotUnavailableScreen title="บัตร OPD" /> },
          { path: "inventory", element: <AuthGate requiredPermission="inventory:read" showPilotBanner={false}><InventoryScreen /></AuthGate> },
          { path: "inventory/receive", element: <AuthGate requiredPermission="inventory:receive" showPilotBanner={false}><StockReceptionScreen /></AuthGate> },
        ],
      },
    ],
  },
];

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes);
}
