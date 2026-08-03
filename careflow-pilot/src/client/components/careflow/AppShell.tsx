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

type NavIcon = "dashboard" | "queue" | "intake" | "consultation" | "inventory";

const icons: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  queue: UsersRound,
  intake: ClipboardPlus,
  consultation: Stethoscope,
  inventory: PackageOpen,
};

const navItems: Array<{ href: string; label: string; labelEn: string; icon: NavIcon }> = [
  { href: "/", label: "ภาพรวม", labelEn: "Overview", icon: "dashboard" },
  { href: "/queue", label: "คิวผู้ป่วย", labelEn: "Queue", icon: "queue" },
  { href: "/intake", label: "รับผู้ป่วย", labelEn: "Intake", icon: "intake" },
  { href: "/consultations/pilot-visit", label: "ห้องตรวจ", labelEn: "Consultation", icon: "consultation" },
  { href: "/inventory", label: "คลังยา", labelEn: "Inventory", icon: "inventory" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  const nav = (
    <nav aria-label="เมนูหลัก" className="sidebar-nav">
      {navItems.map((item) => {
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
            <span className="role-avatar">?</span>
            <span><strong>บัญชี Pilot</strong><small>รอการลงชื่อเข้าใช้</small></span>
          </div>
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
          <button className="account-placeholder" disabled type="button">บัญชีผู้ใช้จะพร้อมใน milestone ถัดไป</button>
        </header>
        <main id="main-content" className="app-main">
          <p className="pilot-banner" role="status">PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง</p>
          {children}
        </main>
      </div>
    </div>
  );
}
