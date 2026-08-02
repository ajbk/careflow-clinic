import { AppShell } from "@/components/careflow/AppShell";
import { OpdCardScreen } from "@/components/careflow/screens/OpdCardScreen";

export default async function OpdCardPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <AppShell pathname={`/visits/${visitId}/opd-card`}><OpdCardScreen visitId={visitId} /></AppShell>;
}
