import { AppShell } from "@/components/careflow/AppShell";
import { ConsultationScreen } from "@/components/careflow/screens/ConsultationScreen";

export default async function ConsultationPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <AppShell pathname={`/consultations/${visitId}`}><ConsultationScreen visitId={visitId} /></AppShell>;
}
