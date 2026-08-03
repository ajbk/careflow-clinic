import { UserRound } from "lucide-react";
import type { PatientDto } from "../../../shared/contracts";
import { StatusBadge } from "./ui";

function patientAge(birthDate: string): number | null {
  const birth = new Date(`${birthDate}T00:00:00.000Z`);
  if (!Number.isFinite(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed =
    now.getUTCMonth() > birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) age -= 1;
  return Math.max(0, age);
}

function sexLabel(sex: PatientDto["sex"]): string {
  if (sex === "female") return "หญิง";
  if (sex === "male") return "ชาย";
  return "ไม่ระบุเพศ";
}

export function PatientHeader({
  patient,
  status,
  statusTone = "neutral",
  compact = false,
}: {
  patient: PatientDto;
  status?: string;
  statusTone?: "neutral" | "waiting" | "active" | "success" | "warning" | "error" | "info";
  compact?: boolean;
}) {
  const age = patientAge(patient.birthDate);
  return (
    <div className={`patient-header ${compact ? "patient-header-compact" : ""}`}>
      <span className="patient-avatar"><UserRound aria-hidden="true" size={24} /></span>
      <div className="patient-header-copy">
        <strong>{patient.displayName}</strong>
        <span>HN {patient.hn} · อายุ {age ?? "ไม่ทราบ"} ปี · {sexLabel(patient.sex)}</span>
      </div>
      {status ? <StatusBadge tone={statusTone}>{status}</StatusBadge> : null}
    </div>
  );
}
