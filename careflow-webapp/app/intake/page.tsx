import { AppShell } from "@/components/careflow/AppShell";
import { IntakeScreen } from "@/components/careflow/screens/IntakeScreen";

export default function IntakePage() {
  return <AppShell pathname="/intake"><IntakeScreen /></AppShell>;
}
