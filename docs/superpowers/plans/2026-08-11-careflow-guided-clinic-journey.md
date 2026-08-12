# CareFlow Guided Clinic Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing synthetic-only CareFlow vertical slice understandable and recoverable from Intake through Closure by requiring a yes/no Allergy answer at Intake and exposing one role-aware, server-derived Visit Journey across the existing screens.

**Architecture:** Keep the current Visit, Clinical, Fulfillment, Inventory, Finance, and Closure state machines unchanged. Extend the existing audited Intake command so Visit, Observation, Allergy revision, Patient revision, audits, and exact idempotency response commit atomically; extract stock planning into a read-only FEFO projection; then compose privacy-safe evidence from public module interfaces in `server/workflows/journey.ts`. React consumes that projection through shared Journey components and semantic-action routing instead of interpreting raw Visit statuses independently.

**Tech Stack:** Node.js 22, TypeScript 5.9, Fastify 5, SQLite WAL, Drizzle ORM, Zod 4, React 19, TanStack Query, React Router, Vitest, Testing Library, MSW, and Playwright.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-11-careflow-guided-clinic-journey-design.md` and is authoritative.
- This remains a local synthetic-only pre-pilot. Never add real-patient fields, deployment behavior, LAN exposure, backup claims, or production-readiness language.
- Do not modify `careflow-webapp/`, `stitch_careflow_clinic_management_system/`, `.DS_Store`, the prior UAT database, or any untracked user file.
- Add no schema migration. Every SQL migration and Drizzle snapshot from `0000` through `0022` must remain byte-identical; the journal stays at 23 entries.
- Preserve the existing Stitch-derived composition and CSS. Add scoped classes/components; do not replace the current Intake, Queue, Consultation, Dispensing, Checkout, Inventory, or OPD screens.
- The Server remains the authority for state, role, permissions, stock, evidence, and allowed actions. Client CTA visibility is not a security boundary.
- Strict Zod contracts reject unknown keys and own `__proto__` keys. Intake v2 uses exact idempotent response storage: first commit `201`, same-key replay `200`, collision `409`, different-key active-Visit duplicate conflict with zero writes.
- Assistant must never receive SOAP, diagnosis, Clinical Note text, content hashes, OPD evidence, or new clinical fields through Journey. Allergy remains visible because both roles already have Allergy review permission.
- Stock readiness is advisory and read-only. Reservation still rechecks FEFO, expiry, quarantine, active reservations, revisions, and availability inside its existing immediate transaction.
- A Journey read failure must leave the primary read-only screen visible but disable mutation CTAs until authority refetch succeeds.
- Every task is test-first. Commit only after focused and proportional full verification, then request a read-only review; fix every Critical or Important finding before starting the next task.

---

### Task 1: Atomic Intake Allergy and Clinical Safety Gate

**Files:**

- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/patient/service.ts`
- Modify: `careflow-pilot/src/server/modules/patient/index.ts`
- Modify: `careflow-pilot/src/server/modules/patient/routes.ts`
- Modify: `careflow-pilot/src/server/modules/visit/service.ts`
- Modify: `careflow-pilot/src/server/modules/visit/routes.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Create: `careflow-pilot/tests/server/intake-allergy.test.ts`
- Modify: `careflow-pilot/tests/server/visit.test.ts`
- Modify: `careflow-pilot/tests/server/clinical-workflow.test.ts`
- Modify: `careflow-pilot/tests/server/patient.test.ts`

**Interfaces:**

```ts
export type IntakeAllergyAnswer =
  | { answer: "NO"; items: []; changeReason: string | null }
  | {
      answer: "YES";
      items: Array<{
        substance: string;
        reaction: string;
        severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE";
        note: string | null;
      }>;
      changeReason: string | null;
    };

export type PatientAllergyContextDto = {
  patient: PatientDto;
  allergy: AllergyAssessmentDto;
};

export type IntakeWriteStage =
  | "AFTER_VISIT_INSERT"
  | "AFTER_OBSERVATION_INSERT"
  | "AFTER_ALLERGY_INSERT"
  | "AFTER_PATIENT_REVISION"
  | "AFTER_ALLERGY_AUDIT"
  | "AFTER_INTAKE_AUDIT";

interface PatientService {
  getAllergyContext(patientId: string): PatientAllergyContextDto;
  recordIntakeAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    input: {
      patientId: string;
      visitId: string;
      expectedPatientRevision: number;
      answer: IntakeAllergyAnswer;
      occurredAt: string;
      afterWrite?: (stage: IntakeWriteStage) => void;
    },
  ): PatientAllergyContextDto;
  assertResolvedAllergy(tx: AppTransaction, patientId: string): AllergyAssessmentDto;
}
```

- `GET /api/patients/:patientId/allergy-assessment` requires `patient:read` and returns `{ data: PatientAllergyContextDto }`.
- `POST /api/visits/intake` changes its operation literal from `visit.submit-intake.v1` to `visit.submit-intake.v2`.
- Server, not Client, writes `sourceText="ผู้ป่วยตอบระหว่าง Intake"` and chooses either the trimmed change reason or `ทบทวนก่อนส่งเข้าคิว`.

- [ ] **Step 1: Write RED strict-contract tests.** In `intake-allergy.test.ts`, import `submitIntakeBodySchema` and assert: `NO` accepts only `items: []`; `YES` requires 1–20 items; Unicode boundaries are 200/300/500 code points; severity rejects values outside the four canonical values; missing answer, unknown keys at every level, and an own `__proto__` key fail parsing. Add a strict response test for `patientAllergyContextSchema`.

```ts
const noAnswer = {
  expectedRevisions: { patient: 1 },
  payload: {
    patientId: "patient-1",
    chiefComplaint: "ไอ",
    vitals: emptyVitals,
    allergy: { answer: "NO", items: [], changeReason: null },
  },
};

expect(submitIntakeBodySchema.parse(noAnswer).payload.allergy.answer).toBe("NO");
expect(() => submitIntakeBodySchema.parse({
  ...noAnswer,
  payload: {
    ...noAnswer.payload,
    allergy: { answer: "YES", items: [], changeReason: null },
  },
})).toThrow();
```

- [ ] **Step 2: Write RED atomic-service and route tests.** Cover `UNKNOWN→NONE_KNOWN`, `UNKNOWN→PRESENT` with two ordered items, `PRESENT→NO` and `NONE_KNOWN→YES` requiring a 1–500 character reason, same-state review appending a new Allergy revision, and current Patient revision increasing exactly once. Assert identical `recordedAt`, `reviewedAt`, and audit timestamps from the injected clock. Assert `allergy.updated` metadata includes `visitId`, `previousState`, `state`, `allergyRevisionId`, `allergyRevision`, and `itemCount`; assert `visit.intake-submitted` includes the committed Allergy ID/state.

- [ ] **Step 3: Add rollback, replay, duplicate, and race RED cases.** Inject once at each `IntakeWriteStage`; before and after each failed request compare byte snapshots/counts of Visit, Observation, Allergy revisions/items, Patient row, Audit rows, and Idempotency rows. Add one same-key replay with byte-equivalent `data`, one same-key payload collision, one different-key active-Visit duplicate, and two concurrent Patient-revision submissions with exactly one winner.

```ts
for (const stage of intakeWriteStages) {
  const before = readIntakeEvidence(database, patientId);
  const app = await createTestApp(database, {
    intakeFailureInjector: (current) => {
      if (current === stage) throw new Error(`fail:${stage}`);
    },
  });
  expect((await postIntake(app, command)).statusCode).toBe(500);
  expect(readIntakeEvidence(database, patientId)).toEqual(before);
}
```

- [ ] **Step 4: Add the unresolved-Allergy clinical RED case.** Start a legacy `UNKNOWN` Visit and save valid Note/Medication drafts. POST finalization and expect `409 INVALID_STATE`; assert Note, Diagnosis, signed Decision, Label, Visit, Audit, and Idempotency rows are unchanged. Prove draft save and Consultation read still work, then review Allergy and prove the same finalization path can commit.

- [ ] **Step 5: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/intake-allergy.test.ts tests/server/visit.test.ts tests/server/clinical-workflow.test.ts tests/server/patient.test.ts
```

Expected: failures because the Intake Allergy union, Allergy-context route, atomic write helper, v2 command behavior, failure seam, and finalization guard do not exist.

- [ ] **Step 6: Implement the strict shared contracts.** Add `intakeAllergyAnswerSchema`, `patientAllergyContextSchema`, and `allergy` to `intakePayloadSchema`. Use `z.discriminatedUnion("answer", ...)`, `z.tuple([])` for `NO`, existing `allergyItemSchema`, `.min(1).max(20)` for `YES`, `z.string().trim().min(1).max(500).nullable()` for a supplied reason, and `rejectOwnPrototypeKeys` around the complete command.

- [ ] **Step 7: Deepen Patient Allergy writes without duplicating rules.** Refactor the current `reviewAllergy` implementation through one private `appendAllergyRevision(...)`. `recordIntakeAllergy` must read the latest assessment inside `tx`, derive `NONE_KNOWN`/`PRESENT`, enforce change reason only when both states are resolved and different, append evidence/items, compare-and-swap Patient revision, and append the existing required-reason `allergy.updated` audit. `reviewAllergy` must retain its current external contract and safety invalidation behavior.

```ts
const changedResolvedState =
  previous.state !== "UNKNOWN" && previous.state !== nextState;
const suppliedReason = input.answer.changeReason?.trim() ?? "";
if (changedResolvedState && suppliedReason.length === 0) {
  throw new ApiError({
    code: "VALIDATION_FAILED",
    messageTh: "กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน",
    fieldErrors: {
      "payload.allergy.changeReason": "กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน",
    },
  });
}
const reason = suppliedReason || "ทบทวนก่อนส่งเข้าคิว";
```

- [ ] **Step 8: Make Intake one atomic command.** In `VisitService.submitIntake`, keep the active-Visit check before all writes; insert Visit and Observation; call `recordIntakeAllergy` with the same `now`; append the Intake audit; and build the response using the updated Patient/Allergy returned from the same transaction. Invoke the failure seam after every specified write boundary. In the route, use operation `visit.submit-intake.v2` and retain full exact-envelope storage—do not add a safe-reference rebuild.

- [ ] **Step 9: Add the read route and finalization gate.** Permission-check the Allergy-context GET before reading Patient/Allergy. In `VisitService.assertFinalizeConsultationVisit`, call `patients.assertResolvedAllergy(tx, visit.patientId)` after Visit/Patient revision checks and before any Note/Decision write. Return `INVALID_STATE` with Thai copy `ยังลงนามไม่ได้ กรุณาทบทวนประวัติแพ้ยาก่อน` for `UNKNOWN`.

- [ ] **Step 10: Run GREEN and full server checks.** Run the focused command, then `npm run test:server`, `npm run typecheck:server`, `npm run lint`, and `git diff --check`. Confirm there is no `careflow-pilot/drizzle` diff.

- [ ] **Step 11: Commit and review.** Commit `feat: make intake allergy atomic`, write the Task 1 report, and request read-only review of strict parsing, audit reason policy, rollback coverage, exact replay, concurrency, and the pre-write clinical gate.

---

### Task 2: Intake Allergy UX, Localized Review, and Session Return Truth

**Files:**

- Create: `careflow-pilot/src/client/components/careflow/IntakeAllergyCard.tsx`
- Create: `careflow-pilot/src/client/components/careflow/SessionReturnNotice.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/AllergyReviewDialog.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/AppShell.tsx`
- Modify: `careflow-pilot/src/client/features/allergy.ts`
- Modify: `careflow-pilot/src/client/features/intake.ts`
- Modify: `careflow-pilot/src/client/features/patients.ts`
- Modify: `careflow-pilot/src/client/screens/IntakeScreen.tsx`
- Modify: `careflow-pilot/src/client/auth/AuthProvider.tsx`
- Modify: `careflow-pilot/src/client/auth/LoginScreen.tsx`
- Modify: `careflow-pilot/src/client/app/query-client.ts`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Modify: `careflow-pilot/tests/client/intake.test.tsx`
- Modify: `careflow-pilot/tests/client/queue.test.tsx`
- Modify: `careflow-pilot/tests/client/consultation.test.tsx`
- Modify: `careflow-pilot/tests/client/auth.test.tsx`
- Modify: `careflow-pilot/tests/client/query-client.test.ts`

**Interfaces:**

```ts
export type IntakeAllergyDraft = {
  answer: "NO" | "YES" | null;
  items: Array<{
    key: string;
    substance: string;
    reaction: string;
    severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE";
    note: string;
  }>;
  changeReason: string;
};

export const queryKeys = {
  // existing keys
  patientAllergy: (patientId: string) => ["patient-allergy", patientId] as const,
};

type AuthRequiredReason = "AUTH_REQUIRED" | "SESSION_EXPIRED";
type SessionReturnState = { authNotice?: "SESSION_EXPIRED" };
```

- [ ] **Step 1: Write Intake component RED tests.** Assert there is no preselected answer; submit remains unavailable until Patient Allergy context has loaded and `ไม่แพ้` or `แพ้` is selected; `แพ้` shows one required item, severity labels, add/remove up to 20, and optional note; existing `PRESENT` items prefill but the answer remains unset. Assert `PRESENT↔NONE_KNOWN` shows a warning and requires reason, while prior `UNKNOWN` does not.

- [ ] **Step 2: Write retry/race/focus RED tests.** Assert a `422` focuses the first Allergy field and keeps every draft; a Patient `409 REVISION_CONFLICT` refetches Patient/Allergy, preserves complaint/vitals, clears only the answer/change decision, and requires reconfirmation; a `500` explicit retry reuses the exact idempotency key/body; editing any Intake or Allergy value creates a new attempt.

- [ ] **Step 3: Write localization and session RED tests.** Assert the review dialog buttons are `ยังไม่ทราบ`, `ยืนยันว่าไม่แพ้`, and `มีประวัติแพ้ยา`, while its payload remains canonical. Simulate an authenticated protected-query `401`: expect `/login?returnTo=...&reason=session-expired`, successful login returning to the same path, and one `เซสชันหมดอายุ งานยังไม่ได้ถูกบันทึก` notice. Initial anonymous entry must not claim expiry. Assert no clinical draft is written to Local Storage or Session Storage.

- [ ] **Step 4: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:client -- tests/client/intake.test.tsx tests/client/queue.test.tsx tests/client/consultation.test.tsx tests/client/auth.test.tsx tests/client/query-client.test.ts
```

Expected: failures because the Allergy card/context query, localized controls, field-focus behavior, and session-expiry notice do not exist.

- [ ] **Step 5: Implement the Patient Allergy query and draft conversion.** `usePatientAllergy(patientId)` must decode `patientAllergyContextSchema`; Intake uses the returned Patient revision, not the possibly stale search-result revision. Extend `createIntakeAttempt` to accept `IntakeAllergyDraft` and emit only the approved `answer/items/changeReason` union—never provenance, reviewer, timestamp, or canonical state.

```ts
export function createIntakeAttempt(
  context: PatientAllergyContextDto,
  draft: IntakeDraft,
  allergy: IntakeAllergyDraft,
): IntakeAttempt {
  if (allergy.answer === null) throw new Error("An Intake Allergy answer is required");
  return createCommandAttempt(
    { patient: context.patient.revision },
    {
      ...intakePayloadFromDraft(context.patient.id, draft),
      allergy: allergy.answer === "NO"
        ? { answer: "NO", items: [], changeReason: nullableTrim(allergy.changeReason) }
        : {
            answer: "YES",
            items: allergy.items.map(toContractItem),
            changeReason: nullableTrim(allergy.changeReason),
          },
    },
  );
}
```

- [ ] **Step 6: Implement `IntakeAllergyCard`.** Keep it presentational: props carry latest assessment, draft, field errors, disabled state, and change callbacks. Use a named `<fieldset>`/`<legend>` and two radio inputs, Thai state/severity labels, prior-assessment summary, conditional item editors, and a change-reason warning. Expose refs or an `onRegisterField` callback so Intake can focus the first failed field.

- [ ] **Step 7: Integrate Intake without losing drafts.** Selecting a Patient resets Allergy answer and loads current context. Switching Patient retains the existing confirmation behavior. Disable submit while context is pending/stale or answer is null. Map Server paths such as `payload.allergy.items.0.substance` and `payload.allergy.changeReason` to component fields. On revision conflict, refetch context and clear the answer only; on server/network retry, retain the saved attempt.

- [ ] **Step 8: Localize the existing review dialog.** Keep all three canonical states available for legacy review, but render only Thai labels. Preserve its existing conflict reload, draft preservation, item limits, and strict payload. Add a shared `allergyStateLabelTh` helper rather than repeating raw-enum maps in Queue and Consultation.

- [ ] **Step 9: Implement truthful session return.** Distinguish initial `AUTH_REQUIRED` from an established-session expiry. Add `reason=session-expired` only for the latter, preserve sanitized `returnTo`, and navigate after login with `{ state: { authNotice: "SESSION_EXPIRED" } }`. `SessionReturnNotice` lives in `AppShell`, displays once with `role="status"`, then clears only Router state with a replace navigation. Do not persist the notice or any form data in browser storage.

- [ ] **Step 10: Run GREEN/full client checks and commit.** Run the focused command, full `npm run test:client`, `npm run typecheck:client`, `npm run lint`, `npm run build:client`, and `git diff --check`. Commit `feat: require allergy answer during intake`; request accessibility, retry-key, revision-race, and session-truth review.

---

### Task 3: Read-only FEFO Stock Readiness

**Files:**

- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/inventory/service.ts`
- Modify: `careflow-pilot/src/server/modules/inventory/index.ts`
- Create: `careflow-pilot/tests/server/inventory-readiness.test.ts`
- Modify: `careflow-pilot/tests/server/fulfillment-reservation.test.ts`
- Modify: `careflow-pilot/tests/server/inventory.test.ts`

**Interfaces:**

```ts
export type ReservationReadinessDto = {
  ready: boolean;
  lines: Array<{
    medicationId: string;
    displayNameSnapshot: string;
    required: number;
    available: number;
    shortfall: number;
    unitSnapshot: string;
  }>;
};

interface InventoryService {
  getReservationReadiness(visitId: string): ReservationReadinessDto;
  // existing reserveForVisit remains the write boundary
}
```

- [ ] **Step 1: Write RED readiness tests.** Seed a signed ORDER and assert zero-stock, one-lot, multi-lot FEFO, quarantined, Bangkok-today expiry, future expiry, stock movements, active reservations, and duplicate Medication Order items. Duplicate demand must be summed into one line; lines retain signed display/unit snapshots and deterministic Medication order.

- [ ] **Step 2: Prove reads have no side effects.** Snapshot all Reservation, Allocation, Movement, Lot revision, Visit revision, Audit, and Idempotency rows; call readiness repeatedly; assert byte equality. Advance the injected clock across Bangkok midnight and assert expiry changes the projection without writes.

- [ ] **Step 3: Write read/command parity and race tests.** For each readiness fixture, assert `ready=true` allows the existing reserve command and produces the exact per-order-item FEFO allocations. When `ready=false`, reserve returns `RESERVATION_NOT_SELLABLE` with zero writes. For the race, read ready, reserve stock in another Visit, then assert the original reserve fails safely and no stock becomes negative.

- [ ] **Step 4: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/inventory-readiness.test.ts tests/server/fulfillment-reservation.test.ts tests/server/inventory.test.ts
```

Expected: failure because `ReservationReadinessDto`, `getReservationReadiness`, and a shared allocation planner are absent.

- [ ] **Step 5: Extract one pure reservation planner.** Reuse `readLotBalances`, clinic-date filtering, and deterministic FEFO ordering. The planner must aggregate demand for the read model while preserving allocation association to each immutable Order Item for the command.

```ts
type ReservationPlan = {
  readiness: ReservationReadinessDto;
  allocations: Array<{
    orderItem: MedicationOrderItemRow;
    lot: InventoryLotRow;
    quantity: number;
  }>;
};

type MedicationOrderItemRow = typeof medicationOrderItems.$inferSelect;
type InventoryLotRow = typeof inventoryLots.$inferSelect;

function planReservation(
  orderItems: MedicationOrderItemRow[],
  balances: LotBalance[],
  currentClinicDate: string,
): ReservationPlan;
```

The planner filters `status === "AVAILABLE"`, `expiryDate > currentClinicDate`, and `available > 0`; sorts by expiry then lot ID; sums `required` and sellable `available` by Medication; computes `shortfall=Math.max(0, required-available)`; and returns allocations only when every line is ready.

- [ ] **Step 6: Wire both read and reserve to the planner.** `getReservationReadiness` requires a current signed `ORDER` and performs no write. `reserveForVisit` keeps Visit/decision revision, active-reservation, status, compare-and-swap, audit, and transaction checks, but replaces its duplicated FEFO loop with `planReservation`. Preserve the existing stable error code and Thai domain message.

- [ ] **Step 7: Run GREEN/full server checks and commit.** Run focused tests, full server tests, server typecheck, lint, diff-check, and confirm no migration diff. Commit `feat: add read-only stock readiness`; request review of duplicate-demand math, Bangkok expiry, active reservations, no-write proof, and command parity.

---

### Task 4: Privacy-safe Server Visit Journey

**Files:**

- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/visit/service.ts`
- Modify: `careflow-pilot/src/server/modules/visit/routes.ts`
- Modify: `careflow-pilot/src/server/modules/medication/service.ts`
- Modify: `careflow-pilot/src/server/modules/fulfillment/service.ts`
- Modify: `careflow-pilot/src/server/modules/finance/service.ts`
- Modify: `careflow-pilot/src/server/workflows/clinical.ts`
- Modify: `careflow-pilot/src/server/workflows/visit-completion.ts`
- Create: `careflow-pilot/src/server/workflows/journey.ts`
- Create: `careflow-pilot/src/server/workflows/journey-routes.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Create: `careflow-pilot/tests/server/journey.test.ts`
- Modify: `careflow-pilot/tests/server/visit.test.ts`
- Modify: `careflow-pilot/tests/server/platform.test.ts`

**Interfaces:**

```ts
export type JourneyStepCode =
  | "INTAKE" | "SCREENING" | "CONSULTATION" | "MEDICATION_DECISION"
  | "PREPARATION" | "HANDOFF" | "PAYMENT" | "CLOSURE";

export type JourneyAction =
  | "START_CONSULTATION" | "REVIEW_ALLERGY" | "OPEN_CONSULTATION"
  | "START_PREPARATION" | "PRINT_LABEL" | "CONFIRM_ALLOCATION"
  | "COMPLETE_PREPARATION" | "RELEASE_MEDICATION" | "HANDOFF_MEDICATION"
  | "FINALIZE_CHARGE" | "RECORD_CASH" | "RECORD_PROMPTPAY"
  | "APPROVE_FULL_WAIVER" | "CLOSE_VISIT" | "OPEN_OPD_CARD"
  | "RECEIVE_STOCK";

export type JourneyBlocker = {
  code: "ALLERGY_UNKNOWN" | "STOCK_SHORTAGE" | "EVIDENCE_INCONSISTENT";
  titleTh: string;
  detailTh: string;
  primaryRole: "assistant" | "doctor";
  recoveryAction: JourneyAction | null;
  medication: ReservationReadinessDto["lines"][number] | null;
};

export type VisitJourneyDto = {
  visit: { id: string; status: VisitStatus; revision: number };
  steps: Array<{ code: JourneyStepCode; labelTh: string; state: "COMPLETE" | "CURRENT" | "UPCOMING" | "SKIPPED" | "BLOCKED" }>;
  nextTask: null | {
    action: JourneyAction;
    labelTh: string;
    primaryRole: "assistant" | "doctor";
    permittedRoles: Array<"assistant" | "doctor">;
    availability: "AVAILABLE" | "WAITING_FOR_ROLE" | "BLOCKED";
  };
  blockers: JourneyBlocker[];
  allowedActions: JourneyAction[];
  refreshedAt: string;
};

export type JourneySummaryDto = Omit<VisitJourneyDto, "visit" | "refreshedAt">;
export type QueueBaseItemDto = Omit<QueueItemDto, "journeySummary">;

interface JourneyService {
  getJourney(actor: Actor, visitId: string): VisitJourneyDto;
  getSummary(actor: Actor, visitId: string): JourneySummaryDto;
  summarizeCommittedIntake(actor: Actor, item: QueueBaseItemDto): JourneySummaryDto;
}

declare function createJourneyService(input: {
  visits: VisitService;
  patients: PatientService;
  clinical: ClinicalWorkflow;
  medications: MedicationService;
  fulfillment: FulfillmentService;
  inventory: InventoryService;
  finance: FinanceService;
  completion: VisitCompletionWorkflow;
  clock: () => Date;
}): JourneyService;
```

Public evidence readers added to existing modules must return no prose or hashes:

```ts
VisitService.getJourneyVisit(visitId): { visit: VisitSummaryDto; patientId: string } | null;
ClinicalWorkflow.getJourneyEvidence(visitId): { hasDraft: boolean; hasSignedNote: boolean };
MedicationService.getJourneyDecision(visitId): null | { id: string; version: number; kind: "ORDER" | "NO_MEDICATION" };
FulfillmentService.getJourneyEvidence(visitId): {
  allowedActions: FulfillmentPickListDto["allowedActions"];
  hasLabel: boolean; hasReservation: boolean; preparationStatus: "ACTIVE" | "COMPLETED" | null;
  allocationCount: number; confirmationCount: number; hasPrint: boolean; hasRelease: boolean; hasDispense: boolean;
};
FinanceService.getJourneyEvidence(actor: Actor, visitId: string): {
  collectionState: CheckoutDto["collectionState"];
  allowedActions: CheckoutDto["allowedActions"];
  hasCharge: boolean;
  resolutionKind: "PAYMENT" | "COLLECTION_NOT_REQUIRED" | "PENDING_COLLECTION" | null;
};
VisitCompletionWorkflow.hasClosure(visitId): boolean;
```

- [ ] **Step 1: Write RED contract and truth-table tests.** Strict-parse all step/state/action enums, blockers, `nextTask`, and Queue `journeySummary`; reject unknown/prototype keys. Build table-driven server cases for every Visit status, ORDER, NO_MEDICATION, Cash, PromptPay, full waiver, and CLOSED with/without Closure. Assert exact eight-step order and Thai labels.

```ts
const cases = [
  { status: "WAITING", current: "CONSULTATION", next: "START_CONSULTATION" },
  { status: "CONSULTING", current: "CONSULTATION", next: "OPEN_CONSULTATION" },
  { status: "AWAITING_ORDER_REVISION", current: "MEDICATION_DECISION", next: "OPEN_CONSULTATION" },
  { status: "AWAITING_PREPARATION", current: "PREPARATION", next: "START_PREPARATION" },
  { status: "PREPARING", current: "PREPARATION", next: "PRINT_LABEL" },
  { status: "AWAITING_RELEASE", current: "PREPARATION", next: "RELEASE_MEDICATION" },
  { status: "AWAITING_HANDOFF", current: "HANDOFF", next: "HANDOFF_MEDICATION" },
  { status: "AWAITING_CHARGE", current: "PAYMENT", next: "FINALIZE_CHARGE" },
  { status: "AWAITING_PAYMENT", current: "PAYMENT", next: "RECORD_CASH" },
  { status: "READY_TO_CLOSE", current: "CLOSURE", next: "CLOSE_VISIT" },
] as const;
```

For `PREPARING`, vary evidence to select `PRINT_LABEL`, `CONFIRM_ALLOCATION`, or `COMPLETE_PREPARATION`; do not hard-code only the first action.

- [ ] **Step 2: Write role/privacy/no-write RED tests.** Compare Assistant and Doctor projections at each role handoff. Recursively assert Assistant JSON has none of `subjective`, `objective`, `assessment`, `plan`, `diagnoses`, `phone`, `contentHash`, `clinicalNote`, or `opd`. Both authenticated roles return `200`; a direct anonymous request returns `401` before any evidence reader is called. Snapshot every domain table before/after repeated Journey/Queue reads and assert byte equality.

- [ ] **Step 3: Write blocker RED tests.** Legacy `UNKNOWN` produces `ALLERGY_UNKNOWN` and `REVIEW_ALLERGY`; zero/multi-med stock produces one `STOCK_SHORTAGE` blocker per Medication with exact required/available/shortfall/unit; eligible actors receive `RECEIVE_STOCK`, while other roles receive no fake CTA. CLOSED without Closure yields `EVIDENCE_INCONSISTENT`, no OPD action, and no clinical detail.

- [ ] **Step 4: Write Queue consistency RED tests.** Assert `GET /api/queue` embeds `journeySummary` equal to removing `visit/refreshedAt` from `GET /api/visits/:id/journey`. Intake v2 response must use `summarizeCommittedIntake` so the uncommitted transaction response has the same WAITING summary without a second database write/read race.

- [ ] **Step 5: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/journey.test.ts tests/server/visit.test.ts tests/server/platform.test.ts
```

Expected: failure because Journey contracts/readers/builder/route and Queue summary are absent.

- [ ] **Step 6: Implement privacy-safe module readers.** Each existing module owns its evidence lookup and returns only the exact booleans/enums above. Do not import another module’s schema into Journey. `getJourneyEvidence` methods may call existing private readers but must not expose signed prose, barcodes, patient phone, IDs not needed by Journey, or hashes.

- [ ] **Step 7: Implement the pure derivation and permission map.** In `journey.ts`, keep Thai step/action labels and `JourneyAction→Permission` mapping in one place. `permittedRoles` comes from `permissionsByRole`; `allowedActions` is the intersection of domain-available actions and the current Actor’s permissions. A waiting role gets explanatory copy and no disabled mutation button.

```ts
const journeyPermission: Record<JourneyAction, Permission> = {
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
```

- [ ] **Step 8: Implement special branches exactly.** `UNKNOWN` takes blocker priority but Doctor may still start/open Consultation and save draft; finalization remains absent. `NO_MEDICATION` marks PREPARATION/HANDOFF `SKIPPED`. A full waiver marks collection/PAYMENT `SKIPPED` once Charge resolution is terminal. CLOSED requires Closure; Doctor receives `OPEN_OPD_CARD`, Assistant receives no clinical next task. A stock-short Visit marks PREPARATION `BLOCKED` and uses `RECEIVE_STOCK` as recovery.

- [ ] **Step 9: Register routes after constructing all services.** Refactor `buildApp` from construct-and-register interleaving to: construct Patient, Visit, Medication, Inventory, Fulfillment, Finance, Note, Clinical, Completion, Journey; then register existing routes plus `registerJourneyRoutes`. `GET /api/visits/:visitId/journey` calls `requireActor(request,"visit:read-queue")` before `journey.getJourney`. `registerVisitRoutes` receives Journey and decorates Queue/Intake responses with the same builder.

- [ ] **Step 10: Run GREEN/full server checks and commit.** Run focused tests, full server tests, server typecheck, lint, build-server, diff-check, and no-migration-diff. Commit `feat: add server guided visit journey`; request truth-table, role/privacy, dependency-boundary, no-write, and queue-consistency review.

---

### Task 5: Shared Journey UI and Stock Recovery Navigation

**Files:**

- Create: `careflow-pilot/src/client/features/journey.ts`
- Create: `careflow-pilot/src/client/app/journey-navigation.ts`
- Create: `careflow-pilot/src/client/components/careflow/VisitJourneyRibbon.tsx`
- Create: `careflow-pilot/src/client/components/careflow/JourneyNextTaskCard.tsx`
- Create: `careflow-pilot/src/client/components/careflow/JourneyBlockerCard.tsx`
- Modify: `careflow-pilot/src/client/app/query-client.ts`
- Modify: `careflow-pilot/src/client/features/allergy.ts`
- Modify: `careflow-pilot/src/client/features/visit.ts`
- Modify: `careflow-pilot/src/client/features/clinical.ts`
- Modify: `careflow-pilot/src/client/features/dispensing.ts`
- Modify: `careflow-pilot/src/client/features/finance.ts`
- Modify: `careflow-pilot/src/client/features/inventory.ts`
- Modify: `careflow-pilot/src/client/screens/QueueScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/DispensingScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/CheckoutScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/OpdCardScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/StockReceptionScreen.tsx`
- Modify: `careflow-pilot/src/client/styles/globals.css`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Create: `careflow-pilot/tests/client/journey.test.tsx`
- Modify: `careflow-pilot/tests/client/queue.test.tsx`
- Modify: `careflow-pilot/tests/client/consultation.test.tsx`
- Modify: `careflow-pilot/tests/client/dispensing.test.tsx`
- Modify: `careflow-pilot/tests/client/checkout.test.tsx`
- Modify: `careflow-pilot/tests/client/opd-card.test.tsx`
- Modify: `careflow-pilot/tests/client/inventory.test.tsx`
- Modify: `careflow-pilot/tests/client/router.test.tsx`
- Modify: `careflow-pilot/tests/client/query-client.test.ts`

**Interfaces:**

```ts
export const queryKeys = {
  // existing keys
  journey: (visitId: string) => ["journey", visitId] as const,
};

export function useVisitJourney(visitId: string, client?: ApiClient): UseQueryResult<VisitJourneyDto>;

export type JourneyDestination =
  | { kind: "ROUTE"; to: string }
  | { kind: "LOCAL"; action: "START_CONSULTATION" | "REVIEW_ALLERGY" }
  | { kind: "NONE" };

export function journeyDestination(
  action: JourneyAction,
  visitId: string,
  blocker?: JourneyBlocker,
): JourneyDestination;
```

- [ ] **Step 1: Write component RED tests.** Assert Ribbon renders `<nav aria-label="เส้นทางผู้ป่วย">`, exact eight labels, icon plus state text, one `aria-current="step"`, full accessible list at 375px, and no color-only states. Assert Next Task shows primary role and only an authorized CTA; waiting role receives text without a disabled mutation button. Assert Blocker shows Medication, required, available, shortfall, unit, and a focused `role="alert"` after command failure.

- [ ] **Step 2: Write screen-integration RED tests.** Queue uses embedded summary; Consultation, Dispensing, Checkout, and OPD call the Journey endpoint. At each state assert the same Ribbon and correct next task. Feed stale legacy screen fixtures that claim actions while Journey omits them and assert no forbidden CTA. Make Journey fail after primary screen data loads and assert read-only evidence remains visible while mutation buttons disappear until successful refetch.

- [ ] **Step 3: Write stock-recovery RED tests.** From a shortage blocker, eligible Assistant navigates to:

```text
/inventory/receive?medicationId=DEMO-MED-001&returnTo=%2Fdispensing%2Fvisit-1
```

Stock Reception must select that Medication only after matching it against server Inventory data, preserve the same receipt attempt on explicit retry, navigate to the sanitized `returnTo` after success, and refetch Journey. Invalid/external `returnTo` falls back to `/inventory`; an unknown Medication ID is not trusted or selected.

- [ ] **Step 4: Write reserve-race and invalidation RED tests.** A `RESERVATION_NOT_SELLABLE` response keeps the command failure visible, drops the now-stale reserve attempt, refetches Journey once, and never automatically posts a second command. Every successful Allergy, Consultation, Fulfillment, Finance, Close, and relevant Inventory command invalidates `queryKeys.journey(visitId)` in addition to current keys.

- [ ] **Step 5: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:client -- tests/client/journey.test.tsx tests/client/queue.test.tsx tests/client/consultation.test.tsx tests/client/dispensing.test.tsx tests/client/checkout.test.tsx tests/client/opd-card.test.tsx tests/client/inventory.test.tsx tests/client/router.test.tsx tests/client/query-client.test.ts
```

Expected: failure because the Journey query/components/navigation, authority gating, stock return path, and invalidations do not exist.

- [ ] **Step 6: Implement the Journey query and central navigation.** Decode `visitJourneyResponseSchema`, disable when Visit ID is empty, use no automatic retry for 4xx, and refetch on focus. Route mapping is centralized:

```ts
const visitRoute: Partial<Record<JourneyAction, (visitId: string) => string>> = {
  OPEN_CONSULTATION: (id) => `/consultations/${encodeURIComponent(id)}`,
  START_PREPARATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  PRINT_LABEL: (id) => `/dispensing/${encodeURIComponent(id)}`,
  CONFIRM_ALLOCATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  COMPLETE_PREPARATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  RELEASE_MEDICATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  HANDOFF_MEDICATION: (id) => `/dispensing/${encodeURIComponent(id)}`,
  FINALIZE_CHARGE: (id) => `/checkout/${encodeURIComponent(id)}`,
  RECORD_CASH: (id) => `/checkout/${encodeURIComponent(id)}`,
  RECORD_PROMPTPAY: (id) => `/checkout/${encodeURIComponent(id)}`,
  APPROVE_FULL_WAIVER: (id) => `/checkout/${encodeURIComponent(id)}`,
  CLOSE_VISIT: (id) => `/checkout/${encodeURIComponent(id)}`,
  OPEN_OPD_CARD: (id) => `/visits/${encodeURIComponent(id)}/opd-card`,
};
```

`START_CONSULTATION` and `REVIEW_ALLERGY` remain local Queue actions. `RECEIVE_STOCK` requires the blocker Medication ID and the current `/dispensing/:visitId` return path.

- [ ] **Step 7: Implement the three shared components.** Components receive decoded DTOs only and perform no domain inference. Ribbon handles responsive disclosure in CSS without removing steps from the accessibility tree. Next Task calls the central resolver and only renders a CTA when `allowedActions` contains the semantic action. Blocker owns shortage arithmetic display but never recomputes it.

- [ ] **Step 8: Integrate without replacing screen composition.** Add Journey immediately below each existing `PageHeader`. Queue cards use their embedded summary and pass current start/review handlers. The other screens use `useVisitJourney`. Fold `journey.isPending || journey.isError || journey.isFetching-after-error` into each existing command-disabled condition, render a stale authority banner with one reload action, and leave existing read evidence visible.

- [ ] **Step 9: Implement safe Stock Reception return.** Parse with `useSearchParams`; sanitize `returnTo`; after Inventory loads, find `medicationId` in decoded server data and call the existing selection path. On receipt success invalidate Inventory and Journey, then navigate back. Do not put receipt drafts or clinical context in URL/storage.

- [ ] **Step 10: Complete query invalidation and race handling.** Add a small `invalidateJourney(queryClient, visitId)` helper and call it from mutation successes. In Dispensing, handle `RESERVATION_NOT_SELLABLE` by discarding the stale reservation attempt and refetching Journey; retain the existing attempt only for explicit retryable network/500 failures.

- [ ] **Step 11: Run GREEN/full client checks and commit.** Run the focused command, full client tests, client typecheck, lint, client production build, and diff-check. Check 375/768/1440 layouts in existing responsive tests. Commit `feat: guide users through the clinic journey`; request role, privacy, stale-authority, keyboard/mobile, and recovery-path review.

---

### Task 6: Lifecycle, Two-role Acceptance, and Updated UAT Guide

**Files:**

- Create: `careflow-pilot/tests/e2e/guided-clinic-journey.spec.ts`
- Modify: `careflow-pilot/tests/e2e/fixtures.ts`
- Modify: `careflow-pilot/tests/server/restart.test.ts`
- Modify: `careflow-pilot/tests/server/reset-synthetic-data.test.ts`
- Modify: `careflow-pilot/tests/server/database-artifacts.test.ts`
- Modify: `docs/uat/careflow-pre-pilot/guide-th.md`
- Modify: `docs/uat/careflow-pre-pilot/checklist.md`
- Modify: `docs/uat/careflow-pre-pilot/admin-runbook.md`
- Modify: `careflow-pilot/README.md`
- Create: `.superpowers/sdd/2026-08-11-careflow-guided-clinic-journey/progress.md`
- Create: `.superpowers/sdd/2026-08-11-careflow-guided-clinic-journey/task-6-report.md`

**Acceptance scenarios:**

```ts
type GuidedScenario =
  | "ORDER_WITH_STOCK_RECOVERY"
  | "PRESENT_ALLERGY"
  | "NO_MEDICATION_FULL_WAIVER";
```

- [ ] **Step 1: Write restart/reset/migration-identity RED tests.** A real-file reopen must preserve Intake-created Allergy revision, Patient revision, Journey state/blockers, stock, Charge, Payment, and Closure without adding rows. Reset must remove new synthetic Allergy evidence in dependency order, retain guards, and remain idempotent on a second run. Pin hashes for all `0000`–`0022` SQL and snapshots and assert journal length stays 23.

- [ ] **Step 2: Write the full ORDER E2E RED case.** Use separate Assistant and Doctor BrowserContexts on one temporary production server/database:

1. Assistant creates a Patient, selects `ไม่แพ้`, records Intake, and sees Consultation as the next step.
2. Doctor starts Consultation, saves SOAP/Diagnosis/ORDER quantity 3, and finalizes.
3. Both contexts see PREPARATION blocked with `ต้องการ 3`, `พร้อมใช้ 0`, `ขาด 3`; only the permitted actor receives the stock CTA.
4. Assistant receives 10 units through the CTA and returns to the same Visit.
5. Assistant starts preparation, opens `เปิดฉลากยา`, records print, scans the existing barcode and presses Enter, completes preparation.
6. Doctor releases; Assistant hands off; assert one dispense and stock `onHand=7`, `reserved=0`, `available=7`.
7. Doctor finalizes Charge 115 Baht; Assistant records Cash 115; Doctor closes and opens OPD.
8. Assistant direct Clinical/OPD requests return 403 and Journey JSON contains no clinical prose/hash.
9. Restart the server and assert Journey, Allergy, stock, Charge, Payment, Closure, and Doctor OPD remain equivalent.

- [ ] **Step 3: Write PRESENT and NO_MEDICATION E2E RED cases.** PRESENT requires two Allergy items and proves Thai summaries after restart. NO_MEDICATION marks PREPARATION/HANDOFF skipped, goes directly to Charge, uses Doctor full waiver, marks collection skipped, closes without any Reservation/Dispense rows, and never shows a dispensing CTA.

- [ ] **Step 4: Add browser safety assertions.** At every role handoff, assert only the correct role sees the mutation CTA. Force a stock-readiness race with two Visits and the final available lot; exactly one reserve succeeds, the loser refetches a shortage blocker, and no automatic second POST or negative stock occurs. Simulate session expiry mid-Visit and verify safe return notice plus preserved server evidence without claiming the unsaved draft was stored.

- [ ] **Step 5: Run focused RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/restart.test.ts tests/server/reset-synthetic-data.test.ts tests/server/database-artifacts.test.ts
npm run test:e2e -- tests/e2e/guided-clinic-journey.spec.ts
```

Expected: failures until lifecycle assertions, browser scenarios, and current UI guide labels are complete.

- [ ] **Step 6: Update the UAT guide/checklist.** Every Scenario must ask Allergy `ไม่แพ้`/`แพ้`; name the Journey state expected after each action; use the visible `เปิดฉลากยา` link and instruct Enter after barcode scanning; expose the stock blocker/recovery before preparation; and place role checks while the relevant action still exists. Replace the stop section with an immediate stop of the entire UAT for HTTP 500, cross-role clinical disclosure, negative stock, wrong Baht total, invalid Closure, or evidence loss after restart. Keep passwords and real data out of all documents.

- [ ] **Step 7: Update operator evidence and README.** Keep the local-only host/database rules, link the new Journey UAT guide, state that this remediation is synthetic pre-pilot only, and leave deployment/backup/real-data explicitly disabled. Record exact test counts, commits, known advisories, and review status in the ignored progress/report files.

- [ ] **Step 8: Run the complete fresh verification gate.** From `careflow-pilot` run:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run db:generate
npx drizzle-kit check
git diff --check
```

Create a temporary fresh database, migrate it, and assert: 23 migration rows, `PRAGMA foreign_keys=1`, empty `PRAGMA foreign_key_check`, and all existing protected-evidence guards. Compare every `drizzle/0000`–`0022` SQL/snapshot byte to the Task 1 base. Scan Git for tracked `.sqlite`, `.db`, WAL/SHM, passwords, cookies, and synthetic browser artifacts.

- [ ] **Step 9: Commit and request final review.** Commit `test: cover guided clinic journey acceptance`. Request a fresh whole-branch read-only review against the approved design, with explicit attention to Intake atomicity, exact replay, role privacy, Journey truth table, stock-readiness parity/races, session return truth, reset/restart, migration immutability, frozen scope, responsive/a11y behavior, and executable Thai UAT wording. Fix and re-review every Critical/Important finding before merge or push.
