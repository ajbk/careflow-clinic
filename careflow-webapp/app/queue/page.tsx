import { AppShell } from "@/components/careflow/AppShell";
import { QueueScreen } from "@/components/careflow/screens/QueueScreen";

export default function QueuePage() {
  return <AppShell pathname="/queue"><QueueScreen /></AppShell>;
}
