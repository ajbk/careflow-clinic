import type { FastifyInstance } from "fastify";
import {
  medicationSearchQuerySchema,
  receiveInventoryBodySchema,
  releaseInventoryBodySchema,
  reserveInventoryBodySchema,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import { and, desc, eq } from "drizzle-orm";
import { appendAuditEvent, executeIdempotent } from "../platform/index.js";
import type { InventoryService } from "./service.js";
import { inventoryReservations } from "./schema.js";

export function registerInventoryRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  inventory: InventoryService;
}): void {
  input.app.get("/api/inventory", async (request) => {
    requireActor(request, "inventory:read");
    return { data: input.inventory.getInventory() };
  });

  input.app.get("/api/inventory/medications", async (request) => {
    requireActor(request, "inventory:receive");
    const query = medicationSearchQuerySchema.parse(request.query);
    return { data: input.inventory.searchMedicationCatalog(query.q) };
  });

  input.app.post("/api/inventory/receipts", async (request, reply) => {
    const actor = requireActor(request, "inventory:receive");
    const body = receiveInventoryBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "inventory.receive",
      requestBody: body,
      work: (tx) => {
        const receipt = input.inventory.receiveStock(
          tx,
          actor,
          body.expectedRevisions.medication,
          body.payload,
        );
        appendAuditEvent({
          tx,
          actor,
          id: `audit:inventory.stock-received:${receipt.id}`,
          action: "inventory.stock-received",
          entityType: "inventory_receipt",
          entityId: receipt.id,
          entityRevision: 1,
          reason: body.payload.note,
          occurredAt: receipt.receivedAt,
          metadata: {
            medicationId: receipt.medication.id,
            lotId: receipt.lot.id,
            lotNumber: receipt.lot.lotNumber,
            quantity: receipt.quantity,
            unit: receipt.unit,
          },
        });
        return { statusCode: 201, data: receipt };
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.get("/api/dispensing/:visitId", async (request) => {
    requireActor(request, "inventory:read");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const data = input.inventory.getPickList(visitId);
    if (data.medicationDecision.kind !== "ORDER") {
      throw new ApiError({ code: "INVALID_STATE", messageTh: "Visit นี้ไม่มีคำสั่งยาแบบ ORDER สำหรับจัดยา" });
    }
    return { data };
  });

  input.app.post("/api/dispensing/:visitId/reservations", async (request, reply) => {
    const actor = requireActor(request, "inventory:reserve");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const body = reserveInventoryBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "inventory.reserve",
      scope: visitId,
      requestBody: body,
      work: (tx) => {
        const activeReservation = tx.select({ id: inventoryReservations.id })
          .from(inventoryReservations)
          .where(and(
            eq(inventoryReservations.clinicId, "clinic"),
            eq(inventoryReservations.visitId, visitId),
            eq(inventoryReservations.status, "ACTIVE"),
          ))
          .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id))
          .get();
        const data = input.inventory.reserveForVisit(
          tx,
          actor,
          visitId,
          body.expectedRevisions.visit,
          body.expectedRevisions.medicationDecision,
        );
        const reservation = data.reservation;
        if (!reservation) throw new Error("Reservation was not created");
        const occurredAt = reservation.createdAt;
        if (activeReservation) return { statusCode: 200, data };
        appendAuditEvent({
          tx,
          actor,
          id: `audit:inventory.reservation-created:${reservation.id}:${key}`,
          action: "inventory.reservation-created",
          entityType: "inventory_reservation",
          entityId: reservation.id,
          entityRevision: 1,
          reason: null,
          occurredAt,
          metadata: {
            visitId,
            medicationDecisionId: reservation.medicationDecisionId,
            medicationDecisionVersion: reservation.medicationDecisionVersion,
            allocationCount: reservation.allocations.length,
            allocations: reservation.allocations.map((allocation) => ({
              lotId: allocation.lotId,
              lotNumber: allocation.lotNumberSnapshot,
              quantity: allocation.quantity,
              unit: allocation.unitSnapshot,
            })),
          },
        });
        appendAuditEvent({
          tx,
          actor,
          id: `audit:visit.preparation-started:${visitId}:${data.visit.revision}:${key}`,
          action: "visit.preparation-started",
          entityType: "visit",
          entityId: visitId,
          entityRevision: data.visit.revision,
          reason: null,
          occurredAt,
          metadata: { previousStatus: "AWAITING_PREPARATION", nextStatus: "PREPARING", reservationId: reservation.id },
        });
        return { statusCode: 201, data };
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.post("/api/dispensing/:visitId/reservation-release", async (request, reply) => {
    const actor = requireActor(request, "inventory:reserve");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const body = releaseInventoryBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "inventory.reservation-release",
      scope: visitId,
      requestBody: body,
      work: (tx) => {
        const selectedReservation = tx.select({ id: inventoryReservations.id })
          .from(inventoryReservations)
          .where(and(
            eq(inventoryReservations.clinicId, "clinic"),
            eq(inventoryReservations.visitId, visitId),
            eq(inventoryReservations.status, "ACTIVE"),
          ))
          .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id))
          .get();
        if (!selectedReservation) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบรายการจองยา" });
        const data = input.inventory.releaseReservation(
          tx,
          actor,
          visitId,
          body.expectedRevisions.visit,
          selectedReservation.id,
          body.payload.reason,
        );
        const reservation = data.reservation;
        if (!reservation) throw new Error("Released reservation was not found");
        const occurredAt = reservation.releasedAt ?? new Date().toISOString();
        appendAuditEvent({
          tx,
          actor,
          id: `audit:inventory.reservation-released:${reservation.id}:${data.visit.revision}:${key}`,
          action: "inventory.reservation-released",
          entityType: "inventory_reservation",
          entityId: reservation.id,
          entityRevision: 1,
          reason: body.payload.reason,
          occurredAt,
          metadata: {
            visitId,
            trigger: "manual-release",
            allocations: reservation.allocations.map((allocation) => ({
              lotId: allocation.lotId,
              lotNumber: allocation.lotNumberSnapshot,
              quantity: allocation.quantity,
              unit: allocation.unitSnapshot,
            })),
          },
        });
        appendAuditEvent({
          tx,
          actor,
          id: `audit:visit.preparation-abandoned:${visitId}:${data.visit.revision}:${key}`,
          action: "visit.preparation-abandoned",
          entityType: "visit",
          entityId: visitId,
          entityRevision: data.visit.revision,
          reason: body.payload.reason,
          occurredAt,
          metadata: { previousStatus: "PREPARING", nextStatus: "AWAITING_PREPARATION", reservationId: reservation.id },
        });
        return { statusCode: 201, data };
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });
}
