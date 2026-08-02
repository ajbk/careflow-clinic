import { AppShell } from "@/components/careflow/AppShell";
import { InventoryScreen } from "@/components/careflow/screens/InventoryScreen";

export default function InventoryPage() {
  return <AppShell pathname="/inventory"><InventoryScreen /></AppShell>;
}
