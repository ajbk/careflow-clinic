import type { FastifyInstance } from "fastify";
import {
  adjustInventoryLotBodySchema,
  medicationSearchQuerySchema,
  quarantineInventoryLotBodySchema,
  receiveInventoryBodySchema,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { appendAuditEvent, executeIdempotent } from "../platform/index.js";
import type { InventoryService } from "./service.js";

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

  input.app.get<{ Params: { medicationId: string } }>("/api/inventory/medications/:medicationId/lots", async (request) => {
    requireActor(request, "inventory:read");
    return { data: input.inventory.getMedicationLots(request.params.medicationId) };
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

  function idempotencyKey(request: { headers: Record<string, unknown> }): string {
    const rawKey = request.headers["idempotency-key"];
    return typeof rawKey === "string" ? rawKey : "";
  }

  function registerLotStatusRoute(path: "/api/inventory/lots/:lotId/quarantine" | "/api/inventory/lots/:lotId/unquarantine", permission: "inventory:quarantine" | "inventory:release-quarantine", nextStatus: "AVAILABLE" | "QUARANTINED", operation: string, auditAction: "inventory.lot-quarantined" | "inventory.lot-unquarantined"): void {
    input.app.post<{ Params: { lotId: string } }>(path, async (request, reply) => {
      const actor = requireActor(request, permission);
      const body = quarantineInventoryLotBodySchema.parse(request.body);
      const result = executeIdempotent({
        db: input.database.db, actor, key: idempotencyKey(request), operation, scope: request.params.lotId, requestBody: body,
        work: (tx) => {
          const lot = input.inventory.changeLotStatus(tx, actor, {
            lotId: request.params.lotId, expectedRevision: body.expectedRevisions.lot, nextStatus, reason: body.payload.reason,
          });
          appendAuditEvent({
            tx, actor, id: `audit:${auditAction}:${lot.id}:${lot.revision}`, action: auditAction,
            entityType: "inventory_lot", entityId: lot.id, entityRevision: lot.revision, reason: body.payload.reason,
            occurredAt: new Date().toISOString(), metadata: { lotId: lot.id, oldStatus: nextStatus === "QUARANTINED" ? "AVAILABLE" : "QUARANTINED", newStatus: lot.status, revision: lot.revision, reason: body.payload.reason },
          });
          return { statusCode: 201, data: lot };
        },
      });
      return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
    });
  }

  registerLotStatusRoute("/api/inventory/lots/:lotId/quarantine", "inventory:quarantine", "QUARANTINED", "inventory.quarantine", "inventory.lot-quarantined");
  registerLotStatusRoute("/api/inventory/lots/:lotId/unquarantine", "inventory:release-quarantine", "AVAILABLE", "inventory.unquarantine", "inventory.lot-unquarantined");

  input.app.post<{ Params: { lotId: string } }>("/api/inventory/lots/:lotId/adjustments", async (request, reply) => {
    const actor = requireActor(request, "inventory:adjust");
    const body = adjustInventoryLotBodySchema.parse(request.body);
    const result = executeIdempotent({
      db: input.database.db, actor, key: idempotencyKey(request), operation: "inventory.adjust", scope: request.params.lotId, requestBody: body,
      work: (tx) => {
        const lot = input.inventory.adjustLot(tx, actor, {
          lotId: request.params.lotId, expectedRevision: body.expectedRevisions.lot,
          correctsMovementId: body.payload.correctsMovementId, quantityDelta: body.payload.quantityDelta, reason: body.payload.reason,
        });
        appendAuditEvent({
          tx, actor, id: `audit:inventory.lot-adjusted:${lot.id}:${lot.revision}`, action: "inventory.lot-adjusted",
          entityType: "inventory_lot", entityId: lot.id, entityRevision: lot.revision, reason: body.payload.reason,
          occurredAt: new Date().toISOString(), metadata: { lotId: lot.id, correctsMovementId: body.payload.correctsMovementId, quantityDelta: body.payload.quantityDelta, onHand: lot.onHand, reserved: lot.reserved, available: lot.available, revision: lot.revision, reason: body.payload.reason },
        });
        return { statusCode: 201, data: lot };
      },
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

}
