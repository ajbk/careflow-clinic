import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  approveFullWaiverBodySchema,
  checkoutChargeSchema,
  checkoutDtoSchema,
  confirmPromptPayBodySchema,
  finalizeChargeBodySchema,
  recordCashBodySchema,
  type CheckoutDto,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { appendAuditEvent, executeIdempotent, type AuditedTransaction } from "../platform/index.js";
import type {
  ChargeFinalizeReplayReference,
  CheckoutReplayDto,
  CheckoutReplayShape,
  FinanceCollectionReplayReference,
  FinanceService,
  HistoricalCheckoutDto,
} from "./service.js";
import { financeChargeAdjustments, financePayments } from "./schema.js";

function requestVisitId(request: { params: unknown }): string {
  return (request.params as { visitId?: string }).visitId ?? "";
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string {
  return typeof request.headers["idempotency-key"] === "string"
    ? request.headers["idempotency-key"]
    : "";
}

function collectionReplayReference(
  finance: FinanceService,
  tx: AuditedTransaction,
  visitId: string,
  data: CheckoutDto,
  responseShape: CheckoutReplayShape = "HASH_FREE_V2",
): FinanceCollectionReplayReference {
  if (!data.charge) throw new Error("Collection replay reference requires a Charge");
  const resolution = finance.readResolution(tx, visitId);
  if (resolution.kind !== "COLLECTION_NOT_REQUIRED" && resolution.kind !== "PAYMENT") {
    throw new Error("Collection command did not return terminal resolution evidence");
  }
  return {
    chargeId: data.charge.id,
    resolution,
    patient: data.patient,
    visit: data.visit,
    responseShape,
    responseIncludesResolution: Object.prototype.hasOwnProperty.call(data, "resolution"),
    projection: {
      adjustmentTotalBaht: data.adjustmentTotalBaht,
      netDueBaht: data.netDueBaht,
      collectionState: data.collectionState,
      allowedActions: [...data.allowedActions],
      closeBlockers: [...data.closeBlockers],
    },
  };
}

const historicalCheckoutDtoSchema = checkoutDtoSchema
  .omit({ resolution: true })
  .extend({
    charge: checkoutChargeSchema.extend({
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    }).nullable(),
  });

function isHistoricalCheckoutResponse(data: unknown): data is HistoricalCheckoutDto {
  return historicalCheckoutDtoSchema.safeParse(data).success;
}

export function registerFinanceRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  finance: FinanceService;
}): void {
  input.app.get("/api/checkout/:visitId", async (request) => {
    const actor = requireActor(request, "finance:read");
    return { data: input.finance.getCheckout(actor, requestVisitId(request)) };
  });

  input.app.post("/api/checkout/:visitId/charge-finalizations", async (request, reply) => {
    // Authorization intentionally precedes body parsing and any source reads.
    const actor = requireActor(request, "finance:finalize-charge");
    const command = finalizeChargeBodySchema.parse(request.body);
    const visitId = requestVisitId(request);
    const key = idempotencyKey(request);
    let finalizationResolution: ChargeFinalizeReplayReference["resolution"];
    const result = executeIdempotent<CheckoutReplayDto, ChargeFinalizeReplayReference>({
      db: input.database.db,
      actor,
      key,
      operation: "finance.finalize-charge.v1",
      scope: visitId,
      requestBody: command,
      work: (tx) => {
        const data = input.finance.finalizeCharge(tx, actor, visitId, command);
        if (!data.charge) throw new Error("Charge finalization did not return immutable Charge evidence");
        let waiverAdjustment: typeof financeChargeAdjustments.$inferSelect | undefined;
        if (command.payload.settlementIntent === "FULL_WAIVER") {
          const resolution = input.finance.readResolution(tx, visitId);
          if (resolution.kind !== "COLLECTION_NOT_REQUIRED") {
            throw new Error("Full-waiver finalization did not return immutable Adjustment evidence");
          }
          waiverAdjustment = tx.select()
            .from(financeChargeAdjustments)
            .where(eq(financeChargeAdjustments.id, resolution.adjustmentId))
            .get();
          if (!waiverAdjustment || waiverAdjustment.chargeId !== data.charge.id) {
            throw new Error("Full-waiver finalization did not persist Adjustment evidence");
          }
          finalizationResolution = resolution;
        }
        appendAuditEvent({
          tx,
          actor,
          id: `audit:charge.finalized:${data.charge.id}:${key}`,
          action: "charge.finalized",
          entityType: "finance_charge",
          entityId: data.charge.id,
          entityRevision: data.visit.revision,
          reason: null,
          occurredAt: data.charge.finalizedAt,
          metadata: {
            visitId,
            medicationDecisionId: data.charge.medicationDecisionId,
            medicationDecisionVersion: data.charge.medicationDecisionVersion,
            fulfillmentDispenseId: data.charge.fulfillmentDispenseId,
            clinicPricingRevision: data.charge.clinicPricingRevision,
            lineIds: data.lines.map((line) => line.id),
            grossTotalBaht: data.grossTotalBaht,
            previousStatus: "AWAITING_CHARGE",
            nextStatus: command.payload.settlementIntent === "FULL_WAIVER"
              ? "READY_TO_CLOSE"
              : "AWAITING_PAYMENT",
          },
        });
        if (waiverAdjustment) {
          appendAuditEvent({
            tx,
            actor,
            id: `audit:charge.waiver-approved:${waiverAdjustment.id}:${key}`,
            action: "charge.waiver-approved",
            entityType: "finance_charge_adjustment",
            entityId: waiverAdjustment.id,
            entityRevision: data.visit.revision,
            reason: waiverAdjustment.reason,
            occurredAt: waiverAdjustment.approvedAt,
            metadata: {
              chargeId: data.charge.id,
              grossTotalBaht: data.grossTotalBaht,
              adjustmentAmountBaht: waiverAdjustment.amountBaht,
            },
          });
        }
        return { statusCode: 201, data };
      },
      safeReplay: {
        store(data, tx) {
          if (!data.charge) throw new Error("Charge replay reference requires a Charge");
          const responseShape = isHistoricalCheckoutResponse(data)
            ? "LEGACY_HASHED_V1"
            : "HASH_FREE_V2";
          const persistedResolution = finalizationResolution ?? (
            responseShape === "LEGACY_HASHED_V1" && data.collectionState === "COLLECTION_NOT_REQUIRED"
              ? input.finance.readResolution(tx, visitId)
              : undefined
          );
          return {
            chargeId: data.charge.id,
            patient: data.patient,
            visit: data.visit,
            responseShape,
            responseIncludesResolution: Object.prototype.hasOwnProperty.call(data, "resolution"),
            projection: {
              adjustmentTotalBaht: data.adjustmentTotalBaht,
              netDueBaht: data.netDueBaht,
              collectionState: data.collectionState,
              allowedActions: [...data.allowedActions],
              closeBlockers: [...data.closeBlockers],
            },
            ...(persistedResolution?.kind === "COLLECTION_NOT_REQUIRED"
              ? { resolution: persistedResolution }
              : {}),
          };
        },
        rebuild(tx, reference) {
          return input.finance.rebuildFinalization(tx, reference);
        },
        isLegacyResponse: isHistoricalCheckoutResponse,
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.post("/api/checkout/:visitId/waivers", async (request, reply) => {
    const actor = requireActor(request, "finance:waive");
    const command = approveFullWaiverBodySchema.parse(request.body);
    const visitId = requestVisitId(request);
    const key = idempotencyKey(request);
    let reference: FinanceCollectionReplayReference | undefined;
    const result = executeIdempotent<CheckoutReplayDto, FinanceCollectionReplayReference>({
      db: input.database.db,
      actor,
      key,
      operation: "finance.approve-waiver.v1",
      scope: visitId,
      requestBody: command,
      work: (tx) => {
        const data = input.finance.approveFullWaiver(tx, actor, visitId, {
          chargeId: command.payload.chargeId,
          reason: command.payload.reason,
          expectedVisitRevision: command.expectedRevisions.visit,
        });
        reference = collectionReplayReference(input.finance, tx, visitId, data);
        if (!data.charge || reference.resolution.kind !== "COLLECTION_NOT_REQUIRED") {
          throw new Error("Waiver command did not return immutable Adjustment evidence");
        }
        const adjustment = tx.select()
          .from(financeChargeAdjustments)
          .where(eq(financeChargeAdjustments.id, reference.resolution.adjustmentId))
          .get();
        if (!adjustment) throw new Error("Waiver command did not persist Adjustment evidence");
        appendAuditEvent({
          tx,
          actor,
          id: `audit:charge.waiver-approved:${adjustment.id}:${key}`,
          action: "charge.waiver-approved",
          entityType: "finance_charge_adjustment",
          entityId: adjustment.id,
          entityRevision: data.visit.revision,
          reason: adjustment.reason,
          occurredAt: adjustment.approvedAt,
          metadata: {
            chargeId: data.charge.id,
            grossTotalBaht: data.grossTotalBaht,
            adjustmentAmountBaht: adjustment.amountBaht,
          },
        });
        return { statusCode: 201, data };
      },
      safeReplay: {
        store(data, tx) {
          if (reference) return { ...reference, responseShape: "HASH_FREE_V2" };
          if (!isHistoricalCheckoutResponse(data)) throw new Error("Waiver replay reference was not created");
          return collectionReplayReference(input.finance, tx, visitId, data, "LEGACY_HASHED_V1");
        },
        rebuild(tx, storedReference) {
          return input.finance.rebuildCollection(tx, storedReference);
        },
        isLegacyResponse: isHistoricalCheckoutResponse,
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.post("/api/checkout/:visitId/payments/cash", async (request, reply) => {
    const actor = requireActor(request, "finance:record-cash");
    const command = recordCashBodySchema.parse(request.body);
    const visitId = requestVisitId(request);
    const key = idempotencyKey(request);
    let reference: FinanceCollectionReplayReference | undefined;
    const result = executeIdempotent<CheckoutReplayDto, FinanceCollectionReplayReference>({
      db: input.database.db,
      actor,
      key,
      operation: "finance.record-cash.v1",
      scope: visitId,
      requestBody: command,
      work: (tx) => {
        const data = input.finance.recordCash(tx, actor, visitId, {
          chargeId: command.payload.chargeId,
          amountBaht: command.payload.amountBaht,
          expectedVisitRevision: command.expectedRevisions.visit,
        });
        reference = collectionReplayReference(input.finance, tx, visitId, data);
        if (!data.charge || reference.resolution.kind !== "PAYMENT" || reference.resolution.method !== "CASH") {
          throw new Error("Cash command did not return immutable Payment evidence");
        }
        const payment = tx.select()
          .from(financePayments)
          .where(eq(financePayments.id, reference.resolution.paymentId))
          .get();
        if (!payment || payment.manualReference !== null) {
          throw new Error("Cash command did not persist a Cash Payment");
        }
        appendAuditEvent({
          tx,
          actor,
          id: `audit:payment.cash-recorded:${payment.id}:${key}`,
          action: "payment.cash-recorded",
          entityType: "finance_payment",
          entityId: payment.id,
          entityRevision: data.visit.revision,
          reason: null,
          occurredAt: payment.confirmedAt,
          metadata: {
            chargeId: data.charge.id,
            paymentId: payment.id,
            amountBaht: payment.amountBaht,
          },
        });
        return { statusCode: 201, data };
      },
      safeReplay: {
        store(data, tx) {
          if (reference) return { ...reference, responseShape: "HASH_FREE_V2" };
          if (!isHistoricalCheckoutResponse(data)) throw new Error("Cash replay reference was not created");
          return collectionReplayReference(input.finance, tx, visitId, data, "LEGACY_HASHED_V1");
        },
        rebuild(tx, storedReference) {
          return input.finance.rebuildCollection(tx, storedReference);
        },
        isLegacyResponse: isHistoricalCheckoutResponse,
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.post("/api/checkout/:visitId/payments/promptpay", async (request, reply) => {
    const actor = requireActor(request, "finance:confirm-promptpay");
    const command = confirmPromptPayBodySchema.parse(request.body);
    const visitId = requestVisitId(request);
    const key = idempotencyKey(request);
    let reference: FinanceCollectionReplayReference | undefined;
    const result = executeIdempotent<CheckoutReplayDto, FinanceCollectionReplayReference>({
      db: input.database.db,
      actor,
      key,
      operation: "finance.confirm-promptpay.v1",
      scope: visitId,
      requestBody: command,
      work: (tx) => {
        const data = input.finance.confirmPromptPay(tx, actor, visitId, {
          chargeId: command.payload.chargeId,
          amountBaht: command.payload.amountBaht,
          manualReference: command.payload.manualReference,
          expectedVisitRevision: command.expectedRevisions.visit,
        });
        reference = collectionReplayReference(input.finance, tx, visitId, data);
        if (!data.charge || reference.resolution.kind !== "PAYMENT" || reference.resolution.method !== "PROMPTPAY") {
          throw new Error("PromptPay command did not return immutable Payment evidence");
        }
        const payment = tx.select()
          .from(financePayments)
          .where(eq(financePayments.id, reference.resolution.paymentId))
          .get();
        if (!payment || payment.manualReference === null) {
          throw new Error("PromptPay command did not persist a manual Payment reference");
        }
        appendAuditEvent({
          tx,
          actor,
          id: `audit:payment.promptpay-confirmed:${payment.id}:${key}`,
          action: "payment.promptpay-confirmed",
          entityType: "finance_payment",
          entityId: payment.id,
          entityRevision: data.visit.revision,
          reason: null,
          occurredAt: payment.confirmedAt,
          metadata: {
            chargeId: data.charge.id,
            paymentId: payment.id,
            amountBaht: payment.amountBaht,
            manualReference: payment.manualReference,
          },
        });
        return { statusCode: 201, data };
      },
      safeReplay: {
        store(data, tx) {
          if (reference) return { ...reference, responseShape: "HASH_FREE_V2" };
          if (!isHistoricalCheckoutResponse(data)) throw new Error("PromptPay replay reference was not created");
          return collectionReplayReference(input.finance, tx, visitId, data, "LEGACY_HASHED_V1");
        },
        rebuild(tx, storedReference) {
          return input.finance.rebuildCollection(tx, storedReference);
        },
        isLegacyResponse: isHistoricalCheckoutResponse,
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
}
