import type { Role } from "./types";

export type NavIcon =
  | "dashboard"
  | "queue"
  | "intake"
  | "consultation"
  | "patients"
  | "appointments"
  | "inventory"
  | "analytics";

export interface NavItem {
  href: string;
  label: string;
  labelEn: string;
  icon: NavIcon;
  roles: Role[];
}

export const navItems: NavItem[] = [
  { href: "/", label: "ภาพรวม", labelEn: "Overview", icon: "dashboard", roles: ["assistant", "doctor"] },
  { href: "/queue", label: "คิวผู้ป่วย", labelEn: "Queue", icon: "queue", roles: ["assistant", "doctor"] },
  { href: "/intake", label: "รับผู้ป่วย", labelEn: "Intake", icon: "intake", roles: ["assistant"] },
  { href: "/consultations/demo-visit", label: "ห้องตรวจ", labelEn: "Consultation", icon: "consultation", roles: ["doctor"] },
  { href: "/patients/patient-somchai/history", label: "เวชระเบียน", labelEn: "Patient history", icon: "patients", roles: ["doctor"] },
  { href: "/appointments", label: "นัดหมาย", labelEn: "Appointments", icon: "appointments", roles: ["assistant", "doctor"] },
  { href: "/inventory", label: "คลังยา", labelEn: "Inventory", icon: "inventory", roles: ["assistant", "doctor"] },
  { href: "/analytics", label: "รายงาน", labelEn: "Analytics", icon: "analytics", roles: ["doctor"] },
];

export function navItemsForRole(role: Role): NavItem[] {
  return navItems.filter((item) => item.roles.includes(role));
}
