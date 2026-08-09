import type { FastifyInstance } from "fastify";
import {
  checkoutDtoSchema,
  finalizeChargeBodySchema,
  type CheckoutDto,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { appendAuditEvent, executeIdempotent } from "../platform/index.js";
import type {
  ChargeFinalizeReplayReference,
  FinanceService,
} from "./service.js";

function requestVisitId(request: { params: unknown }): string {
  return (request.params as { visitId?: string }).visitId ?? "";
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string {
  return typeof request.headers["idempotency-key"] === "string"
    ? request.headers["idempotency-key"]
    : "";
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
    const result = executeIdempotent<CheckoutDto, ChargeFinalizeReplayReference>({
      db: input.database.db,
      actor,
      key,
      operation: "finance.finalize-charge.v1",
      scope: visitId,
      requestBody: command,
      work: (tx) => {
        const data = input.finance.finalizeCharge(tx, actor, visitId, command);
        if (!data.charge) throw new Error("Charge finalization did not return immutable Charge evidence");
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
            nextStatus: "AWAITING_PAYMENT",
          },
        });
        return { statusCode: 201, data };
      },
      safeReplay: {
        store(data) {
          if (!data.charge) throw new Error("Charge replay reference requires a Charge");
          return {
            chargeId: data.charge.id,
            patient: data.patient,
            visit: data.visit,
            projection: {
              adjustmentTotalBaht: data.adjustmentTotalBaht,
              netDueBaht: data.netDueBaht,
              collectionState: data.collectionState,
              allowedActions: [...data.allowedActions],
              closeBlockers: [...data.closeBlockers],
            },
          };
        },
        rebuild(tx, reference) {
          return input.finance.rebuildFinalization(tx, reference);
        },
        isLegacyResponse(data): data is CheckoutDto {
          return checkoutDtoSchema.safeParse(data).success;
        },
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
}
