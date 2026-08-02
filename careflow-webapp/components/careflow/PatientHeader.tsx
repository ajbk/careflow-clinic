import { AlertTriangle, UserRound } from "lucide-react";
import type { Patient } from "@/lib/careflow/types";
import { StatusBadge } from "./ui";

export function PatientHeader({
  patient,
  status,
  statusTone = "neutral",
  compact = false,
}: {
  patient: Patient;
  status?: string;
  statusTone?: "neutral" | "waiting" | "active" | "success" | "warning" | "error" | "info";
  compact?: boolean;
}) {
  return (
    <div className={`patient-header ${compact ? "patient-header-compact" : ""}`}>
      <span className="patient-avatar"><UserRound aria-hidden="true" size={24} /></span>
      <div className="patient-header-copy">
        <strong>{patient.name}</strong>
        <span>HN {patient.hn} · อายุ {patient.age} ปี · {patient.gender}</span>
      </div>
      {patient.allergies.length ? (
        <StatusBadge tone="error"><AlertTriangle aria-hidden="true" size={15} /> แพ้ยา: {patient.allergies.join(", ")}</StatusBadge>
      ) : status ? (
        <StatusBadge tone={statusTone}>{status}</StatusBadge>
      ) : null}
    </div>
  );
}
