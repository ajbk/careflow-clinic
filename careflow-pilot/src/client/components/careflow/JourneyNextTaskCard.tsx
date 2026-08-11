import { useEffect, useRef, type ReactElement } from "react";
import type { JourneySummaryDto } from "../../../shared/contracts";
import { Card } from "./ui";
import { JourneyActionControl, JourneyBlockerCard } from "./JourneyBlockerCard";
import { ActionButton } from "./ui";

type Role = "assistant" | "doctor";

function roleLabel(role: Role): string {
  return role === "assistant" ? "ผู้ช่วย" : "แพทย์";
}

export function JourneyAuthorityBanner({
  error,
  fetching,
  onReload,
}: {
  error?: unknown;
  fetching: boolean;
  onReload: () => void;
}): ReactElement {
  return (
    <div className="journey-authority-banner" role="alert">
      <span><strong>กำลังแสดงข้อมูลแบบอ่านอย่างเดียว</strong> ข้อมูลเส้นทางผู้ป่วยอาจไม่เป็นปัจจุบัน จึงระงับคำสั่งจนกว่าจะโหลดสิทธิ์ล่าสุด</span>
      {error ? <span className="sr-only">ไม่สามารถตรวจสอบสิทธิ์ล่าสุดได้</span> : null}
      <ActionButton type="button" variant="secondary" onClick={onReload} disabled={fetching}>{fetching ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</ActionButton>
    </div>
  );
}

export function JourneyNextTaskCard({
  summary,
  visitId,
  currentRole,
  authorityReady,
  onLocalAction,
  commandFailure,
}: {
  summary: JourneySummaryDto;
  visitId: string;
  currentRole: Role;
  authorityReady: boolean;
  onLocalAction?: (action: "START_CONSULTATION" | "REVIEW_ALLERGY") => void;
  commandFailure?: string;
}): ReactElement {
  const nextTask = summary.nextTask;
  const alertRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (commandFailure && summary.blockers.length === 0) alertRef.current?.focus();
  }, [commandFailure, summary.blockers.length]);
  const canAct = Boolean(
    authorityReady &&
    nextTask &&
    nextTask.availability === "AVAILABLE" &&
    summary.allowedActions.includes(nextTask.action),
  );
  return (
    <section className="journey-next-task" aria-label="งานถัดไป">
      <Card className="journey-next-task-card">
        <p className="page-eyebrow">งานถัดไป</p>
        {nextTask ? (
          <>
            <h2>{nextTask.labelTh}</h2>
            <p>บทบาทหลัก: {roleLabel(nextTask.primaryRole)}</p>
            {!authorityReady ? <p className="journey-waiting-copy" role="status">กำลังตรวจสอบสิทธิ์ล่าสุดก่อนดำเนินการ</p> : null}
            {authorityReady && !canAct ? <p className="journey-waiting-copy" role="status">{nextTask.labelTh}</p> : null}
            {commandFailure && summary.blockers.length === 0 ? <p ref={alertRef} className="journey-command-failure" role="alert" tabIndex={-1}>{commandFailure}</p> : null}
            {canAct && summary.blockers.length === 0 ? <JourneyActionControl action={nextTask.action} labelTh={nextTask.labelTh} visitId={visitId} allowedActions={summary.allowedActions} authorityReady={authorityReady} onLocalAction={onLocalAction} /> : null}
          </>
        ) : <p className="journey-waiting-copy">ยังไม่มีงานที่ดำเนินการได้สำหรับ Visit นี้</p>}
      </Card>
      {summary.blockers.map((blocker) => (
        <JourneyBlockerCard
          key={`${blocker.code}-${blocker.medication?.medicationId ?? "visit"}`}
          blocker={blocker}
          visitId={visitId}
          currentRole={currentRole}
          allowedActions={summary.allowedActions}
          authorityReady={authorityReady}
          onLocalAction={onLocalAction}
          commandFailure={commandFailure}
        />
      ))}
    </section>
  );
}
