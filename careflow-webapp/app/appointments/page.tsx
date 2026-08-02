import { AppShell } from "@/components/careflow/AppShell";
import { AppointmentsScreen } from "@/components/careflow/screens/AppointmentsScreen";

export default function AppointmentsPage() {
  return <AppShell pathname="/appointments"><AppointmentsScreen /></AppShell>;
}
