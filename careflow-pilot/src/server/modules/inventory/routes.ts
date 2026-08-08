import type { FastifyInstance } from "fastify";
import { medicationSearchQuerySchema, receiveInventoryBodySchema } from "../../../shared/contracts.js";
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

}
