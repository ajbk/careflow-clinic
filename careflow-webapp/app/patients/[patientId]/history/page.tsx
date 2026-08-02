import { AppShell } from "@/components/careflow/AppShell";
import { PatientHistoryScreen } from "@/components/careflow/screens/PatientHistoryScreen";

export default async function PatientHistoryPage({ params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  return <AppShell pathname={`/patients/${patientId}/history`}><PatientHistoryScreen patientId={patientId} /></AppShell>;
}
