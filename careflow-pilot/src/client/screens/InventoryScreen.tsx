import { AlertTriangle, PackageOpen, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { InventoryLotBalanceDto, InventoryStatus, MedicationDto } from "../../shared/contracts";
import { useAuth } from "../auth/AuthProvider";
import { Card, EmptyState, PageHeader, SectionHeading, StatusBadge } from "../components/careflow/ui";
import { useInventory, useInventoryAdjustment, useInventoryLots, useInventoryLotStatusCommand, type InventoryAdjustmentAttempt, type InventoryLotAttempt } from "../features/inventory";
import { isApiError } from "../lib/api-error";
import { createCommandAttempt } from "../lib/idempotency";
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

function LotControls({ medication, lot, canQuarantine, canUnquarantine, canAdjust }: { medication: MedicationDto; lot: InventoryLotBalanceDto; canQuarantine: boolean; canUnquarantine: boolean; canAdjust: boolean }): ReactElement {
  const quarantine = useInventoryLotStatusCommand(medication.id, "quarantine");
  const unquarantine = useInventoryLotStatusCommand(medication.id, "unquarantine");
  const adjustment = useInventoryAdjustment(medication.id);
  const [reason, setReason] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const statusAttempts = useRef<Record<string, InventoryLotAttempt>>({});
  const adjustmentAttempts = useRef<Record<string, InventoryAdjustmentAttempt>>({});
  const canSubmitAdjustment = lot.latestMovementId !== null && Number.isInteger(Number(quantityDelta)) && Number(quantityDelta) !== 0 && adjustmentReason.trim().length > 0;
  const statusMutation = lot.status === "AVAILABLE" ? quarantine : unquarantine;
  const statusAction = lot.status === "AVAILABLE" ? "quarantine" : "unquarantine";
  const statusPermission = lot.status === "AVAILABLE" ? canQuarantine : canUnquarantine;

  function changeStatus(): void {
    if (!statusPermission || !reason.trim()) return;
    const fingerprint = `${statusAction}:${reason.trim()}:${lot.revision}`;
    const attempt = statusAttempts.current[fingerprint] ?? createCommandAttempt({ lot: lot.revision }, { reason: reason.trim() });
    statusAttempts.current[fingerprint] = attempt;
    setError(null);
    statusMutation.mutate({ lotId: lot.id, attempt }, { onSuccess: () => { setReason(""); delete statusAttempts.current[fingerprint]; }, onError: (cause) => setError(errorMessage(cause)) });
  }

  function adjust(): void {
    if (!canAdjust || !canSubmitAdjustment) return;
    if (!lot.latestMovementId) return;
    const payload = { correctsMovementId: lot.latestMovementId, quantityDelta: Number(quantityDelta), reason: adjustmentReason.trim() };
    const fingerprint = `adjust:${JSON.stringify(payload)}:${lot.revision}`;
    const attempt = adjustmentAttempts.current[fingerprint] ?? createCommandAttempt({ lot: lot.revision }, payload);
    adjustmentAttempts.current[fingerprint] = attempt;
    setError(null);
    adjustment.mutate({ lotId: lot.id, attempt }, { onSuccess: () => { setQuantityDelta(""); setAdjustmentReason(""); delete adjustmentAttempts.current[fingerprint]; }, onError: (cause) => setError(errorMessage(cause)) });
  }

  return <article className="inventory-lot-card" aria-label={`ล็อต ${lot.lotNumber}`}>
    <div><strong>ล็อต {lot.lotNumber}</strong><span>หมดอายุ {formatThaiDate(lot.expiryDate)} · revision {lot.revision}</span></div>
    <div className="inventory-lot-counts"><span>คงคลัง {lot.onHand}</span><span>จอง {lot.reserved}</span><span>พร้อมใช้ {lot.available}</span><StatusBadge tone={lot.status === "AVAILABLE" ? "success" : "warning"}>{lot.status === "AVAILABLE" ? "พร้อมใช้" : "กักกัน"}</StatusBadge></div>
    {statusPermission ? <div className="inventory-lot-command"><label>เหตุผล<input aria-label={`เหตุผล ${statusAction} ${lot.lotNumber}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label><button className="care-button care-button-secondary" type="button" onClick={changeStatus} disabled={!reason.trim() || statusMutation.isPending}>{statusMutation.isPending ? "กำลังบันทึก…" : lot.status === "AVAILABLE" ? "กักกันล็อต" : "ปลดกักกัน"}</button></div> : null}
    {canAdjust ? <div className="inventory-lot-command inventory-adjust-command"><label>ปรับจำนวน<input aria-label={`ปรับจำนวน ${lot.lotNumber}`} type="number" value={quantityDelta} onChange={(event) => setQuantityDelta(event.target.value)} /></label><label>เหตุผล<input aria-label={`เหตุผลปรับจำนวน ${lot.lotNumber}`} value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} maxLength={500} /></label><button className="care-button care-button-secondary" type="button" onClick={adjust} disabled={!canSubmitAdjustment || adjustment.isPending}>{adjustment.isPending ? "กำลังปรับ…" : "บันทึกการปรับ"}</button></div> : null}
    {error ? <p className="inventory-command-error" role="alert">{error}</p> : null}
  </article>;
}

function LotPanel({ medication, permissions }: { medication: MedicationDto | null; permissions: readonly string[] }): ReactElement | null {
  const lots = useInventoryLots(medication?.id ?? null);
  if (!medication) return null;
  if (lots.isPending) return <Card className="inventory-lot-panel"><p role="status">กำลังโหลดล็อตยา…</p></Card>;
  if (lots.error) return <Card className="inventory-lot-panel"><p role="alert">{errorMessage(lots.error)}</p></Card>;
  return <Card className="inventory-lot-panel"><SectionHeading icon={PackageOpen} title={`รายละเอียดล็อต: ${medication.displayName}`} description="การกักกันและการปรับยอดจะบันทึกเหตุผลและ revision ทุกครั้ง" />
    <div className="inventory-lot-list">{(lots.data ?? []).map((lot) => <LotControls key={lot.id} medication={medication} lot={lot} canQuarantine={permissions.includes("inventory:quarantine")} canUnquarantine={permissions.includes("inventory:release-quarantine")} canAdjust={permissions.includes("inventory:adjust")} />)}</div>
  </Card>;
}

export function InventoryScreen(): ReactElement {
  const auth = useAuth();
  const inventory = useInventory();
  const [query, setQuery] = useState("");
  const [selectedMedication, setSelectedMedication] = useState<MedicationDto | null>(null);
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
            return <tr key={item.medication.id}><td><button className="inventory-medication-link" type="button" onClick={() => setSelectedMedication(item.medication)}><strong>{item.medication.displayName}</strong><small>{item.medication.strengthText} · {item.medication.dosageFormText}</small></button></td><td><b>{item.available.toLocaleString("th-TH")}</b> {item.medication.canonicalUnit}<small>คงคลัง {item.onHand.toLocaleString("th-TH")} · จอง {item.reserved.toLocaleString("th-TH")}</small></td><td>{item.nearestExpiry ? formatThaiDate(item.nearestExpiry) : "ไม่มีล็อตคงเหลือ"}</td><td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td></tr>;
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
      <LotPanel medication={selectedMedication} permissions={auth.session?.permissions ?? []} />
    </div>
  );
}
