import { LockKeyhole } from "lucide-react";
import { Card, PageHeader } from "./ui";

export function RoleRestrictedCard({ title }: { title: string }) {
  return (
    <div className="flow-page role-restricted-page">
      <PageHeader eyebrow="DOCTOR WORKSPACE" title={title} description="พื้นที่เวชระเบียนสำหรับแพทย์ในต้นแบบ CareFlow" />
      <Card className="role-restricted-card">
        <span className="role-restricted-icon"><LockKeyhole aria-hidden="true" size={28} /></span>
        <h2>หน้าจอนี้สงวนไว้สำหรับแพทย์</h2>
        <p>โปรดสลับบทบาทเป็นแพทย์เพื่อดูข้อมูลทางคลินิก ข้อจำกัดนี้ใช้เพื่อการสาธิต ไม่ใช่ระบบความปลอดภัยจริง</p>
      </Card>
    </div>
  );
}
