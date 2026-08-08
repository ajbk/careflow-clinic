import type { SessionDto } from "../../shared/contracts";

export type WorkspaceNavIcon = "dashboard" | "queue" | "intake" | "inventory";

export interface WorkspaceNavItem {
  href: "/intake" | "/queue" | "/overview" | "/inventory";
  label: string;
  labelEn: string;
  icon: WorkspaceNavIcon;
}

export interface RoleWorkspace {
  homePath: "/intake" | "/queue";
  label: string;
  labelEn: "ASSISTANT WORKSPACE" | "DOCTOR WORKSPACE";
  navItems: readonly WorkspaceNavItem[];
}

const assistantWorkspace: RoleWorkspace = {
  homePath: "/intake",
  label: "งานผู้ช่วย",
  labelEn: "ASSISTANT WORKSPACE",
  navItems: [
    { href: "/intake", label: "รับผู้ป่วย", labelEn: "Intake", icon: "intake" },
    { href: "/queue", label: "คิวผู้ป่วย", labelEn: "Queue", icon: "queue" },
    { href: "/inventory", label: "คลังยา", labelEn: "Inventory", icon: "inventory" },
    { href: "/overview", label: "ภาพรวม", labelEn: "Overview", icon: "dashboard" },
  ],
};

const doctorWorkspace: RoleWorkspace = {
  homePath: "/queue",
  label: "งานแพทย์",
  labelEn: "DOCTOR WORKSPACE",
  navItems: [
    { href: "/queue", label: "คิวผู้ป่วย", labelEn: "Queue", icon: "queue" },
    { href: "/inventory", label: "คลังยา", labelEn: "Inventory", icon: "inventory" },
    { href: "/overview", label: "ภาพรวม", labelEn: "Overview", icon: "dashboard" },
  ],
};

export function roleWorkspaceFor(role: SessionDto["user"]["role"]): RoleWorkspace {
  return role === "assistant" ? assistantWorkspace : doctorWorkspace;
}
