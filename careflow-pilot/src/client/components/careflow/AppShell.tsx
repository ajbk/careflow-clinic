import type { ReactNode } from "react";
import {
  ClipboardPlus,
  HeartPulse,
  LayoutDashboard,
  Menu,
  PackageOpen,
  Stethoscope,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";

type NavIcon = "dashboard" | "queue" | "intake" | "consultation" | "inventory";
type NavPermission = "patient:create-synthetic" | "visit:read-queue" | "visit:submit-intake" | "visit:start-consultation";

const icons: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  queue: UsersRound,
  intake: ClipboardPlus,
  consultation: Stethoscope,
  inventory: PackageOpen,
};

const navItems: Array<{ href: string; label: string; labelEn: string; icon: NavIcon; permission?: NavPermission }> = [
  { href: "/", label: "ภาพรวม", labelEn: "Overview", icon: "dashboard", permission: "visit:read-queue" },
  { href: "/queue", label: "คิวผู้ป่วย", labelEn: "Queue", icon: "queue", permission: "visit:read-queue" },
  { href: "/intake", label: "รับผู้ป่วย", labelEn: "Intake", icon: "intake", permission: "visit:submit-intake" },
  { href: "/consultations/pilot-visit", label: "ห้องตรวจ", labelEn: "Consultation", icon: "consultation", permission: "visit:start-consultation" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  const permissions = auth.session?.permissions ?? [];
  const visibleNavItems = navItems.filter((item) => !item.permission || permissions.includes(item.permission));
  const roleLabel = auth.session?.user.role === "doctor" ? "แพทย์" : "ผู้ช่วย";

  const nav = (
    <nav aria-label="เมนูหลัก" className="sidebar-nav">
      {visibleNavItems.map((item) => {
        const Icon = icons[item.icon];
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}
            key={item.href}
            onClick={() => setMobileOpen(false)}
            to={item.href}
          >
            <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
            <span><strong>{item.label}</strong><small>{item.labelEn}</small></span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <aside className="desktop-sidebar">
        <Link to="/" className="brand-lockup" aria-label="CareFlow หน้าหลัก">
          <span className="brand-mark"><HeartPulse aria-hidden="true" size={24} /></span>
          <span><strong>CareFlow</strong><small>Rural Health Commons</small></span>
        </Link>
        <span className="prototype-badge">Local Pilot</span>
        {nav}
        <div className="sidebar-footer">
          <div className="role-card">
            <span className="role-avatar">{auth.session?.user.displayName.slice(0, 1) ?? "?"}</span>
            <span><strong>{auth.session?.user.displayName ?? "บัญชี Pilot"}</strong><small>{roleLabel}</small></span>
          </div>
          <button className="reset-button" type="button" onClick={() => void auth.logout()}>ออกจากระบบ</button>
        </div>
      </aside>

      <div className="mobile-topbar">
        <Link to="/" className="brand-lockup"><span className="brand-mark"><HeartPulse aria-hidden="true" size={21} /></span><strong>Care<span>Flow</span></strong></Link>
        <button className="icon-button" aria-label={mobileOpen ? "ปิดเมนู" : "เปิดเมนู"} onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {mobileOpen ? <div className="mobile-drawer"><span className="prototype-badge">Local Pilot</span>{nav}</div> : null}

      <div className="app-workspace">
        <header className="workspace-topbar">
          <div className="clinic-open"><span /> คลินิกเปิดให้บริการ</div>
          <button className="account-placeholder" type="button" onClick={() => void auth.logout()}>{auth.session?.user.displayName ?? "บัญชีผู้ใช้"} · {roleLabel}</button>
        </header>
        <main id="main-content" className="app-main">
          <p className="pilot-banner" role="status">PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง</p>
          {children}
        </main>
      </div>
    </div>
  );
}
