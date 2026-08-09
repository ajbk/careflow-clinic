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
  readResolution(tx: AppTransaction, visitId: string): FinanceResolution;
  /** Rebuilds a safe idempotency replay from immutable Charge evidence only. */
  rebuildFinalization(tx: AppTransaction, reference: ChargeFinalizeReplayReference): CheckoutDto;
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
}

export interface ChargeFinalizeReplayProjection {
  adjustmentTotalBaht: CheckoutDto["adjustmentTotalBaht"];
  netDueBaht: CheckoutDto["netDueBaht"];
  collectionState: CheckoutDto["collectionState"];
  allowedActions: CheckoutDto["allowedActions"];
  closeBlockers: CheckoutDto["closeBlockers"];
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

function assertSafeBaht(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
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
  hasCharge: boolean,
): CheckoutDto["allowedActions"] {
  if (!hasCharge && visit.status === "AWAITING_CHARGE" && hasPermission(actor, "finance:finalize-charge")) {
    return ["FINALIZE_CHARGE"];
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

function checkoutFromEvidence(
  actor: Actor,
  context: CheckoutContext,
  evidence: PersistedChargeEvidence,
  pinnedProjection?: ChargeFinalizeReplayProjection,
): CheckoutDto {
  const projection = pinnedProjection ?? {
    adjustmentTotalBaht: evidence.adjustmentTotalBaht,
    netDueBaht: evidence.netDueBaht,
    collectionState: collectionState(context.visit, evidence),
    allowedActions: allowedActions(actor, context.visit, true),
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
      contentHash: evidence.charge.contentHash,
    },
    lines: evidence.lines.map(persistedLineToCheckoutLine),
    grossTotalBaht: evidence.grossTotalBaht,
    adjustmentTotalBaht: projection.adjustmentTotalBaht,
    netDueBaht: projection.netDueBaht,
    collectionState: projection.collectionState,
    allowedActions: projection.allowedActions,
    closeBlockers: projection.closeBlockers,
  };
}

function replayCheckoutFromEvidence(
  tx: FinanceReadTransaction,
  reference: ChargeFinalizeReplayReference,
): CheckoutDto {
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
  // A replay is the original post-finalization response. Use reference-pinned
  // visit/patient/projection fields and immutable Charge/Lines rather than
  // current master or later collection evidence. The fallback is the only
  // Task 2 finalization outcome and keeps pre-projection references replayable.
  return checkoutFromEvidence(
    { id: evidence.charge.finalizedBy, role: "doctor", displayName: evidence.charge.finalizedByDisplayName },
    { clinicId: evidence.charge.clinicId, patient: reference.patient, visit: reference.visit },
    evidence,
    projection,
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
      charge: null,
      lines: quote.lines.map(quoteLineToCheckoutLine),
      grossTotalBaht: quote.grossTotalBaht,
      adjustmentTotalBaht: 0,
      netDueBaht: quote.grossTotalBaht,
      collectionState: "PENDING_CHARGE",
      allowedActions: allowedActions(actor, context.visit, false),
      closeBlockers: ["charge"],
    };
  }

  return {
    getCheckout(actor, visitId) {
      requirePermission(actor, "finance:read");
      return getCheckoutFromTransaction(actor, input.database.db, visitId);
    },

    finalizeCharge(tx, actor, visitId, command) {
      requirePermission(actor, "finance:finalize-charge");
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

      const changed = tx.update(visits)
        .set({ status: "AWAITING_PAYMENT", revision: visit.revision + 1 })
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

    rebuildFinalization(tx, reference) {
      return replayCheckoutFromEvidence(tx, reference);
    },
  };
}
