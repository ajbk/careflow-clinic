import { and, asc, desc, eq } from "drizzle-orm";
import type { PriceSnapshot as ContractPriceSnapshot } from "../../../shared/contracts.js";
import { ApiError } from "../../errors.js";
import { clinicalNotes } from "../note/schema.js";
import { clinicConfig } from "../platform/schema.js";
import type { AppDatabase, AppTransaction } from "../platform/index.js";
import { visits } from "../visit/schema.js";
import { fulfillmentDispenseLines, fulfillmentDispenses } from "../fulfillment/schema.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import {
  fulfillmentDispensePriceSnapshots,
  medicationOrderPriceSnapshots,
} from "./schema.js";

export type PriceSnapshot = ContractPriceSnapshot;

type FinanceReadTransaction = AppDatabase | AppTransaction;

export interface ChargeQuoteLine {
  position: number;
  lineType: "CONSULTATION" | "MEDICATION";
  descriptionSnapshot: string;
  quantity: number;
  unitPriceBaht: number;
  lineTotalBaht: number;
  medicationOrderItemId: string | null;
  fulfillmentDispenseLineId: string | null;
}

/**
 * Server-derived, pre-finalization representation. It intentionally contains
 * no client supplied money values and is rebuilt under the caller's immediate
 * transaction before a Charge is written.
 */
export interface ChargeQuote {
  clinicId: string;
  visitId: string;
  visitRevision: number;
  sourceKind: "ORDER" | "NO_MEDICATION";
  medicationDecisionId: string;
  medicationDecisionVersion: number;
  fulfillmentDispenseId: string | null;
  clinicPricingRevision: number;
  consultationFeeBahtSnapshot: number;
  currency: "THB";
  lines: ChargeQuoteLine[];
  grossTotalBaht: number;
}

function assertBahtPrice(value: number, context: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${context} must be a safe integer Baht price`);
  }
}

function financeNotReady(): ApiError {
  return new ApiError({
    code: "FINANCE_NOT_READY",
    messageTh: "Visit นี้ยังไม่พร้อมสำหรับการคิดเงิน",
  });
}

function incompleteSource(): ApiError {
  return new ApiError({
    code: "CHARGE_SOURCE_INCOMPLETE",
    messageTh: "หลักฐานสำหรับการคิดเงินยังไม่ครบถ้วน",
  });
}

function missingPriceSnapshot(): ApiError {
  return new ApiError({
    code: "PRICE_SNAPSHOT_MISSING",
    messageTh: "ไม่พบราคายาที่ผูกกับการส่งมอบ",
  });
}

function assertQuoteInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

/**
 * Builds the only permissible Charge preview from signed/current source
 * evidence. This is also used by finalization, where its caller owns the
 * audited BEGIN IMMEDIATE transaction.
 */
export function deriveChargeQuote(
  tx: FinanceReadTransaction,
  visitId: string,
  expectedClinicPricingRevision: number,
): ChargeQuote {
  const visitRow = tx
    .select({
      id: visits.id,
      clinicId: visits.clinicId,
      status: visits.status,
      revision: visits.revision,
      consultationFeeBaht: clinicConfig.consultationFeeBaht,
      clinicPricingRevision: clinicConfig.pricingRevision,
    })
    .from(visits)
    .innerJoin(clinicConfig, eq(clinicConfig.id, visits.clinicId))
    .where(eq(visits.id, visitId))
    .get();
  if (!visitRow) {
    throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
  }
  if (visitRow.status !== "AWAITING_CHARGE") throw financeNotReady();
  if (visitRow.clinicPricingRevision !== expectedClinicPricingRevision) {
    throw new ApiError({
      code: "REVISION_CONFLICT",
      messageTh: "ข้อมูลราคาคลินิกถูกเปลี่ยนแล้ว",
      currentRevisions: { clinicPricing: visitRow.clinicPricingRevision },
    });
  }
  if (!assertQuoteInteger(visitRow.consultationFeeBaht, 1, 1_000_000)) {
    throw incompleteSource();
  }

  const note = tx
    .select({ id: clinicalNotes.id })
    .from(clinicalNotes)
    .where(eq(clinicalNotes.visitId, visitId))
    .get();
  if (!note) throw incompleteSource();

  const decision = tx
    .select()
    .from(medicationDecisions)
    .where(eq(medicationDecisions.visitId, visitId))
    .orderBy(desc(medicationDecisions.version), desc(medicationDecisions.id))
    .get();
  if (!decision) throw incompleteSource();

  const consultationLine: ChargeQuoteLine = {
    position: 0,
    lineType: "CONSULTATION",
    descriptionSnapshot: "ค่าตรวจ",
    quantity: 1,
    unitPriceBaht: visitRow.consultationFeeBaht,
    lineTotalBaht: visitRow.consultationFeeBaht,
    medicationOrderItemId: null,
    fulfillmentDispenseLineId: null,
  };

  const base = {
    clinicId: visitRow.clinicId,
    visitId: visitRow.id,
    visitRevision: visitRow.revision,
    medicationDecisionId: decision.id,
    medicationDecisionVersion: decision.version,
    clinicPricingRevision: visitRow.clinicPricingRevision,
    consultationFeeBahtSnapshot: visitRow.consultationFeeBaht,
    currency: "THB" as const,
  };

  if (decision.kind === "NO_MEDICATION") {
    const dispense = tx
      .select({ id: fulfillmentDispenses.id })
      .from(fulfillmentDispenses)
      .where(eq(fulfillmentDispenses.visitId, visitId))
      .get();
    if (dispense) throw incompleteSource();
    return {
      ...base,
      sourceKind: "NO_MEDICATION",
      fulfillmentDispenseId: null,
      lines: [consultationLine],
      grossTotalBaht: consultationLine.lineTotalBaht,
    };
  }

  const dispense = tx
    .select()
    .from(fulfillmentDispenses)
    .where(and(
      eq(fulfillmentDispenses.visitId, visitId),
      eq(fulfillmentDispenses.clinicId, visitRow.clinicId),
      eq(fulfillmentDispenses.medicationDecisionId, decision.id),
      eq(fulfillmentDispenses.medicationDecisionVersion, decision.version),
    ))
    .get();
  if (!dispense) throw incompleteSource();

  const dispenseLines = tx
    .select({
      id: fulfillmentDispenseLines.id,
      medicationOrderItemId: fulfillmentDispenseLines.medicationOrderItemId,
      medicationId: fulfillmentDispenseLines.medicationId,
      quantity: fulfillmentDispenseLines.quantity,
      descriptionSnapshot: fulfillmentDispenseLines.displayNameSnapshot,
      priceSnapshot: {
        medicationId: fulfillmentDispensePriceSnapshots.medicationId,
        unitPriceBaht: fulfillmentDispensePriceSnapshots.unitPriceBahtSnapshot,
        currency: fulfillmentDispensePriceSnapshots.currency,
      },
    })
    .from(fulfillmentDispenseLines)
    .leftJoin(
      fulfillmentDispensePriceSnapshots,
      eq(fulfillmentDispensePriceSnapshots.fulfillmentDispenseLineId, fulfillmentDispenseLines.id),
    )
    .where(eq(fulfillmentDispenseLines.dispenseId, dispense.id))
    .orderBy(asc(fulfillmentDispenseLines.id))
    .all();
  if (dispenseLines.length === 0) throw incompleteSource();

  const medicationLines: ChargeQuoteLine[] = dispenseLines.map((line, index) => {
    const price = line.priceSnapshot;
    if (
      !price ||
      price.medicationId !== line.medicationId ||
      price.currency !== "THB" ||
      !assertQuoteInteger(price.unitPriceBaht, 0, 1_000_000) ||
      !assertQuoteInteger(line.quantity, 1, 999_999)
    ) {
      throw missingPriceSnapshot();
    }
    const lineTotalBaht = line.quantity * price.unitPriceBaht;
    if (!assertQuoteInteger(lineTotalBaht, 0, 100_000_000)) throw incompleteSource();
    return {
      position: index + 1,
      lineType: "MEDICATION",
      descriptionSnapshot: line.descriptionSnapshot,
      quantity: line.quantity,
      unitPriceBaht: price.unitPriceBaht,
      lineTotalBaht,
      medicationOrderItemId: line.medicationOrderItemId,
      fulfillmentDispenseLineId: line.id,
    };
  });
  const lines = [consultationLine, ...medicationLines];
  const grossTotalBaht = lines.reduce((total, line) => total + line.lineTotalBaht, 0);
  if (lines.length > 21 || !assertQuoteInteger(grossTotalBaht, 1, 100_000_000)) {
    throw incompleteSource();
  }

  return {
    ...base,
    sourceKind: "ORDER",
    fulfillmentDispenseId: dispense.id,
    lines,
    grossTotalBaht,
  };
}

export function snapshotOrderPrices(tx: AppTransaction, medicationDecisionId: string): void {
  const items = tx
    .select({
      orderItemId: medicationOrderItems.id,
      medicationId: medicationOrderItems.medicationId,
      medicationRevision: medicationOrderItems.medicationRevision,
      signedAt: medicationDecisions.signedAt,
      masterMedicationRevision: medications.revision,
      masterUnitPriceBaht: medications.unitPriceBaht,
    })
    .from(medicationOrderItems)
    .innerJoin(medicationDecisions, eq(medicationDecisions.id, medicationOrderItems.medicationDecisionId))
    .innerJoin(medications, eq(medications.id, medicationOrderItems.medicationId))
    .where(eq(medicationOrderItems.medicationDecisionId, medicationDecisionId))
    .orderBy(asc(medicationOrderItems.position), asc(medicationOrderItems.id))
    .all();

  for (const item of items) {
    if (item.medicationRevision !== item.masterMedicationRevision) {
      throw new Error("Medication price snapshot source revision is stale");
    }
    assertBahtPrice(item.masterUnitPriceBaht, "Medication price snapshot source");
    tx.insert(medicationOrderPriceSnapshots).values({
      id: `price-order-${item.orderItemId}`,
      medicationOrderItemId: item.orderItemId,
      medicationId: item.medicationId,
      medicationRevision: item.medicationRevision,
      unitPriceBahtSnapshot: item.masterUnitPriceBaht,
      currency: "THB",
      capturedAt: item.signedAt,
    }).run();
  }
}

export function snapshotDispensePrices(tx: AppTransaction, dispenseId: string): void {
  const lines = tx
    .select({
      dispenseLineId: fulfillmentDispenseLines.id,
      medicationOrderItemId: fulfillmentDispenseLines.medicationOrderItemId,
      medicationId: fulfillmentDispenseLines.medicationId,
      handedOffAt: fulfillmentDispenses.handedOffAt,
    })
    .from(fulfillmentDispenseLines)
    .innerJoin(fulfillmentDispenses, eq(fulfillmentDispenses.id, fulfillmentDispenseLines.dispenseId))
    .where(eq(fulfillmentDispenseLines.dispenseId, dispenseId))
    .orderBy(asc(fulfillmentDispenseLines.id))
    .all();

  for (const line of lines) {
    const orderSnapshot = tx
      .select()
      .from(medicationOrderPriceSnapshots)
      .where(eq(medicationOrderPriceSnapshots.medicationOrderItemId, line.medicationOrderItemId))
      .get();
    if (!orderSnapshot) throw new Error("Dispense price snapshot requires an order price snapshot");
    if (orderSnapshot.medicationId !== line.medicationId) {
      throw new Error("Dispense price snapshot medication does not match its order snapshot");
    }
    assertBahtPrice(orderSnapshot.unitPriceBahtSnapshot, "Dispense price snapshot source");
    tx.insert(fulfillmentDispensePriceSnapshots).values({
      id: `price-dispense-${line.dispenseLineId}`,
      fulfillmentDispenseLineId: line.dispenseLineId,
      orderPriceSnapshotId: orderSnapshot.id,
      medicationId: line.medicationId,
      unitPriceBahtSnapshot: orderSnapshot.unitPriceBahtSnapshot,
      currency: "THB",
      capturedAt: line.handedOffAt,
    }).run();
  }
}
