"use client";

import { BarChart3, PackageSearch, UsersRound, WalletCards } from "lucide-react";
import type { CSSProperties } from "react";
import { useCareFlow } from "@/lib/careflow/context";
import { selectAnalyticsReport, selectInventoryStatus } from "@/lib/careflow/selectors";
import { RoleRestrictedCard } from "../RoleRestrictedCard";
import { Card, PageHeader, SectionHeading, StatusBadge, formatThaiCurrency } from "../ui";

export function AnalyticsScreen() {
  const { state } = useCareFlow();
  if (state.role !== "doctor") return <RoleRestrictedCard title="รายงานคลินิก" />;
  const report = selectAnalyticsReport(state);
  const topMedication = [...state.inventory].sort((a, b) => b.dispensedThisMonth - a.dispensedThisMonth);
  return <div className="operations-page analytics-page"><PageHeader eyebrow="MONTHLY ANALYTICS" title="รายงานสรุปผลการดำเนินงาน" description="ภาพรวมเพื่อวางแผนทรัพยากรของคลินิกชุมชน" /><p className="analytics-period">{report.period}</p>
    <section className="analytics-metrics"><Card><span><UsersRound aria-hidden="true" size={18} />ผู้รับบริการ</span><strong aria-label="จำนวนผู้รับบริการ">{report.patientVolume}</strong><small>ฐานรายงานและรายการที่เพิ่มในเดโม</small></Card><Card><span><BarChart3 aria-hidden="true" size={18} />รายการตรวจ</span><strong aria-label="จำนวนรายการตรวจ">{report.consultations}</strong><small>อัปเดตเมื่อแพทย์ลงนาม</small></Card><Card><span><WalletCards aria-hidden="true" size={18} />รายรับ</span><strong aria-label="รายรับรวม">{formatThaiCurrency(report.revenue)}</strong><small>ค่าตรวจและค่ายา</small></Card><Card className="analytics-low-stock"><span><PackageSearch aria-hidden="true" size={18} />ยาที่ต้องสั่งเพิ่ม</span><strong aria-label="ยาที่ต้องสั่งเพิ่ม">{report.lowStock}</strong><small>อิงจากสถานะคงคลังปัจจุบัน</small></Card></section>
    <div className="analytics-grid"><Card className="analytics-chart-card"><SectionHeading title="แนวโน้มจำนวนผู้ป่วย" description="เปรียบเทียบจำนวนผู้รับบริการรายเดือน" /><div className="bar-chart" role="img" aria-label="แนวโน้มจำนวนผู้ป่วยรายเดือน">{report.monthlySeries.map((point) => <div className="bar-column" key={point.label}><span>{point.value}</span><i style={{ "--bar-height": `${Math.min(point.value, 100)}%` } as CSSProperties} /><small>{point.label}</small></div>)}</div></Card><Card className="diagnosis-card"><SectionHeading title="การวินิจฉัยที่พบบ่อย" description="ตามจำนวนบันทึกในเดือนนี้" /><ol className="diagnosis-ranking">{report.diagnoses.map((item, index) => <li key={item.code}><b>{index + 1}</b><span><strong>{item.label}</strong><small>{item.code}</small></span><em>{item.count} ราย</em></li>)}</ol></Card></div>
    <Card className="usage-card"><SectionHeading title="ยอดการใช้ยา" description="แสดงการใช้ยาและสถานะคงเหลือจากข้อมูลชุดเดียวกัน" /><div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>ชื่อยา</th><th>ใช้เดือนนี้</th><th>คงเหลือ</th><th>สถานะ</th></tr></thead><tbody>{topMedication.map((item) => { const status = selectInventoryStatus(item); return <tr key={item.id}><td><strong>{item.nameTh}</strong><small>{item.name} · {item.strength}</small></td><td>{item.dispensedThisMonth.toLocaleString("th-TH")} {item.unit}</td><td>{item.stock.toLocaleString("th-TH")} {item.unit}</td><td><StatusBadge tone={status === "healthy" ? "success" : status === "low" ? "warning" : "error"}>{status === "healthy" ? "พร้อมใช้" : status === "low" ? "ใกล้หมด" : "หมด"}</StatusBadge></td></tr>; })}</tbody></table></div></Card>
  </div>;
}
