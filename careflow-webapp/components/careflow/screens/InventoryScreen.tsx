"use client";

import Link from "next/link";
import { AlertTriangle, PackageOpen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectInventoryStatus } from "@/lib/careflow/selectors";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../ui";

function inventoryBadge(status: ReturnType<typeof selectInventoryStatus>) {
  if (status === "healthy") return ["พร้อมใช้", "success"] as const;
  if (status === "low") return ["ใกล้หมด", "warning"] as const;
  return ["หมด", "error"] as const;
}

export function InventoryScreen() {
  const { state } = useCareFlow();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return state.inventory.filter((item) => !lower || [item.nameTh, item.name, item.code].some((value) => value.toLowerCase().includes(lower)));
  }, [query, state.inventory]);
  const urgent = state.inventory.filter((item) => selectInventoryStatus(item) !== "healthy");

  return <div className="operations-page inventory-page">
    <PageHeader eyebrow="MEDICATION REGISTRY" title="คลังยา" description="ติดตามคงเหลือ ล็อต และรายการที่ต้องดูแลก่อนผู้ป่วยมาถึง" actions={<Link className="care-button care-button-primary" href="/inventory/receive"><Plus aria-hidden="true" size={18} />รับยาเข้าคลัง</Link>} />
    <section className="inventory-summary" aria-label="สถานะคงคลัง">
      <Card><span>รายการยาทั้งหมด</span><strong>{state.inventory.length}</strong><small>รายการในทะเบียนกลาง</small></Card>
      <Card><span>พร้อมใช้</span><strong>{state.inventory.length - urgent.length}</strong><small>สูงกว่าเกณฑ์ที่กำหนด</small></Card>
      <Card className="inventory-alert-card"><span>ต้องสั่งเพิ่ม</span><strong>{urgent.length}</strong><small>ใกล้หมดและหมดแล้ว</small></Card>
    </section>
    <div className="inventory-layout">
      <Card className="inventory-table-card">
        <SectionHeading icon={PackageOpen} title="ทะเบียนยา" description="ค้นหาด้วยชื่อไทย ชื่อสามัญ หรือรหัสยา" />
        <label className="registry-search"><Search aria-hidden="true" size={18} /><span className="sr-only">ค้นหายา</span><input type="search" role="searchbox" aria-label="ค้นหายา" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เช่น พาราเซตามอล หรือ DRG-0001" /></label>
        {filtered.length ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>ยา</th><th>รหัส</th><th>คงเหลือ</th><th>หมดอายุเร็วสุด</th><th>สถานะ</th></tr></thead><tbody>{filtered.map((item) => { const [label, tone] = inventoryBadge(selectInventoryStatus(item)); return <tr key={item.id}><td><strong>{item.nameTh}</strong><small>{item.name} · {item.strength} · {item.form}</small></td><td>{item.code}</td><td><b>{item.stock.toLocaleString("th-TH")}</b> {item.unit}<small>เกณฑ์ {item.threshold.toLocaleString("th-TH")}</small></td><td>{item.earliestExpiry ? new Date(item.earliestExpiry).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" }) : "ไม่มีล็อตคงเหลือ"}</td><td><StatusBadge tone={tone}>{label}</StatusBadge></td></tr>; })}</tbody></table></div> : <EmptyState icon={Search} title="ไม่พบรายการยา" detail="ลองค้นหาด้วยชื่อ รหัส หรือปรับคำค้น" />}
      </Card>
      <Card className="urgent-restock-card">
        <SectionHeading icon={AlertTriangle} title="ต้องสั่งเพิ่ม" description="รายการที่ต่ำกว่าเกณฑ์ปลอดภัย" />
        <div className="urgent-list">{query.trim() ? <p className="empty-detail">ล้างคำค้นเพื่อดูรายการที่ต้องสั่งเพิ่ม</p> : urgent.map((item) => <article key={item.id}><div><strong>{item.nameTh}</strong><span>{item.stock.toLocaleString("th-TH")} / ขั้นต่ำ {item.threshold.toLocaleString("th-TH")} {item.unit}</span></div><StatusBadge tone={item.stock === 0 ? "error" : "warning"}>{item.stock === 0 ? "หมด" : "ใกล้หมด"}</StatusBadge></article>)}</div>
        <Link className="care-button care-button-secondary inventory-receive-link" href="/inventory/receive">บันทึกรับยาใหม่</Link>
      </Card>
    </div>
  </div>;
}
