import { createBrowserRouter, Outlet, type RouteObject } from "react-router-dom";
import { AppShell } from "../components/careflow/AppShell";
import { PilotUnavailableScreen } from "../screens/PilotUnavailableScreen";

function ShellRoute() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export const appRoutes: RouteObject[] = [
  {
    element: <ShellRoute />,
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
];

export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(appRoutes);
}
