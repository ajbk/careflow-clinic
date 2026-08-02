"use client";

import { BarChart3, PackageSearch, UsersRound, WalletCards } from "lucide-react";
import type { CSSProperties } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectDashboardMetrics, selectInventoryStatus } from "@/lib/careflow/selectors";
import { Card, PageHeader, SectionHeading, StatusBadge, formatThaiCurrency } from "../ui";

const volume = [{ label: "พ.ค.", value: 58 }, { label: "มิ.ย.", value: 72 }, { label: "ก.ค.", value: 64 }, { label: "ส.ค.", value: 86 }, { label: "ก.ย.", value: 78 }, { label: "ต.ค.", value: 92 }];
const diagnoses = [["ความดันโลหิตสูง", "I10", 48], ["เบาหวานชนิดที่ 2", "E11", 42], ["ติดเชื้อทางเดินหายใจส่วนบน", "J06.9", 31], ["ปวดกล้ามเนื้อ", "M79.1", 24]];

export function AnalyticsScreen() {
  const { state } = useCareFlow();
  const metrics = selectDashboardMetrics(state);
  const paid = state.transactions.reduce((sum, transaction) => sum + transaction.total, 12400);
  const topMedication = [...state.inventory].sort((a, b) => b.dispensedThisMonth - a.dispensedThisMonth);
  return <div className="operations-page analytics-page"><PageHeader eyebrow="MONTHLY ANALYTICS" title="รายงานสรุปผลการดำเนินงาน" description="ภาพรวมเพื่อวางแผนทรัพยากรของคลินิกชุมชน" /><p className="analytics-period">ตุลาคม 2566</p>
    <section className="analytics-metrics"><Card><span><UsersRound aria-hidden="true" size={18} />ผู้รับบริการ</span><strong>386</strong><small>เพิ่มขึ้น 8% จากเดือนก่อน</small></Card><Card><span><BarChart3 aria-hidden="true" size={18} />รายการตรวจ</span><strong>352</strong><small>อัตราเสร็จสิ้น 91%</small></Card><Card><span><WalletCards aria-hidden="true" size={18} />รายรับ</span><strong>{formatThaiCurrency(paid)}</strong><small>ค่าตรวจและค่ายา</small></Card><Card className="analytics-low-stock"><span><PackageSearch aria-hidden="true" size={18} />ยาที่ต้องสั่งเพิ่ม</span><strong aria-label="ยาที่ต้องสั่งเพิ่ม">{metrics.lowStock}</strong><small>อิงจากสถานะคงคลังปัจจุบัน</small></Card></section>
    <div className="analytics-grid"><Card className="analytics-chart-card"><SectionHeading title="แนวโน้มจำนวนผู้ป่วย" description="เปรียบเทียบจำนวนผู้รับบริการรายเดือน" /><div className="bar-chart" role="img" aria-label="แนวโน้มจำนวนผู้ป่วยรายเดือน">{volume.map((point) => <div className="bar-column" key={point.label}><span>{point.value}</span><i style={{ "--bar-height": `${point.value}%` } as CSSProperties} /><small>{point.label}</small></div>)}</div></Card><Card className="diagnosis-card"><SectionHeading title="การวินิจฉัยที่พบบ่อย" description="ตามจำนวนบันทึกในเดือนนี้" /><ol className="diagnosis-ranking">{diagnoses.map(([name, code, count], index) => <li key={code as string}><b>{index + 1}</b><span><strong>{name}</strong><small>{code}</small></span><em>{count} ราย</em></li>)}</ol></Card></div>
    <Card className="usage-card"><SectionHeading title="ยอดการใช้ยา" description="แสดงการใช้ยาและสถานะคงเหลือจากข้อมูลชุดเดียวกัน" /><div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>ชื่อยา</th><th>ใช้เดือนนี้</th><th>คงเหลือ</th><th>สถานะ</th></tr></thead><tbody>{topMedication.map((item) => { const status = selectInventoryStatus(item); return <tr key={item.id}><td><strong>{item.nameTh}</strong><small>{item.name} · {item.strength}</small></td><td>{item.dispensedThisMonth.toLocaleString("th-TH")} {item.unit}</td><td>{item.stock.toLocaleString("th-TH")} {item.unit}</td><td><StatusBadge tone={status === "healthy" ? "success" : status === "low" ? "warning" : "error"}>{status === "healthy" ? "พร้อมใช้" : status === "low" ? "ใกล้หมด" : "หมด"}</StatusBadge></td></tr>; })}</tbody></table></div></Card>
  </div>;
}
