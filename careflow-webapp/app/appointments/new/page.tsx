import { AppShell } from "@/components/careflow/AppShell";
import { NewAppointmentScreen } from "@/components/careflow/screens/NewAppointmentScreen";

export default function NewAppointmentPage() {
  return <AppShell pathname="/appointments/new"><NewAppointmentScreen /></AppShell>;
}
