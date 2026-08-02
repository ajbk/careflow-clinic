import { AppShell } from "@/components/careflow/AppShell";
import { CheckoutScreen } from "@/components/careflow/screens/CheckoutScreen";

export default async function CheckoutPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  return <AppShell pathname={`/checkout/${visitId}`}><CheckoutScreen visitId={visitId} /></AppShell>;
}
