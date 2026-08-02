import { AppShell } from "@/components/careflow/AppShell";
import { LabelsScreen } from "@/components/careflow/screens/LabelsScreen";

export default async function LabelsPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <AppShell pathname={`/dispensing/${visitId}/labels`}><LabelsScreen visitId={visitId} /></AppShell>;
}
