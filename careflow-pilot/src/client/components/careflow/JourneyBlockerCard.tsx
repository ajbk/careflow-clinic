import { useEffect, useRef, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { JourneyAction, JourneyBlocker } from "../../../shared/contracts";
import { journeyDestination } from "../../app/journey-navigation";
import { ActionButton, Card } from "./ui";

type Role = "assistant" | "doctor";

function roleLabel(role: Role): string {
  return role === "assistant" ? "ผู้ช่วย" : "แพทย์";
}

function waitingCopy(blocker: JourneyBlocker): string {
  if (blocker.code === "STOCK_SHORTAGE" && blocker.recoveryAction === "RECEIVE_STOCK") {
    return "รอผู้ช่วยรับยาเข้าคลัง";
  }
  return `รอ${roleLabel(blocker.primaryRole)}ดำเนินการ`;
}

export function JourneyActionControl({
  action,
  labelTh,
  visitId,
  blocker,
  allowedActions,
  authorityReady,
  onLocalAction,
}: {
  action: JourneyAction;
  labelTh: string;
  visitId: string;
  blocker?: JourneyBlocker;
  allowedActions: readonly JourneyAction[];
  authorityReady: boolean;
  onLocalAction?: (action: "START_CONSULTATION" | "REVIEW_ALLERGY") => void;
}): ReactElement | null {
  if (!authorityReady || !allowedActions.includes(action)) return null;
  const destination = journeyDestination(action, visitId, blocker);
  if (destination.kind === "ROUTE") return <Link className="care-button care-button-primary journey-action-control" to={destination.to}>{labelTh}</Link>;
  if (destination.kind === "LOCAL" && onLocalAction) {
    return <ActionButton className="journey-action-control" type="button" onClick={() => onLocalAction(destination.action)}>{labelTh}</ActionButton>;
  }
  return null;
}

export function JourneyBlockerCard({
  blocker,
  visitId,
  currentRole,
  allowedActions,
  authorityReady,
  onLocalAction,
  commandFailure,
}: {
  blocker: JourneyBlocker;
  visitId: string;
  currentRole: Role;
  allowedActions: readonly JourneyAction[];
  authorityReady: boolean;
  onLocalAction?: (action: "START_CONSULTATION" | "REVIEW_ALLERGY") => void;
  commandFailure?: string;
}): ReactElement {
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (commandFailure) alertRef.current?.focus();
  }, [commandFailure]);

  const canRecover = authorityReady && blocker.recoveryAction !== null && allowedActions.includes(blocker.recoveryAction);
  const medication = blocker.medication;
  return (
    <Card className="journey-blocker-card">
      <div className="journey-blocker-heading">
        <div><p className="page-eyebrow">อุปสรรคของเส้นทางผู้ป่วย</p><h2>{blocker.titleTh}</h2></div>
        <span>บทบาทหลัก: {roleLabel(blocker.primaryRole)}</span>
      </div>
      <p>{blocker.detailTh}</p>
      {medication ? (
        <div className="journey-blocker-medication" aria-label={`รายละเอียดการขาด ${medication.displayNameSnapshot}`}>
          <strong>{medication.displayNameSnapshot}</strong>
          <span>ต้องการ {medication.required} {medication.unitSnapshot}</span>
          <span>พร้อมใช้ {medication.available} {medication.unitSnapshot}</span>
          <span>ขาด {medication.shortfall} {medication.unitSnapshot}</span>
        </div>
      ) : null}
      {commandFailure ? <p ref={alertRef} className="journey-command-failure" role="alert" tabIndex={-1}>{commandFailure}</p> : null}
      {blocker.recoveryAction ? (
        <div className="journey-blocker-recovery">
          {canRecover ? <JourneyActionControl action={blocker.recoveryAction} labelTh={blocker.recoveryAction === "RECEIVE_STOCK" ? "รับยาเข้าคลัง" : blocker.titleTh} visitId={visitId} blocker={blocker} allowedActions={allowedActions} authorityReady={authorityReady} onLocalAction={onLocalAction} /> : null}
          {!canRecover ? <p className="journey-waiting-copy" role="status">{authorityReady ? waitingCopy(blocker) : "กำลังตรวจสอบสิทธิ์ล่าสุดก่อนดำเนินการ"}</p> : null}
        </div>
      ) : null}
      <span className="sr-only">ผู้ใช้ปัจจุบันคือ {roleLabel(currentRole)}</span>
    </Card>
  );
}
