import type { FastifyInstance } from "fastify";
import {
  startConsultationBodySchema,
  submitIntakeBodySchema,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { executeIdempotent } from "../platform/index.js";
import type { VisitService } from "./service.js";

export function registerVisitRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  visits: VisitService;
}): void {
  input.app.post("/api/visits/intake", async (request, reply) => {
    const actor = requireActor(request, "visit:submit-intake");
    const body = submitIntakeBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "visit.submit-intake.v1",
      requestBody: body,
      work: (tx) => ({
        statusCode: 201,
        data: input.visits.submitIntake(tx, actor, body),
      }),
    });
    return reply.code(result.statusCode).send(result.body);
  });

  input.app.get("/api/queue", async (request) => {
    const actor = requireActor(request, "visit:read-queue");
    return { data: input.visits.listQueue(actor) };
  });

  input.app.get("/api/dashboard/today", async (request) => {
    requireActor(request, "visit:read-queue");
    return { data: input.visits.getDashboardToday() };
  });

  input.app.get("/api/visits/:visitId/workspace", async (request) => {
    const actor = requireActor(request, "visit:read-queue");
    const params = request.params as { visitId?: string };
    return { data: input.visits.getWorkspace(params.visitId ?? "", actor) };
  });

  input.app.post("/api/visits/:visitId/start-consultation", async (request, reply) => {
    const actor = requireActor(request, "visit:start-consultation");
    const body = startConsultationBodySchema.parse(request.body);
    const params = request.params as { visitId?: string };
    const visitId = params.visitId ?? "";
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "visit.start-consultation.v1",
      requestBody: body,
      work: (tx) => ({
        statusCode: 200,
        data: input.visits.startConsultation(tx, actor, visitId, body),
      }),
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
