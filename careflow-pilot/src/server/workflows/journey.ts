import type {
  Actor,
  JourneyAction,
  JourneyBlocker,
  JourneyStepCode,
  JourneyStepDto,
  JourneySummaryDto,
  Permission,
  QueueBaseItemDto,
  ReservationReadinessDto,
  VisitJourneyDto,
  VisitStatus,
} from "../../shared/contracts.js";
import { ApiError } from "../errors.js";
import type { FinanceService } from "../modules/finance/index.js";
import type { FulfillmentService } from "../modules/fulfillment/index.js";
import type { InventoryService } from "../modules/inventory/index.js";
import type { MedicationService } from "../modules/medication/index.js";
import type { PatientService } from "../modules/patient/index.js";
import { hasPermission, permissionsByRole } from "../modules/platform/index.js";
import type { VisitService } from "../modules/visit/index.js";
import type { ClinicalWorkflow } from "./clinical.js";
import type { VisitCompletionWorkflow } from "./visit-completion.js";

const stepDefinitions: ReadonlyArray<{ code: JourneyStepCode; labelTh: string }> = [
  { code: "INTAKE", labelTh: "รับผู้ป่วย" },
  { code: "SCREENING", labelTh: "คัดกรอง" },
  { code: "CONSULTATION", labelTh: "ตรวจรักษา" },
  { code: "MEDICATION_DECISION", labelTh: "ตัดสินใจเรื่องยา" },
  { code: "PREPARATION", labelTh: "เตรียมยา" },
  { code: "HANDOFF", labelTh: "ส่งมอบยา" },
  { code: "PAYMENT", labelTh: "ชำระเงิน" },
  { code: "CLOSURE", labelTh: "ปิด Visit" },
];

const journeyActionLabels: Record<JourneyAction, string> = {
  START_CONSULTATION: "เริ่มตรวจ",
  REVIEW_ALLERGY: "ทบทวนข้อมูลแพ้ยา",
  OPEN_CONSULTATION: "เปิดห้องตรวจ",
  START_PREPARATION: "เริ่มเตรียมยา",
  PRINT_LABEL: "บันทึกคำขอพิมพ์",
  CONFIRM_ALLOCATION: "ยืนยันรายการจัดยา",
  COMPLETE_PREPARATION: "เสร็จสิ้นการเตรียมยา",
  RELEASE_MEDICATION: "ปล่อยยา",
  HANDOFF_MEDICATION: "ยืนยันส่งมอบยา",
  FINALIZE_CHARGE: "ยืนยันยอดเพื่อรับชำระ",
  RECORD_CASH: "ยืนยันรับเงินสด",
  RECORD_PROMPTPAY: "ยืนยัน PromptPay",
  APPROVE_FULL_WAIVER: "ยกเว้นเต็มจำนวน",
  CLOSE_VISIT: "ปิด Visit",
  OPEN_OPD_CARD: "เปิดบัตร OPD",
  RECEIVE_STOCK: "รับยาเข้าคลัง",
};

/** The one semantic-action permission map shared by Journey derivation and role projection. */
export const journeyPermission: Record<JourneyAction, Permission> = {
  START_CONSULTATION: "visit:start-consultation",
  REVIEW_ALLERGY: "patient:update-allergy",
  OPEN_CONSULTATION: "clinical:read",
  START_PREPARATION: "fulfillment:prepare",
  PRINT_LABEL: "label:print",
  CONFIRM_ALLOCATION: "fulfillment:prepare",
  COMPLETE_PREPARATION: "fulfillment:prepare",
  RELEASE_MEDICATION: "fulfillment:release",
  HANDOFF_MEDICATION: "fulfillment:handoff",
  FINALIZE_CHARGE: "finance:finalize-charge",
  RECORD_CASH: "finance:record-cash",
  RECORD_PROMPTPAY: "finance:confirm-promptpay",
  APPROVE_FULL_WAIVER: "finance:waive",
  CLOSE_VISIT: "visit:close",
  OPEN_OPD_CARD: "opd:read",
  RECEIVE_STOCK: "inventory:receive",
};

const actionPrimaryRole: Record<JourneyAction, Actor["role"]> = {
  START_CONSULTATION: "doctor",
  REVIEW_ALLERGY: "assistant",
  OPEN_CONSULTATION: "doctor",
  START_PREPARATION: "assistant",
  PRINT_LABEL: "assistant",
  CONFIRM_ALLOCATION: "assistant",
  COMPLETE_PREPARATION: "assistant",
  RELEASE_MEDICATION: "doctor",
  HANDOFF_MEDICATION: "assistant",
  FINALIZE_CHARGE: "doctor",
  RECORD_CASH: "assistant",
  RECORD_PROMPTPAY: "doctor",
  APPROVE_FULL_WAIVER: "doctor",
  CLOSE_VISIT: "doctor",
  OPEN_OPD_CARD: "doctor",
  RECEIVE_STOCK: "assistant",
};

const statusCurrentStep: Partial<Record<VisitStatus, JourneyStepCode>> = {
  WAITING: "CONSULTATION",
  CONSULTING: "CONSULTATION",
  AWAITING_ORDER_REVISION: "MEDICATION_DECISION",
  AWAITING_PREPARATION: "PREPARATION",
  PREPARING: "PREPARATION",
  AWAITING_RELEASE: "PREPARATION",
  AWAITING_HANDOFF: "HANDOFF",
  AWAITING_CHARGE: "PAYMENT",
  AWAITING_PAYMENT: "PAYMENT",
  READY_TO_CLOSE: "CLOSURE",
};

const fulfillmentActionMap: Partial<Record<string, JourneyAction>> = {
  START_PREPARATION: "START_PREPARATION",
  PRINT_LABEL: "PRINT_LABEL",
  CONFIRM_ALLOCATION: "CONFIRM_ALLOCATION",
  COMPLETE_PREPARATION: "COMPLETE_PREPARATION",
  RELEASE: "RELEASE_MEDICATION",
  HANDOFF: "HANDOFF_MEDICATION",
};

const financeActionMap: Partial<Record<string, JourneyAction>> = {
  FINALIZE_CHARGE: "FINALIZE_CHARGE",
  APPROVE_FULL_WAIVER: "APPROVE_FULL_WAIVER",
  RECORD_CASH: "RECORD_CASH",
  CONFIRM_PROMPTPAY: "RECORD_PROMPTPAY",
  CLOSE_VISIT: "CLOSE_VISIT",
  READ_OPD: "OPEN_OPD_CARD",
};

type JourneyVisit = NonNullable<ReturnType<VisitService["getJourneyVisit"]>>["visit"];
type ClinicalEvidence = ReturnType<ClinicalWorkflow["getJourneyEvidence"]>;
type MedicationEvidence = ReturnType<MedicationService["getJourneyDecision"]>;
type FulfillmentEvidence = ReturnType<FulfillmentService["getJourneyEvidence"]>;
type FinanceEvidence = ReturnType<FinanceService["getJourneyEvidence"]>;

type JourneyEvidence = {
  visit: JourneyVisit;
  allergyState: "UNKNOWN" | "NONE_KNOWN" | "PRESENT";
  clinical: ClinicalEvidence;
  medication: MedicationEvidence;
  fulfillment: FulfillmentEvidence;
  finance: FinanceEvidence;
  readiness: ReservationReadinessDto | null;
  hasClosure: boolean;
};

export interface JourneyService {
  getJourney(actor: Actor, visitId: string): VisitJourneyDto;
  getSummary(actor: Actor, visitId: string): JourneySummaryDto;
  /** Builds the committed Intake response without rereading a transaction that is still being committed. */
  summarizeCommittedIntake(actor: Actor, item: QueueBaseItemDto): JourneySummaryDto;
}

export interface JourneyServiceOptions {
  visits: VisitService;
  patients: PatientService;
  clinical: ClinicalWorkflow;
  medications: MedicationService;
  fulfillment: FulfillmentService;
  inventory: InventoryService;
  finance: FinanceService;
  completion: VisitCompletionWorkflow;
  clock: () => Date;
}

function notFound(): never {
  throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
}

function stepIndex(code: JourneyStepCode): number {
  const index = stepDefinitions.findIndex((definition) => definition.code === code);
  if (index < 0) throw new Error(`Unknown Journey step ${code}`);
  return index;
}

function permittedRoles(action: JourneyAction): Array<Actor["role"]> {
  return (["assistant", "doctor"] as const).filter((role) =>
    (permissionsByRole[role] as readonly Permission[]).includes(journeyPermission[action]),
  );
}

function uniqueActions(actions: readonly JourneyAction[]): JourneyAction[] {
  return [...new Set(actions)];
}

function reviewAllergyAvailable(
  allergyState: JourneyEvidence["allergyState"],
  status: VisitStatus,
): boolean {
  if (status === "WAITING") return true;
  return allergyState === "UNKNOWN" && [
    "CONSULTING",
    "AWAITING_PREPARATION",
    "PREPARING",
    "AWAITING_RELEASE",
    "AWAITING_HANDOFF",
  ].includes(status);
}

function evidenceInconsistent(evidence: JourneyEvidence): boolean {
  if (evidence.visit.status !== "CLOSED") return false;
  // A valid Closure is the only safe authority for post-close OPD access. Keep this test deliberately
  // opaque: it never exposes a missing Note, diagnosis, financial record, or other clinical evidence.
  return !evidence.hasClosure;
}

function allergyBlocker(status: VisitStatus): JourneyBlocker {
  const primaryRole = status === "WAITING" ? "assistant" : "doctor";
  return {
    code: "ALLERGY_UNKNOWN",
    titleTh: "ยังไม่ได้ถามประวัติแพ้ยา",
    detailTh: "ยังไม่ทราบประวัติแพ้ยา กรุณาทบทวนก่อนลงนามการตรวจ",
    primaryRole,
    recoveryAction: "REVIEW_ALLERGY",
    medication: null,
  };
}

function stockBlockers(readiness: ReservationReadinessDto): JourneyBlocker[] {
  return readiness.lines
    .filter((line) => line.shortfall > 0)
    .map((medication) => ({
      code: "STOCK_SHORTAGE" as const,
      titleTh: "จัดยายังไม่ได้",
      detailTh: `${medication.displayNameSnapshot} ต้องการ ${medication.required} ${medication.unitSnapshot} · พร้อมใช้ ${medication.available} ${medication.unitSnapshot} · ขาด ${medication.shortfall} ${medication.unitSnapshot}`,
      primaryRole: "assistant" as const,
      recoveryAction: "RECEIVE_STOCK" as const,
      medication,
    }));
}

function inconsistentBlocker(): JourneyBlocker {
  return {
    code: "EVIDENCE_INCONSISTENT",
    titleTh: "หลักฐาน Visit ไม่สอดคล้องกัน",
    detailTh: "Visit ปิดแล้วแต่ไม่พบหลักฐานการปิด Visit ที่ครบถ้วน",
    primaryRole: "doctor",
    recoveryAction: null,
    medication: null,
  };
}

function deriveSteps(evidence: JourneyEvidence, blockers: readonly JourneyBlocker[]): JourneyStepDto[] {
  const steps: JourneyStepDto[] = stepDefinitions.map((definition) => ({
    ...definition,
    state: "UPCOMING",
  }));
  const current = statusCurrentStep[evidence.visit.status];
  if (current) {
    const currentIndex = stepIndex(current);
    for (let index = 0; index < currentIndex; index += 1) steps[index]!.state = "COMPLETE";
    steps[currentIndex]!.state = "CURRENT";
  }
  if (evidence.medication?.kind === "NO_MEDICATION") {
    steps[stepIndex("PREPARATION")]!.state = "SKIPPED";
    steps[stepIndex("HANDOFF")]!.state = "SKIPPED";
  }
  if (evidence.finance.resolutionKind === "COLLECTION_NOT_REQUIRED" && [
    "READY_TO_CLOSE",
    "CLOSED",
  ].includes(evidence.visit.status)) {
    steps[stepIndex("PAYMENT")]!.state = "SKIPPED";
  }
  if (evidence.allergyState === "UNKNOWN") {
    steps[stepIndex("SCREENING")]!.state = "BLOCKED";
  }
  if (blockers.some((blocker) => blocker.code === "STOCK_SHORTAGE")) {
    steps[stepIndex("PREPARATION")]!.state = "BLOCKED";
  }
  if (evidence.visit.status === "CLOSED") {
    for (const step of steps) {
      if (step.state !== "SKIPPED") step.state = "COMPLETE";
    }
    if (blockers.some((blocker) => blocker.code === "EVIDENCE_INCONSISTENT")) {
      steps[stepIndex("CLOSURE")]!.state = "BLOCKED";
    }
  }
  return steps;
}

function fulfillmentDomainActions(evidence: JourneyEvidence): JourneyAction[] {
  const mapped = evidence.fulfillment.allowedActions.flatMap((action) => {
    const journeyAction = fulfillmentActionMap[action];
    return journeyAction ? [journeyAction] : [];
  });
  if (evidence.visit.status !== "PREPARING") return mapped;
  const next = plannedAction(evidence);
  return next && mapped.includes(next) ? [next] : [];
}

function domainActions(actor: Actor, evidence: JourneyEvidence, blockers: readonly JourneyBlocker[]): JourneyAction[] {
  if (blockers.some((blocker) => blocker.code === "EVIDENCE_INCONSISTENT")) return [];
  const allergyUnknown = blockers.some((blocker) => blocker.code === "ALLERGY_UNKNOWN");
  const stockShort = blockers.some((blocker) => blocker.code === "STOCK_SHORTAGE");
  const actions: JourneyAction[] = [];
  if (evidence.visit.status === "WAITING") actions.push("START_CONSULTATION");
  if (["CONSULTING", "AWAITING_ORDER_REVISION"].includes(evidence.visit.status)) {
    actions.push("OPEN_CONSULTATION");
  }
  if (reviewAllergyAvailable(evidence.allergyState, evidence.visit.status)) actions.push("REVIEW_ALLERGY");
  // Legacy UNKNOWN is a safety boundary: existing workflow still permits Doctor consultation
  // work, but no fulfillment/financial mutation may make it look finalizable.
  if (!allergyUnknown) {
    if (!stockShort) actions.push(...fulfillmentDomainActions(evidence));
    for (const action of evidence.finance.allowedActions) {
      const mapped = financeActionMap[action];
      if (mapped) actions.push(mapped);
    }
    if (stockShort) actions.push("RECEIVE_STOCK");
  }
  if (evidence.visit.status === "CLOSED" && !evidence.hasClosure) return [];
  return uniqueActions(actions).filter((action) => hasPermission(actor, journeyPermission[action]));
}

function plannedAction(evidence: JourneyEvidence): JourneyAction | null {
  switch (evidence.visit.status) {
    case "WAITING": return "START_CONSULTATION";
    case "CONSULTING":
    case "AWAITING_ORDER_REVISION": return "OPEN_CONSULTATION";
    case "AWAITING_PREPARATION": return "START_PREPARATION";
    case "PREPARING":
      if (!evidence.fulfillment.hasPrint) return "PRINT_LABEL";
      if (evidence.fulfillment.confirmationCount < evidence.fulfillment.allocationCount) return "CONFIRM_ALLOCATION";
      return "COMPLETE_PREPARATION";
    case "AWAITING_RELEASE": return "RELEASE_MEDICATION";
    case "AWAITING_HANDOFF": return "HANDOFF_MEDICATION";
    case "AWAITING_CHARGE": return "FINALIZE_CHARGE";
    case "AWAITING_PAYMENT": return "RECORD_CASH";
    case "READY_TO_CLOSE": return "CLOSE_VISIT";
    case "CLOSED": return evidence.hasClosure ? "OPEN_OPD_CARD" : null;
  }
}

function toNextTask(
  actor: Actor,
  action: JourneyAction | null,
  allowedActions: readonly JourneyAction[],
  blockers: readonly JourneyBlocker[],
): JourneySummaryDto["nextTask"] {
  if (!action) return null;
  if (action === "OPEN_OPD_CARD" && actor.role !== "doctor") return null;
  const relevantBlocker = blockers.find((blocker) => blocker.recoveryAction === action);
  const primaryRole = relevantBlocker?.primaryRole ?? actionPrimaryRole[action];
  const availability = allowedActions.includes(action)
    ? "AVAILABLE"
    : permittedRoles(action).includes(actor.role)
      ? "BLOCKED"
      : "WAITING_FOR_ROLE";
  return {
    action,
    labelTh: actor.role === "assistant" && availability === "WAITING_FOR_ROLE" && [
      "START_CONSULTATION",
      "OPEN_CONSULTATION",
    ].includes(action)
      ? "รอแพทย์ตรวจและสั่งการรักษา"
      : journeyActionLabels[action],
    primaryRole,
    permittedRoles: permittedRoles(action),
    availability,
  };
}

function deriveSummary(actor: Actor, evidence: JourneyEvidence): JourneySummaryDto {
  const blockers: JourneyBlocker[] = [];
  if (evidenceInconsistent(evidence)) {
    blockers.push(inconsistentBlocker());
  } else {
    if (evidence.allergyState === "UNKNOWN") blockers.push(allergyBlocker(evidence.visit.status));
    if (evidence.readiness && !evidence.readiness.ready) blockers.push(...stockBlockers(evidence.readiness));
  }
  const allowedActions = domainActions(actor, evidence, blockers);
  const recovery = blockers.find((blocker) => blocker.recoveryAction !== null)?.recoveryAction ?? null;
  const nextTask = toNextTask(
    actor,
    recovery ?? plannedAction(evidence),
    allowedActions,
    blockers,
  );
  return {
    steps: deriveSteps(evidence, blockers),
    nextTask,
    blockers,
    allowedActions,
  };
}

export function createJourneyService(input: JourneyServiceOptions): JourneyService {
  const readEvidence = (actor: Actor, visitId: string): JourneyEvidence => {
    const journeyVisit = input.visits.getJourneyVisit(visitId);
    if (!journeyVisit) return notFound();
    const medication = input.medications.getJourneyDecision(visitId);
    return {
      visit: journeyVisit.visit,
      allergyState: input.patients.getAllergyAssessment(journeyVisit.patientId).state,
      clinical: input.clinical.getJourneyEvidence(visitId),
      medication,
      fulfillment: input.fulfillment.getJourneyEvidence(visitId),
      finance: input.finance.getJourneyEvidence(actor, visitId),
      readiness: medication?.kind === "ORDER" && journeyVisit.visit.status === "AWAITING_PREPARATION"
        ? input.inventory.getReservationReadiness(visitId)
        : null,
      hasClosure: input.completion.hasClosure(visitId),
    };
  };

  return {
    getJourney(actor, visitId) {
      const evidence = readEvidence(actor, visitId);
      const summary = deriveSummary(actor, evidence);
      return {
        visit: {
          id: evidence.visit.id,
          status: evidence.visit.status,
          revision: evidence.visit.revision,
        },
        ...summary,
        refreshedAt: input.clock().toISOString(),
      };
    },

    getSummary(actor, visitId) {
      return deriveSummary(actor, readEvidence(actor, visitId));
    },

    summarizeCommittedIntake(actor, item) {
      return deriveSummary(actor, {
        visit: item.visit,
        allergyState: item.allergy.state,
        clinical: { hasDraft: false, hasSignedNote: false },
        medication: null,
        fulfillment: {
          allowedActions: [],
          hasLabel: false,
          hasReservation: false,
          preparationStatus: null,
          allocationCount: 0,
          confirmationCount: 0,
          hasPrint: false,
          hasRelease: false,
          hasDispense: false,
        },
        finance: {
          collectionState: "PENDING_CHARGE",
          allowedActions: [],
          hasCharge: false,
          resolutionKind: null,
        },
        readiness: null,
        hasClosure: false,
      });
    },
  };
}
