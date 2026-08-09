import { asc, eq } from "drizzle-orm";
import type { PriceSnapshot as ContractPriceSnapshot } from "../../../shared/contracts.js";
import type { AppTransaction } from "../platform/index.js";
import { fulfillmentDispenseLines, fulfillmentDispenses } from "../fulfillment/schema.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import {
  fulfillmentDispensePriceSnapshots,
  medicationOrderPriceSnapshots,
} from "./schema.js";

export type PriceSnapshot = ContractPriceSnapshot;

function assertBahtPrice(value: number, context: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new Error(`${context} must be a safe integer Baht price`);
  }
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
