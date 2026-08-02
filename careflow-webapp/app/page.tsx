import { AppShell } from "@/components/careflow/AppShell";
import { OverviewScreen } from "@/components/careflow/screens/OverviewScreen";

export default function Home() {
  return <AppShell pathname="/"><OverviewScreen /></AppShell>;
}
