import { AlertTriangle, PackageOpen, Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { InventoryStatus } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { useInventory } from "../features/inventory";
import { isApiError } from "../lib/api-error";
import { formatThaiDate } from "../lib/thai-date";

function badge(status: InventoryStatus): { label: string; tone: "success" | "warning" | "error" | "info" } {
  if (status === "OK") return { label: "พร้อมใช้", tone: "success" };
  if (status === "LOW") return { label: "ใกล้หมด", tone: "warning" };
  if (status === "EXPIRED") return { label: "หมดอายุ", tone: "error" };
  if (status === "RESERVED") return { label: "ถูกจอง", tone: "info" };
  return { label: "หมด", tone: "error" };
}

function errorMessage(error: unknown): string {
  return isApiError(error) ? error.messageTh : "ไม่สามารถโหลดข้อมูลคลังยาได้ กรุณาลองใหม่อีกครั้ง";
}

export function InventoryScreen(): ReactElement {
  const auth = useAuth();
  const inventory = useInventory();
  const [query, setQuery] = useState("");
  const items = useMemo(() => inventory.data ?? [], [inventory.data]);
  const canReceive = auth.session?.permissions.includes("inventory:receive") ?? false;
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("th-TH");
    if (!search) return items;
    return items.filter((item) => [item.medication.displayName, item.medication.strengthText, item.medication.dosageFormText]
      .some((value) => value.toLocaleLowerCase("th-TH").includes(search)));
  }, [items, query]);
  const urgent = items.filter((item) => item.status !== "OK");

  if (inventory.isPending) {
    return <div className="operations-page inventory-page"><PageHeader eyebrow="MEDICATION REGISTRY" title="คลังยา" /><Card><p role="status">กำลังโหลดทะเบียนยา…</p></Card></div>;
  }
  if (inventory.error) {
    return <div className="operations-page inventory-page"><PageHeader eyebrow="MEDICATION REGISTRY" title="คลังยา" /><Card><section className="workflow-blocked workflow-blocked-unavailable" role="alert"><p>{errorMessage(inventory.error)}</p><button className="inline-retry-button" type="button" onClick={() => void inventory.refetch()}>โหลดข้อมูลล่าสุด</button></section></Card></div>;
  }

  return (
    <div className="operations-page inventory-page">
      <PageHeader
        eyebrow="MEDICATION REGISTRY"
        title="คลังยา"
        description="ติดตามคงเหลือ ล็อต และรายการที่ต้องดูแลก่อนผู้ป่วยมาถึง"
        actions={canReceive ? <Link className="care-button care-button-primary" to="/inventory/receive"><Plus aria-hidden="true" size={18} />รับยาเข้าคลัง</Link> : undefined}
      />
      <section className="inventory-summary" aria-label="สถานะคงคลัง">
        <Card><span>รายการยาทั้งหมด</span><strong>{items.length}</strong><small>รายการในทะเบียนกลาง</small></Card>
        <Card><span>พร้อมใช้</span><strong>{items.filter((item) => item.status === "OK").length}</strong><small>สูงกว่าเกณฑ์ที่กำหนด</small></Card>
        <Card className="inventory-alert-card"><span>ต้องดูแล</span><strong>{urgent.length}</strong><small>ใกล้หมด หมด หรือหมดอายุ</small></Card>
      </section>
      <div className="inventory-layout">
        <Card className="inventory-table-card">
          <SectionHeading icon={PackageOpen} title="ทะเบียนยา" description="ค้นหาด้วยชื่อยา ความแรง หรือรูปแบบยา" />
          <label className="registry-search"><Search aria-hidden="true" size={18} /><span className="sr-only">ค้นหายา</span><input type="search" role="searchbox" aria-label="ค้นหายา" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เช่น พาราเซตามอล" /></label>
          {filtered.length ? <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>ยา</th><th>คงเหลือ</th><th>หมดอายุเร็วสุด</th><th>สถานะ</th></tr></thead><tbody>{filtered.map((item) => {
            const status = badge(item.status);
            return <tr key={item.medication.id}><td><strong>{item.medication.displayName}</strong><small>{item.medication.strengthText} · {item.medication.dosageFormText}</small></td><td><b>{item.available.toLocaleString("th-TH")}</b> {item.medication.canonicalUnit}<small>คงคลัง {item.onHand.toLocaleString("th-TH")} · จอง {item.reserved.toLocaleString("th-TH")}</small></td><td>{item.nearestExpiry ? formatThaiDate(item.nearestExpiry) : "ไม่มีล็อตคงเหลือ"}</td><td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td></tr>;
          })}</tbody></table></div> : <EmptyState icon={Search} title="ไม่พบรายการยา" detail="ลองค้นหาด้วยชื่อยา ความแรง หรือรูปแบบยา" />}
        </Card>
        <Card className="urgent-restock-card">
          <SectionHeading icon={AlertTriangle} title="รายการต้องดูแล" description="สถานะที่ต้องตรวจสอบก่อนจัดยา" />
          <div className="urgent-list">{query.trim() ? <p className="empty-detail">ล้างคำค้นเพื่อดูรายการที่ต้องดูแล</p> : urgent.length ? urgent.map((item) => {
            const status = badge(item.status);
            return <article key={item.medication.id}><div><strong>{item.medication.displayName}</strong><span>พร้อมใช้ {item.available.toLocaleString("th-TH")} {item.medication.canonicalUnit}</span></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></article>;
          }) : <p className="empty-detail">ยังไม่มีรายการที่ต้องดูแล</p>}</div>
          {canReceive ? <Link className="care-button care-button-secondary inventory-receive-link" to="/inventory/receive">บันทึกรับยาใหม่</Link> : null}
        </Card>
      </div>
    </div>
  );
}
