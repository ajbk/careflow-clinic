import type { FastifyInstance } from "fastify";
import {
  fulfillmentAbandonPreparationBodySchema, fulfillmentCompletePreparationBodySchema, fulfillmentConfirmationBodySchema,
  fulfillmentHandoffBodySchema, fulfillmentPrintBodySchema, fulfillmentRejectBodySchema, fulfillmentReleaseBodySchema,
  reserveInventoryBodySchema,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { and, eq } from "drizzle-orm";
import { appendAuditEvent, executeIdempotent } from "../platform/index.js";
import { inventoryReservations } from "../inventory/schema.js";
import type { FulfillmentService } from "./service.js";

export function registerFulfillmentRoutes(input: { app: FastifyInstance; database: DatabaseHandle; fulfillment: FulfillmentService; clock: () => Date }): void {
  const key = (request: { headers: Record<string, unknown> }) => typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : "";
  const visitId = (request: { params: unknown }) => (request.params as { visitId?: string }).visitId ?? "";
  input.app.get("/api/dispensing/:visitId", async (request) => {
    requireActor(request, "fulfillment:read"); return { data: input.fulfillment.getPickList(visitId(request)) };
  });
  input.app.get("/api/dispensing/:visitId/labels", async (request) => {
    requireActor(request, "fulfillment:read"); return { data: input.fulfillment.getCurrentLabel(visitId(request)) };
  });
  input.app.post("/api/dispensing/:visitId/reservations", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:prepare"); const body = reserveInventoryBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.start-preparation.v1", scope: id, requestBody: body, work: (tx) => {
      const activeBefore = tx.select({ id: inventoryReservations.id }).from(inventoryReservations).where(and(eq(inventoryReservations.clinicId, "clinic"), eq(inventoryReservations.visitId, id), eq(inventoryReservations.status, "ACTIVE"))).get();
      const data = input.fulfillment.startPreparation(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.medicationDecision, body.payload.labelVersionId);
      const reservation = data.reservation; if (!reservation) throw new Error("Reservation missing after start"); const occurredAt = input.clock().toISOString();
      if (!activeBefore) {
        const allocations = reservation.allocations.map((a) => ({ allocationId: a.id, orderItemId: a.orderItemId, lotId: a.lotId, lotNumber: a.lotNumberSnapshot, expiryDate: a.expiryDateSnapshot, unit: a.unitSnapshot, quantity: a.quantity }));
        const chain = { visitId: id, decisionId: data.medicationDecision?.id, decisionVersion: data.medicationDecision?.version, labelVersionId: data.label?.id, reservationId: reservation.id, preparationId: data.preparation?.id, allocations };
        appendAuditEvent({ tx, actor, id: `audit:inventory.reservation-created:${reservation.id}:${key(request)}`, action: "inventory.reservation-created", entityType: "inventory_reservation", entityId: reservation.id, entityRevision: 1, reason: null, occurredAt, metadata: chain });
        appendAuditEvent({ tx, actor, id: `audit:visit.preparation-started:${id}:${data.visit.revision}:${key(request)}`, action: "visit.preparation-started", entityType: "visit", entityId: id, entityRevision: data.visit.revision, reason: null, occurredAt, metadata: { ...chain, previousStatus: "AWAITING_PREPARATION", nextStatus: "PREPARING" } });
      }
      return { statusCode: activeBefore ? 200 : 201, data };
    }}); return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/labels/:labelVersionId/print-events", async (request, reply) => {
    const actor = requireActor(request, "label:print"); const body = fulfillmentPrintBodySchema.parse(request.body); const id = visitId(request); const labelVersionId = (request.params as { labelVersionId?: string }).labelVersionId ?? "";
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.print-label.v1", scope: `${id}:${labelVersionId}`, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.recordPrintRequest(tx, actor, id, labelVersionId, body.expectedRevisions.visit, body.payload.decisionVersion, body.payload.rendererVersion) }) }); return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/preparation-confirmations", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:prepare"); const body = fulfillmentConfirmationBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.confirm-allocation.v1", scope: id, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.confirmAllocation(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.preparation, body.payload) }) }); return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/complete-preparation", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:prepare"); const body = fulfillmentCompletePreparationBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.complete-preparation.v1", scope: id, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.completePreparation(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.preparation, body.payload.preparationId, body.payload.reservationId) }) }); return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/reservation-release", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:prepare"); const body = fulfillmentAbandonPreparationBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.abandon-preparation.v1", scope: id, requestBody: body, work: (tx) => {
      return { statusCode: 201, data: input.fulfillment.abandonPreparation(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.preparation, body.payload.preparationId, body.payload.reservationId, body.payload.reason) };
    }}); return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/release", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:release"); const body = fulfillmentReleaseBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.release.v1", scope: id, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.releaseForVisit(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.preparation, body.payload) }) });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/reject", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:release"); const body = fulfillmentRejectBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.reject.v1", scope: id, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.rejectForVisit(tx, actor, id, body.expectedRevisions.visit, body.expectedRevisions.preparation, body.payload) }) });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
  input.app.post("/api/dispensing/:visitId/handoff", async (request, reply) => {
    const actor = requireActor(request, "fulfillment:handoff"); const body = fulfillmentHandoffBodySchema.parse(request.body); const id = visitId(request);
    const result = executeIdempotent({ db: input.database.db, actor, key: key(request), operation: "fulfillment.handoff.v1", scope: id, requestBody: body, work: (tx) => ({ statusCode: 201, data: input.fulfillment.handoffForVisit(tx, actor, id, body.expectedRevisions.visit, body.payload) }) });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
}
