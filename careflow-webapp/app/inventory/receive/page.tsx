import { AppShell } from "@/components/careflow/AppShell";
import { StockReceptionScreen } from "@/components/careflow/screens/StockReceptionScreen";

export default function StockReceptionPage() {
  return <AppShell pathname="/inventory/receive"><StockReceptionScreen /></AppShell>;
}
