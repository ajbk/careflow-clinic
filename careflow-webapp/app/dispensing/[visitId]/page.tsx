import { AppShell } from "@/components/careflow/AppShell";
import { DispensingScreen } from "@/components/careflow/screens/DispensingScreen";

export default async function DispensingPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <AppShell pathname={`/dispensing/${visitId}`}><DispensingScreen visitId={visitId} /></AppShell>;
}
