import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import stableStringify from "fast-json-stable-stringify";
import type {
  Actor,
  CheckoutDto,
  CheckoutLineDto,
  FinalizeChargeBody,
  FinanceResolution,
} from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import { patients } from "../patient/schema.js";
import {
  hasPermission,
  requirePermission,
  type AppDatabase,
  type AppTransaction,
} from "../platform/index.js";
import { clinicConfig } from "../platform/schema.js";
import { visits } from "../visit/schema.js";
import type { ChargeQuote, ChargeQuoteLine } from "./pricing.js";
import {
  financeChargeAdjustments,
  financeChargeLines,
  financeCharges,
  financePayments,
} from "./schema.js";

type FinanceReadTransaction = AppDatabase | AppTransaction;

export interface FinancePricing {
  deriveChargeQuote(
    tx: AppTransaction,
    visitId: string,
    expectedClinicPricingRevision: number,
  ): ChargeQuote;
}

export interface FinanceService {
  getCheckout(actor: Actor, visitId: string): CheckoutDto;
  finalizeCharge(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: FinalizeChargeBody,
  ): CheckoutDto;
  approveFullWaiver(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: ApproveFullWaiverCommand,
  ): CheckoutDto;
  recordCash(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: RecordCashCommand,
  ): CheckoutDto;
  confirmPromptPay(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: ConfirmPromptPayCommand,
  ): CheckoutDto;
  readResolution(tx: AppTransaction, visitId: string): FinanceResolution;
  /** Complete immutable evidence for the caller-owned Visit close transaction. */
  getCloseEvidence(
    tx: AppDatabase | AppTransaction,
    visitId: string,
  ): FinanceCloseEvidence | null;
  /** Rebuilds a safe idempotency replay from immutable Charge evidence only. */
  rebuildFinalization(tx: AppTransaction, reference: ChargeFinalizeReplayReference): CheckoutDto;
  /** Rebuilds a terminal collection replay from pinned immutable evidence. */
  rebuildCollection(tx: AppTransaction, reference: FinanceCollectionReplayReference): CheckoutDto;
}

export interface FinanceServiceOptions {
  database: DatabaseHandle;
  pricing: FinancePricing;
  clock?: () => Date;
  idFactory?: () => string;
}

export interface ChargeFinalizeReplayReference {
  chargeId: string;
  patient: CheckoutDto["patient"];
  visit: CheckoutDto["visit"];
  /** Optional for safe references written before the exact projection was pinned. */
  projection?: ChargeFinalizeReplayProjection;
  /** Omitted by pre-close references whose original Checkout response had no resolution field. */
  responseIncludesResolution?: boolean;
  /** Present only when finalization atomically created a full-waiver resolution. */
  resolution?: Extract<FinanceResolution, { kind: "COLLECTION_NOT_REQUIRED" }>;
}

export interface ChargeFinalizeReplayProjection {
  adjustmentTotalBaht: CheckoutDto["adjustmentTotalBaht"];
  netDueBaht: CheckoutDto["netDueBaht"];
  collectionState: CheckoutDto["collectionState"];
  allowedActions: CheckoutDto["allowedActions"];
  closeBlockers: CheckoutDto["closeBlockers"];
}

export interface ApproveFullWaiverCommand {
  chargeId: string;
  reason: string;
  expectedVisitRevision: number;
}

export interface RecordCashCommand {
  chargeId: string;
  amountBaht: number;
  expectedVisitRevision: number;
}

export interface ConfirmPromptPayCommand {
  chargeId: string;
  amountBaht: number;
  manualReference: string;
  expectedVisitRevision: number;
}

type TerminalFinanceResolution = Extract<
  FinanceResolution,
  { kind: "COLLECTION_NOT_REQUIRED" } | { kind: "PAYMENT" }
>;

export interface FinanceCollectionReplayReference {
  chargeId: string;
  resolution: TerminalFinanceResolution;
  patient: CheckoutDto["patient"];
  visit: CheckoutDto["visit"];
  projection: ChargeFinalizeReplayProjection;
  /** Omitted by pre-close references whose original Checkout response had no resolution field. */
  responseIncludesResolution?: boolean;
}

export interface FinanceCloseEvidence {
  charge: typeof financeCharges.$inferSelect;
  lines: (typeof financeChargeLines.$inferSelect)[];
  grossTotalBaht: number;
  adjustmentTotalBaht: number;
  netDueBaht: number;
  adjustment: typeof financeChargeAdjustments.$inferSelect | undefined;
  payment: typeof financePayments.$inferSelect | undefined;
}

interface CheckoutContext {
  patient: CheckoutDto["patient"];
  visit: CheckoutDto["visit"];
  clinicId: string;
}

interface PersistedChargeEvidence {
  charge: typeof financeCharges.$inferSelect;
  lines: (typeof financeChargeLines.$inferSelect)[];
  grossTotalBaht: number;
  adjustmentTotalBaht: number;
  netDueBaht: number;
  adjustment: typeof financeChargeAdjustments.$inferSelect | undefined;
  payment: typeof financePayments.$inferSelect | undefined;
}

interface ChargeHashLine {
  id: string;
  position: number;
  lineType: "CONSULTATION" | "MEDICATION";
  descriptionSnapshot: string;
  quantity: number;
  unitPriceBaht: number;
  lineTotalBaht: number;
  medicationOrderItemId: string | null;
  fulfillmentDispenseLineId: string | null;
}

interface ChargeHashPayload {
  id: string;
  clinicId: string;
  visitId: string;
  sourceKind: "ORDER" | "NO_MEDICATION";
  medicationDecisionId: string;
  medicationDecisionVersion: number;
  fulfillmentDispenseId: string | null;
  clinicPricingRevision: number;
  consultationFeeBahtSnapshot: number;
  currency: "THB";
  lineCount: number;
  finalizedBy: string;
  finalizedByDisplayName: string;
  finalizedAt: string;
}

interface AdjustmentHashPayload {
  id: string;
  chargeId: string;
  kind: "FULL_WAIVER";
  amountBaht: number;
  reason: string;
  approvedBy: string;
  approvedByDisplayName: string;
  approvedAt: string;
}

interface PaymentHashPayload {
  id: string;
  chargeId: string;
  visitId: string;
  method: "CASH" | "PROMPTPAY";
  amountBaht: number;
  manualReference: string | null;
  confirmedBy: string;
  confirmedByDisplayName: string;
  confirmedAt: string;
}

const financeReadableStatuses = new Set([
  "AWAITING_CHARGE",
  "AWAITING_PAYMENT",
  "READY_TO_CLOSE",
  "CLOSED",
]);

function financeNotReady(): ApiError {
  return new ApiError({
    code: "FINANCE_NOT_READY",
    messageTh: "Visit นี้ยังไม่พร้อมสำหรับการคิดเงิน",
  });
}

function incompleteChargeSource(): ApiError {
  return new ApiError({
    code: "CHARGE_SOURCE_INCOMPLETE",
    messageTh: "หลักฐาน Charge ไม่ครบถ้วน",
  });
}

function chargeAlreadyFinalized(): ApiError {
  return new ApiError({
    code: "CHARGE_ALREADY_FINALIZED",
    messageTh: "Visit นี้ถูก finalize Charge แล้ว",
  });
}

function waiverNotAllowed(): ApiError {
  return new ApiError({
    code: "WAIVER_NOT_ALLOWED",
    messageTh: "Visit นี้ไม่อนุญาตให้ยกเว้นค่าบริการ",
  });
}

function paymentAmountMismatch(): ApiError {
  return new ApiError({
    code: "PAYMENT_AMOUNT_MISMATCH",
    messageTh: "จำนวนเงินรับชำระไม่ตรงกับยอดสุทธิ",
  });
}

function paymentAlreadyRecorded(): ApiError {
  return new ApiError({
    code: "PAYMENT_ALREADY_RECORDED",
    messageTh: "Visit นี้มีหลักฐานการรับชำระหรือยกเว้นแล้ว",
  });
}

function validationFailed(field: string, messageTh: string): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    messageTh: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่",
    fieldErrors: { [field]: messageTh },
  });
}

function assertSafeBaht(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isTrimmedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.trim();
}

function normalizeRequiredText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string") throw validationFailed(field, "ต้องระบุข้อมูล");
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw validationFailed(field, "ต้องระบุข้อมูลที่ถูกต้อง");
  }
  return normalized;
}

function normalizeChargeId(value: unknown): string {
  return normalizeRequiredText(value, 120, "payload.chargeId");
}

function assertPaymentAmount(value: unknown): asserts value is number {
  if (typeof value !== "number" || !assertSafeBaht(value, 1, 100_000_000)) {
    throw validationFailed("payload.amountBaht", "จำนวนเงินบาทต้องเป็นจำนวนเต็ม 1–100000000");
  }
}

function readCheckoutContext(tx: FinanceReadTransaction, visitId: string): CheckoutContext {
  const row = tx
    .select({
      visitId: visits.id,
      clinicId: visits.clinicId,
      visitStatus: visits.status,
      visitRevision: visits.revision,
      arrivedAt: visits.arrivedAt,
      startedAt: visits.startedAt,
      closedAt: visits.closedAt,
      patientId: patients.id,
      patientHn: patients.hn,
      patientDisplayName: patients.displayName,
      patientBirthDate: patients.birthDate,
      patientSex: patients.sex,
    })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .where(eq(visits.id, visitId))
    .get();
  if (!row) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
  if (!financeReadableStatuses.has(row.visitStatus)) throw financeNotReady();
  return {
    clinicId: row.clinicId,
    patient: {
      id: row.patientId,
      hn: row.patientHn,
      displayName: row.patientDisplayName,
      birthDate: row.patientBirthDate,
      sex: row.patientSex,
    },
    visit: {
      id: row.visitId,
      status: row.visitStatus as CheckoutDto["visit"]["status"],
      revision: row.visitRevision,
      arrivedAt: row.arrivedAt,
      startedAt: row.startedAt,
      closedAt: row.closedAt,
    },
  };
}

function readPricingRevision(tx: FinanceReadTransaction, clinicId: string): number {
  const pricing = tx.select({ pricingRevision: clinicConfig.pricingRevision })
    .from(clinicConfig)
    .where(eq(clinicConfig.id, clinicId))
    .get();
  if (!pricing || !assertSafeBaht(pricing.pricingRevision, 1, Number.MAX_SAFE_INTEGER)) {
    throw incompleteChargeSource();
  }
  return pricing.pricingRevision;
}

function quoteLineToCheckoutLine(line: ChargeQuoteLine): CheckoutLineDto {
  return {
    id: null,
    position: line.position,
    lineType: line.lineType,
    descriptionSnapshot: line.descriptionSnapshot,
    quantity: line.quantity,
    unitPriceBaht: line.unitPriceBaht,
    lineTotalBaht: line.lineTotalBaht,
    medicationOrderItemId: line.medicationOrderItemId,
    fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
  };
}

function persistedLineToCheckoutLine(line: typeof financeChargeLines.$inferSelect): CheckoutLineDto {
  return {
    id: line.id,
    position: line.position,
    lineType: line.lineType,
    descriptionSnapshot: line.descriptionSnapshot,
    quantity: line.quantity,
    unitPriceBaht: line.unitPriceBaht,
    lineTotalBaht: line.lineTotalBaht,
    medicationOrderItemId: line.medicationOrderItemId,
    fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
  };
}

function chargeHash(header: ChargeHashPayload, lines: ChargeHashLine[]): string {
  return createHash("sha256")
    .update(stableStringify({ charge: header, lines }))
    .digest("hex");
}

function adjustmentHash(adjustment: AdjustmentHashPayload): string {
  return createHash("sha256")
    .update(stableStringify({ adjustment }))
    .digest("hex");
}

function paymentHash(payment: PaymentHashPayload): string {
  return createHash("sha256")
    .update(stableStringify({ payment }))
    .digest("hex");
}

function hashLine(line: typeof financeChargeLines.$inferSelect | (ChargeQuoteLine & { id: string })): ChargeHashLine {
  return {
    id: line.id,
    position: line.position,
    lineType: line.lineType,
    descriptionSnapshot: line.descriptionSnapshot,
    quantity: line.quantity,
    unitPriceBaht: line.unitPriceBaht,
    lineTotalBaht: line.lineTotalBaht,
    medicationOrderItemId: line.medicationOrderItemId,
    fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
  };
}

function hashHeader(charge: typeof financeCharges.$inferSelect): ChargeHashPayload {
  return {
    id: charge.id,
    clinicId: charge.clinicId,
    visitId: charge.visitId,
    sourceKind: charge.sourceKind,
    medicationDecisionId: charge.medicationDecisionId,
    medicationDecisionVersion: charge.medicationDecisionVersion,
    fulfillmentDispenseId: charge.fulfillmentDispenseId,
    clinicPricingRevision: charge.clinicPricingRevision,
    consultationFeeBahtSnapshot: charge.consultationFeeBahtSnapshot,
    currency: charge.currency,
    lineCount: charge.lineCount,
    finalizedBy: charge.finalizedBy,
    finalizedByDisplayName: charge.finalizedByDisplayName,
    finalizedAt: charge.finalizedAt,
  };
}

function hashAdjustment(
  adjustment: typeof financeChargeAdjustments.$inferSelect | AdjustmentHashPayload,
): AdjustmentHashPayload {
  return {
    id: adjustment.id,
    chargeId: adjustment.chargeId,
    kind: adjustment.kind,
    amountBaht: adjustment.amountBaht,
    reason: adjustment.reason,
    approvedBy: adjustment.approvedBy,
    approvedByDisplayName: adjustment.approvedByDisplayName,
    approvedAt: adjustment.approvedAt,
  };
}

function hashPayment(payment: typeof financePayments.$inferSelect | PaymentHashPayload): PaymentHashPayload {
  return {
    id: payment.id,
    chargeId: payment.chargeId,
    visitId: payment.visitId,
    method: payment.method,
    amountBaht: payment.amountBaht,
    manualReference: payment.manualReference,
    confirmedBy: payment.confirmedBy,
    confirmedByDisplayName: payment.confirmedByDisplayName,
    confirmedAt: payment.confirmedAt,
  };
}

function readChargeEvidence(
  tx: FinanceReadTransaction,
  input: { visitId?: string; chargeId?: string },
  resolutionMode: "CURRENT" | "CHARGE_ONLY" = "CURRENT",
): PersistedChargeEvidence | undefined {
  if ((input.visitId === undefined) === (input.chargeId === undefined)) {
    throw new Error("Exactly one Charge identity is required");
  }
  const charge = tx
    .select()
    .from(financeCharges)
    .where(input.visitId === undefined
      ? eq(financeCharges.id, input.chargeId as string)
      : eq(financeCharges.visitId, input.visitId))
    .get();
  if (!charge) return undefined;
  const lines = tx
    .select()
    .from(financeChargeLines)
    .where(eq(financeChargeLines.chargeId, charge.id))
    .orderBy(asc(financeChargeLines.position), asc(financeChargeLines.id))
    .all();
  const adjustment = resolutionMode === "CURRENT"
    ? tx
      .select()
      .from(financeChargeAdjustments)
      .where(eq(financeChargeAdjustments.chargeId, charge.id))
      .get()
    : undefined;
  const payment = resolutionMode === "CURRENT"
    ? tx
      .select()
      .from(financePayments)
      .where(eq(financePayments.chargeId, charge.id))
      .get()
    : undefined;

  const grossTotalBaht = lines.reduce((total, line) => total + line.lineTotalBaht, 0);
  const consultationLines = lines.filter((line) => line.lineType === "CONSULTATION");
  const lineIntegrity = lines.length === charge.lineCount &&
    consultationLines.length === 1 &&
    lines.every((line, index) => (
      line.position === index &&
      assertSafeBaht(line.quantity, 1, 999_999) &&
      assertSafeBaht(line.unitPriceBaht, 0, 1_000_000) &&
      assertSafeBaht(line.lineTotalBaht, 0, 100_000_000) &&
      line.lineTotalBaht === line.quantity * line.unitPriceBaht
    ));
  if (!lineIntegrity || !assertSafeBaht(grossTotalBaht, 1, 100_000_000)) {
    throw incompleteChargeSource();
  }
  if (charge.contentHash !== chargeHash(hashHeader(charge), lines.map(hashLine))) {
    throw incompleteChargeSource();
  }
  const adjustmentTotalBaht = adjustment?.amountBaht ?? 0;
  const netDueBaht = grossTotalBaht + adjustmentTotalBaht;
  if (
    !assertSafeBaht(adjustmentTotalBaht, -100_000_000, 0) ||
    !assertSafeBaht(netDueBaht, 0, 100_000_000)
  ) {
    throw incompleteChargeSource();
  }
  if (
    adjustment && (
      adjustment.kind !== "FULL_WAIVER" ||
      adjustment.amountBaht !== -grossTotalBaht ||
      !isTrimmedText(adjustment.reason, 500) ||
      !isTrimmedText(adjustment.approvedByDisplayName, 200) ||
      adjustment.contentHash !== adjustmentHash(hashAdjustment(adjustment))
    )
  ) {
    throw incompleteChargeSource();
  }
  const promptPayReferenceIsValid = payment?.method === "PROMPTPAY" &&
    isTrimmedText(payment.manualReference, 100);
  if (
    payment && (
      payment.visitId !== charge.visitId ||
      !assertSafeBaht(payment.amountBaht, 1, 100_000_000) ||
      payment.amountBaht !== netDueBaht ||
      !isTrimmedText(payment.confirmedByDisplayName, 200) ||
      (payment.method === "CASH" && payment.manualReference !== null) ||
      (payment.method === "PROMPTPAY" && !promptPayReferenceIsValid) ||
      (payment.method !== "CASH" && payment.method !== "PROMPTPAY") ||
      payment.contentHash !== paymentHash(hashPayment(payment))
    )
  ) {
    throw incompleteChargeSource();
  }
  if (adjustment && payment) throw incompleteChargeSource();
  return { charge, lines, grossTotalBaht, adjustmentTotalBaht, netDueBaht, adjustment, payment };
}

function collectionState(
  visit: CheckoutDto["visit"],
  evidence: PersistedChargeEvidence,
): CheckoutDto["collectionState"] {
  if (visit.status === "CLOSED") return "CLOSED";
  if (evidence.adjustment) return "COLLECTION_NOT_REQUIRED";
  if (evidence.payment?.method === "CASH") return "PAID_CASH";
  if (evidence.payment?.method === "PROMPTPAY") return "PAID_PROMPTPAY";
  return "AWAITING_COLLECTION";
}

function allowedActions(
  actor: Actor,
  visit: CheckoutDto["visit"],
  evidence: PersistedChargeEvidence | undefined,
): CheckoutDto["allowedActions"] {
  if (!evidence && visit.status === "AWAITING_CHARGE" && hasPermission(actor, "finance:finalize-charge")) {
    return ["FINALIZE_CHARGE"];
  }
  if (
    evidence &&
    visit.status === "AWAITING_PAYMENT" &&
    !evidence.adjustment &&
    !evidence.payment
  ) {
    const actions: CheckoutDto["allowedActions"] = [];
    if (hasPermission(actor, "finance:waive")) actions.push("APPROVE_FULL_WAIVER");
    if (hasPermission(actor, "finance:record-cash")) actions.push("RECORD_CASH");
    if (hasPermission(actor, "finance:confirm-promptpay")) actions.push("CONFIRM_PROMPTPAY");
    return actions;
  }
  if (evidence && visit.status === "READY_TO_CLOSE" && hasPermission(actor, "visit:close")) {
    return ["CLOSE_VISIT"];
  }
  if (evidence && visit.status === "CLOSED" && hasPermission(actor, "opd:read")) {
    return ["READ_OPD"];
  }
  return [];
}

function closeBlockers(
  visit: CheckoutDto["visit"],
  evidence: PersistedChargeEvidence | undefined,
): CheckoutDto["closeBlockers"] {
  if (!evidence) return ["charge"];
  if (!evidence.adjustment && !evidence.payment) return ["collection"];
  if (visit.status !== "READY_TO_CLOSE" && visit.status !== "CLOSED") return ["visitState"];
  return [];
}

function resolutionFromEvidence(evidence: PersistedChargeEvidence): FinanceResolution {
  if (evidence.adjustment) {
    return { kind: "COLLECTION_NOT_REQUIRED", adjustmentId: evidence.adjustment.id };
  }
  if (evidence.payment) {
    return { kind: "PAYMENT", paymentId: evidence.payment.id, method: evidence.payment.method };
  }
  return {
    kind: "PENDING_COLLECTION",
    chargeId: evidence.charge.id,
    netDueBaht: evidence.netDueBaht,
  };
}

function checkoutFromEvidence(
  actor: Actor,
  context: CheckoutContext,
  evidence: PersistedChargeEvidence,
  pinnedProjection?: ChargeFinalizeReplayProjection,
  includeResolution = true,
): CheckoutDto {
  const projection = pinnedProjection ?? {
    adjustmentTotalBaht: evidence.adjustmentTotalBaht,
    netDueBaht: evidence.netDueBaht,
    collectionState: collectionState(context.visit, evidence),
    allowedActions: allowedActions(actor, context.visit, evidence),
    closeBlockers: closeBlockers(context.visit, evidence),
  };
  return {
    patient: {
      id: context.patient.id,
      hn: context.patient.hn,
      displayName: context.patient.displayName,
      birthDate: context.patient.birthDate,
      sex: context.patient.sex,
    },
    visit: {
      id: context.visit.id,
      status: context.visit.status,
      revision: context.visit.revision,
      arrivedAt: context.visit.arrivedAt,
      startedAt: context.visit.startedAt,
      closedAt: context.visit.closedAt,
    },
    sourceKind: evidence.charge.sourceKind,
    clinicPricingRevision: evidence.charge.clinicPricingRevision,
    charge: {
      id: evidence.charge.id,
      sourceKind: evidence.charge.sourceKind,
      medicationDecisionId: evidence.charge.medicationDecisionId,
      medicationDecisionVersion: evidence.charge.medicationDecisionVersion,
      fulfillmentDispenseId: evidence.charge.fulfillmentDispenseId,
      clinicPricingRevision: evidence.charge.clinicPricingRevision,
      consultationFeeBahtSnapshot: evidence.charge.consultationFeeBahtSnapshot,
      currency: evidence.charge.currency,
      lineCount: evidence.charge.lineCount,
      finalizedBy: {
        id: evidence.charge.finalizedBy,
        displayName: evidence.charge.finalizedByDisplayName,
      },
      finalizedAt: evidence.charge.finalizedAt,
    },
    lines: evidence.lines.map(persistedLineToCheckoutLine),
    grossTotalBaht: evidence.grossTotalBaht,
    adjustmentTotalBaht: projection.adjustmentTotalBaht,
    netDueBaht: projection.netDueBaht,
    collectionState: projection.collectionState,
    ...(includeResolution ? { resolution: resolutionFromEvidence(evidence) } : {}),
    allowedActions: projection.allowedActions,
    closeBlockers: projection.closeBlockers,
  };
}

function replayCheckoutFromEvidence(
  tx: FinanceReadTransaction,
  reference: ChargeFinalizeReplayReference,
): CheckoutDto {
  if (reference.resolution) {
    if (!reference.projection) {
      throw new Error("Idempotency waiver finalization reference requires a pinned projection");
    }
    return replayCollectionFromEvidence(tx, {
      chargeId: reference.chargeId,
      resolution: reference.resolution,
      patient: reference.patient,
      visit: reference.visit,
      projection: reference.projection,
      responseIncludesResolution: reference.responseIncludesResolution,
    });
  }
  const evidence = readChargeEvidence(tx, { chargeId: reference.chargeId }, "CHARGE_ONLY");
  if (!evidence || evidence.charge.visitId !== reference.visit.id) {
    throw new Error("Idempotency Charge reference does not match immutable evidence");
  }
  const projection = reference.projection ?? {
    adjustmentTotalBaht: 0,
    netDueBaht: evidence.grossTotalBaht,
    collectionState: "AWAITING_COLLECTION",
    allowedActions: [],
    closeBlockers: ["collection"],
  } satisfies ChargeFinalizeReplayProjection;
  // A replay uses reference-pinned visit/patient/projection fields and immutable
  // Charge/Line evidence rather than current master or later collection evidence.
  // The fallback keeps references written before projections replayable.
  return checkoutFromEvidence(
    { id: evidence.charge.finalizedBy, role: "doctor", displayName: evidence.charge.finalizedByDisplayName },
    { clinicId: evidence.charge.clinicId, patient: reference.patient, visit: reference.visit },
    evidence,
    projection,
    reference.responseIncludesResolution === true,
  );
}

function revisionConflict(visit: typeof visits.$inferSelect): ApiError {
  return new ApiError({
    code: "REVISION_CONFLICT",
    messageTh: "Visit ถูกเปลี่ยนแปลงแล้ว",
    currentRevisions: { visit: visit.revision },
  });
}

function assertPendingCollection(
  tx: AppTransaction,
  visitId: string,
  chargeId: string,
  expectedVisitRevision: number,
  operation: "WAIVER" | "PAYMENT",
): { visit: typeof visits.$inferSelect; evidence: PersistedChargeEvidence } {
  const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
  if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
  const evidence = readChargeEvidence(tx, { chargeId });
  if (!evidence || evidence.charge.visitId !== visitId) {
    if (operation === "WAIVER") throw waiverNotAllowed();
    throw financeNotReady();
  }
  if (evidence.adjustment || evidence.payment) {
    if (operation === "WAIVER") throw waiverNotAllowed();
    throw paymentAlreadyRecorded();
  }
  if (visit.status !== "AWAITING_PAYMENT") {
    if (operation === "WAIVER") throw waiverNotAllowed();
    throw financeNotReady();
  }
  if (visit.revision !== expectedVisitRevision) throw revisionConflict(visit);
  return { visit, evidence };
}

function transitionToReadyToClose(
  tx: AppTransaction,
  visit: typeof visits.$inferSelect,
  operation: "WAIVER" | "PAYMENT",
): void {
  const changed = tx.update(visits)
    .set({ status: "READY_TO_CLOSE", revision: visit.revision + 1 })
    .where(and(
      eq(visits.id, visit.id),
      eq(visits.status, "AWAITING_PAYMENT"),
      eq(visits.revision, visit.revision),
    ))
    .run();
  if (changed.changes === 1) return;
  const current = tx.select().from(visits).where(eq(visits.id, visit.id)).get();
  if (current && current.revision !== visit.revision) throw revisionConflict(current);
  if (operation === "WAIVER") throw waiverNotAllowed();
  throw paymentAlreadyRecorded();
}

function replayCollectionFromEvidence(
  tx: FinanceReadTransaction,
  reference: FinanceCollectionReplayReference,
): CheckoutDto {
  const evidence = readChargeEvidence(tx, { chargeId: reference.chargeId });
  if (!evidence || evidence.charge.visitId !== reference.visit.id) {
    throw new Error("Idempotency collection reference does not match immutable Charge evidence");
  }
  const expectedCollectionState = reference.resolution.kind === "COLLECTION_NOT_REQUIRED"
    ? "COLLECTION_NOT_REQUIRED"
    : reference.resolution.method === "CASH" ? "PAID_CASH" : "PAID_PROMPTPAY";
  if (
    reference.resolution.kind === "COLLECTION_NOT_REQUIRED"
      ? (!evidence.adjustment || evidence.adjustment.id !== reference.resolution.adjustmentId)
      : (!evidence.payment || evidence.payment.id !== reference.resolution.paymentId || evidence.payment.method !== reference.resolution.method)
  ) {
    throw new Error("Idempotency collection resolution does not match immutable evidence");
  }
  const validTerminalActions = reference.projection.allowedActions.length === 0 || (
    reference.projection.allowedActions.length === 1 &&
    reference.projection.allowedActions[0] === "CLOSE_VISIT"
  );
  if (
    reference.projection.adjustmentTotalBaht !== evidence.adjustmentTotalBaht ||
    reference.projection.netDueBaht !== evidence.netDueBaht ||
    reference.projection.collectionState !== expectedCollectionState ||
    !validTerminalActions ||
    reference.projection.closeBlockers.length !== 0
  ) {
    throw new Error("Idempotency collection projection does not match immutable evidence");
  }
  return checkoutFromEvidence(
    { id: evidence.charge.finalizedBy, role: "doctor", displayName: evidence.charge.finalizedByDisplayName },
    { clinicId: evidence.charge.clinicId, patient: reference.patient, visit: reference.visit },
    evidence,
    reference.projection,
    reference.responseIncludesResolution === true,
  );
}

function assertCurrentVisitForFinalization(
  tx: AppTransaction,
  visitId: string,
  expectedVisitRevision: number,
): typeof visits.$inferSelect {
  const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
  if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
  if (visit.status !== "AWAITING_CHARGE") throw financeNotReady();
  if (visit.revision !== expectedVisitRevision) {
    throw new ApiError({
      code: "REVISION_CONFLICT",
      messageTh: "Visit ถูกเปลี่ยนแปลงแล้ว",
      currentRevisions: { visit: visit.revision },
    });
  }
  return visit;
}

function assertPersistedFinalization(
  tx: AppTransaction,
  chargeId: string,
  expectedHash: string,
  expectedLineCount: number,
  expectedGrossTotalBaht: number,
): void {
  const evidence = readChargeEvidence(tx, { chargeId });
  if (
    !evidence ||
    evidence.charge.contentHash !== expectedHash ||
    evidence.lines.length !== expectedLineCount ||
    evidence.grossTotalBaht !== expectedGrossTotalBaht
  ) {
    throw new Error("Charge finalization did not persist complete immutable evidence");
  }
}

export function createFinanceService(input: FinanceServiceOptions): FinanceService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;

  function getCheckoutFromTransaction(actor: Actor, tx: FinanceReadTransaction, visitId: string): CheckoutDto {
    const context = readCheckoutContext(tx, visitId);
    const evidence = readChargeEvidence(tx, { visitId });
    if (evidence) return checkoutFromEvidence(actor, context, evidence);
    if (context.visit.status !== "AWAITING_CHARGE") throw incompleteChargeSource();
    const pricingRevision = readPricingRevision(tx, context.clinicId);
    const quote = input.pricing.deriveChargeQuote(
      tx as AppTransaction,
      visitId,
      pricingRevision,
    );
    return {
      patient: context.patient,
      visit: context.visit,
      sourceKind: quote.sourceKind,
      clinicPricingRevision: pricingRevision,
      charge: null,
      lines: quote.lines.map(quoteLineToCheckoutLine),
      grossTotalBaht: quote.grossTotalBaht,
      adjustmentTotalBaht: 0,
      netDueBaht: quote.grossTotalBaht,
      collectionState: "PENDING_CHARGE",
      resolution: { kind: "PENDING_CHARGE" },
      allowedActions: allowedActions(actor, context.visit, undefined),
      closeBlockers: ["charge"],
    };
  }

  function recordPayment(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: RecordCashCommand | ConfirmPromptPayCommand,
    method: "CASH" | "PROMPTPAY",
  ): CheckoutDto {
    const chargeId = normalizeChargeId(command.chargeId);
    assertPaymentAmount(command.amountBaht);
    const manualReference = method === "PROMPTPAY"
      ? normalizeRequiredText(
        (command as ConfirmPromptPayCommand).manualReference,
        100,
        "payload.manualReference",
      )
      : null;
    const { visit, evidence } = assertPendingCollection(
      tx,
      visitId,
      chargeId,
      command.expectedVisitRevision,
      "PAYMENT",
    );
    if (command.amountBaht !== evidence.netDueBaht) throw paymentAmountMismatch();

    const payment: PaymentHashPayload = {
      id: idFactory(),
      chargeId: evidence.charge.id,
      visitId: visit.id,
      method,
      amountBaht: command.amountBaht,
      manualReference,
      confirmedBy: actor.id,
      confirmedByDisplayName: actor.displayName,
      confirmedAt: clock().toISOString(),
    };
    tx.insert(financePayments).values({ ...payment, contentHash: paymentHash(payment) }).run();
    transitionToReadyToClose(tx, visit, "PAYMENT");
    return getCheckoutFromTransaction(actor, tx, visitId);
  }

  return {
    getCheckout(actor, visitId) {
      requirePermission(actor, "finance:read");
      return getCheckoutFromTransaction(actor, input.database.db, visitId);
    },

    finalizeCharge(tx, actor, visitId, command) {
      requirePermission(actor, "finance:finalize-charge");
      const waiverReason = command.payload.settlementIntent === "FULL_WAIVER"
        ? normalizeRequiredText(command.payload.waiverReason, 500, "payload.waiverReason")
        : undefined;
      const existing = tx
        .select({ id: financeCharges.id })
        .from(financeCharges)
        .where(eq(financeCharges.visitId, visitId))
        .get();
      if (existing) throw chargeAlreadyFinalized();

      const visit = assertCurrentVisitForFinalization(tx, visitId, command.expectedRevisions.visit);
      const quote = input.pricing.deriveChargeQuote(
        tx,
        visitId,
        command.expectedRevisions.clinicPricing,
      );
      if (
        quote.visitRevision !== visit.revision ||
        quote.clinicId !== visit.clinicId ||
        quote.lines.length < 1 ||
        quote.lines.length > 21 ||
        !assertSafeBaht(quote.grossTotalBaht, 1, 100_000_000)
      ) {
        throw incompleteChargeSource();
      }

      const chargeId = idFactory();
      const finalizedAt = clock().toISOString();
      const lines = quote.lines.map((line) => ({ ...line, id: idFactory() }));
      const header: ChargeHashPayload = {
        id: chargeId,
        clinicId: quote.clinicId,
        visitId: quote.visitId,
        sourceKind: quote.sourceKind,
        medicationDecisionId: quote.medicationDecisionId,
        medicationDecisionVersion: quote.medicationDecisionVersion,
        fulfillmentDispenseId: quote.fulfillmentDispenseId,
        clinicPricingRevision: quote.clinicPricingRevision,
        consultationFeeBahtSnapshot: quote.consultationFeeBahtSnapshot,
        currency: quote.currency,
        lineCount: lines.length,
        finalizedBy: actor.id,
        finalizedByDisplayName: actor.displayName,
        finalizedAt,
      };
      const contentHash = chargeHash(header, lines.map(hashLine));

      tx.insert(financeCharges).values({ ...header, contentHash }).run();
      for (const line of lines) {
        tx.insert(financeChargeLines).values({
          id: line.id,
          chargeId,
          position: line.position,
          lineType: line.lineType,
          descriptionSnapshot: line.descriptionSnapshot,
          quantity: line.quantity,
          unitPriceBaht: line.unitPriceBaht,
          lineTotalBaht: line.lineTotalBaht,
          medicationOrderItemId: line.medicationOrderItemId,
          fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
        }).run();
      }
      assertPersistedFinalization(tx, chargeId, contentHash, lines.length, quote.grossTotalBaht);

      if (waiverReason !== undefined) {
        const adjustment: AdjustmentHashPayload = {
          id: idFactory(),
          chargeId,
          kind: "FULL_WAIVER",
          amountBaht: -quote.grossTotalBaht,
          reason: waiverReason,
          approvedBy: actor.id,
          approvedByDisplayName: actor.displayName,
          approvedAt: clock().toISOString(),
        };
        tx.insert(financeChargeAdjustments)
          .values({ ...adjustment, contentHash: adjustmentHash(adjustment) })
          .run();
        const evidence = readChargeEvidence(tx, { chargeId });
        if (
          !evidence?.adjustment ||
          evidence.adjustment.id !== adjustment.id ||
          evidence.adjustment.amountBaht !== -quote.grossTotalBaht
        ) {
          throw new Error("Charge full waiver did not persist complete immutable evidence");
        }
      }

      const nextStatus = waiverReason === undefined ? "AWAITING_PAYMENT" : "READY_TO_CLOSE";
      const changed = tx.update(visits)
        .set({ status: nextStatus, revision: visit.revision + 1 })
        .where(and(
          eq(visits.id, visit.id),
          eq(visits.status, "AWAITING_CHARGE"),
          eq(visits.revision, visit.revision),
        ))
        .run();
      if (changed.changes !== 1) {
        const current = tx.select({ revision: visits.revision, status: visits.status })
          .from(visits).where(eq(visits.id, visit.id)).get();
        if (current?.revision !== undefined) {
          throw new ApiError({
            code: "REVISION_CONFLICT",
            messageTh: "Visit ถูกเปลี่ยนแปลงแล้ว",
            currentRevisions: { visit: current.revision },
          });
        }
        throw financeNotReady();
      }
      return getCheckoutFromTransaction(actor, tx, visitId);
    },

    approveFullWaiver(tx, actor, visitId, command) {
      requirePermission(actor, "finance:waive");
      const chargeId = normalizeChargeId(command.chargeId);
      const reason = normalizeRequiredText(command.reason, 500, "payload.reason");
      const { visit, evidence } = assertPendingCollection(
        tx,
        visitId,
        chargeId,
        command.expectedVisitRevision,
        "WAIVER",
      );
      const adjustment: AdjustmentHashPayload = {
        id: idFactory(),
        chargeId: evidence.charge.id,
        kind: "FULL_WAIVER",
        amountBaht: -evidence.grossTotalBaht,
        reason,
        approvedBy: actor.id,
        approvedByDisplayName: actor.displayName,
        approvedAt: clock().toISOString(),
      };
      tx.insert(financeChargeAdjustments)
        .values({ ...adjustment, contentHash: adjustmentHash(adjustment) })
        .run();
      transitionToReadyToClose(tx, visit, "WAIVER");
      return getCheckoutFromTransaction(actor, tx, visitId);
    },

    recordCash(tx, actor, visitId, command) {
      requirePermission(actor, "finance:record-cash");
      return recordPayment(tx, actor, visitId, command, "CASH");
    },

    confirmPromptPay(tx, actor, visitId, command) {
      requirePermission(actor, "finance:confirm-promptpay");
      return recordPayment(tx, actor, visitId, command, "PROMPTPAY");
    },

    readResolution(tx, visitId) {
      const evidence = readChargeEvidence(tx, { visitId });
      if (!evidence) return { kind: "PENDING_CHARGE" };
      if (evidence.adjustment) {
        return { kind: "COLLECTION_NOT_REQUIRED", adjustmentId: evidence.adjustment.id };
      }
      if (evidence.payment) {
        return { kind: "PAYMENT", paymentId: evidence.payment.id, method: evidence.payment.method };
      }
      return {
        kind: "PENDING_COLLECTION",
        chargeId: evidence.charge.id,
        netDueBaht: evidence.netDueBaht,
      };
    },

    getCloseEvidence(tx, visitId) {
      return readChargeEvidence(tx, { visitId }) ?? null;
    },

    rebuildFinalization(tx, reference) {
      return replayCheckoutFromEvidence(tx, reference);
    },

    rebuildCollection(tx, reference) {
      return replayCollectionFromEvidence(tx, reference);
    },
  };
}
