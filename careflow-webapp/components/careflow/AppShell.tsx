"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  Archive,
  BarChart3,
  CalendarDays,
  ClipboardPlus,
  Grid2X2,
  HeartPulse,
  LayoutDashboard,
  Menu,
  PackageOpen,
  RefreshCcw,
  Search,
  Stethoscope,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { navItemsForRole, type NavIcon } from "@/lib/careflow/route-access";
import { ToastRegion } from "./ToastRegion";

const icons: Record<NavIcon, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  queue: UsersRound,
  intake: ClipboardPlus,
  consultation: Stethoscope,
  patients: Archive,
  appointments: CalendarDays,
  inventory: PackageOpen,
  analytics: BarChart3,
};

export function AppShell({ children, pathname }: { children: ReactNode; pathname?: string }) {
  const { state, dispatch } = useCareFlow();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentPath = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const items = navItemsForRole(state.role);

  const nav = (
    <nav aria-label="เมนูหลัก" className="sidebar-nav">
      {items.map((item) => {
        const Icon = icons[item.icon];
        const active = item.href === "/" ? currentPath === "/" : currentPath.startsWith(item.href);
        return (
          <Link
            href={item.href}
            className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}
            key={item.href}
            onClick={() => setMobileOpen(false)}
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
        <Link href="/" className="brand-lockup" aria-label="CareFlow หน้าหลัก">
          <span className="brand-mark"><HeartPulse aria-hidden="true" size={24} /></span>
          <span><strong>CareFlow</strong><small>Rural Health Commons</small></span>
        </Link>
        <span className="prototype-badge">ต้นแบบสำหรับการสาธิต</span>
        {nav}
        <div className="sidebar-footer">
          <div className="role-card">
            <span className="role-avatar">{state.role === "doctor" ? "อ" : "ผ"}</span>
            <span><strong>{state.role === "doctor" ? "พญ. อริสรา" : "คุณสุภาภรณ์"}</strong><small>{state.role === "doctor" ? "แพทย์ประจำคลินิก" : "ผู้ช่วยคลินิก"}</small></span>
          </div>
          <button
            className="role-switch"
            aria-label={state.role === "doctor" ? "เปลี่ยนเป็นผู้ช่วย" : "เปลี่ยนเป็นแพทย์"}
            onClick={() => dispatch({ type: "SET_ROLE", payload: { role: state.role === "doctor" ? "assistant" : "doctor" } })}
          >
            <RefreshCcw aria-hidden="true" size={17} />
            {state.role === "doctor" ? "ดูในบทบาทผู้ช่วย" : "ดูในบทบาทแพทย์"}
          </button>
          <button className="reset-button" aria-label="รีเซ็ตข้อมูลตัวอย่าง" onClick={() => dispatch({ type: "RESET_DEMO" })}>
            <RefreshCcw aria-hidden="true" size={17} /> รีเซ็ตข้อมูลตัวอย่าง
          </button>
        </div>
      </aside>

      <div className="mobile-topbar">
        <Link href="/" className="brand-lockup"><span className="brand-mark"><HeartPulse aria-hidden="true" size={21} /></span><strong>CareFlow</strong></Link>
        <button className="icon-button" aria-label={mobileOpen ? "ปิดเมนู" : "เปิดเมนู"} onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>

      {mobileOpen ? <div className="mobile-drawer"><span className="prototype-badge">ต้นแบบสำหรับการสาธิต</span>{nav}</div> : null}

      <div className="app-workspace">
        <header className="workspace-topbar">
          <label className="global-search">
            <Search aria-hidden="true" size={19} />
            <span className="sr-only">ค้นหาใน CareFlow</span>
            <input placeholder="ค้นหาผู้ป่วย HN หรือยา..." />
          </label>
          <div className="clinic-open"><span /> คลินิกเปิดให้บริการ</div>
          <button
            className="top-role-switch"
            aria-label={state.role === "doctor" ? "เปลี่ยนเป็นผู้ช่วย" : "เปลี่ยนเป็นแพทย์"}
            onClick={() => dispatch({ type: "SET_ROLE", payload: { role: state.role === "doctor" ? "assistant" : "doctor" } })}
          >
            {state.role === "doctor" ? <Stethoscope aria-hidden="true" size={18} /> : <Grid2X2 aria-hidden="true" size={18} />}
            {state.role === "doctor" ? "แพทย์" : "ผู้ช่วย"}
          </button>
        </header>
        <main id="main-content" className="app-main">{children}</main>
      </div>
      <ToastRegion />
    </div>
  );
}
