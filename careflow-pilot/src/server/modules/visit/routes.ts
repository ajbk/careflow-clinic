import type { FastifyInstance } from "fastify";
import stableStringify from "fast-json-stable-stringify";
import {
  startConsultationBodySchema,
  submitIntakeBodySchema,
} from "../../../shared/contracts.js";
import { requireActor } from "../../auth/hooks.js";
import type { DatabaseHandle } from "../../db/client.js";
import { executeIdempotent } from "../platform/index.js";
import type { JourneyService } from "../../workflows/journey.js";
import type { VisitService } from "./service.js";

export function registerVisitRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  visits: VisitService;
  journey: JourneyService;
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
      operation: "visit.submit-intake.v2",
      requestBody: body,
      work: (tx) => {
        const item = input.visits.submitIntake(tx, actor, body);
        return {
          statusCode: 201,
          // The transaction already owns this Intake result. Build its safe WAITING summary from
          // committed command evidence instead of racing a second database read.
          data: {
            ...item,
            journeySummary: input.journey.summarizeCommittedIntake(actor, item),
          },
        };
      },
    });
    const responseBody = JSON.parse(stableStringify(result.body)) as typeof result.body;
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(responseBody);
  });

  input.app.get("/api/queue", async (request) => {
    const actor = requireActor(request, "visit:read-queue");
    return {
      data: input.visits.listQueue(actor).map((item) => ({
        ...item,
        journeySummary: input.journey.getSummary(actor, item.visit.id),
      })),
    };
  });

  input.app.get("/api/dashboard/today", async (request) => {
    requireActor(request, "visit:read-queue");
    return { data: input.visits.getDashboardToday() };
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
      scope: visitId,
      requestBody: body,
      work: (tx) => {
        const item = input.visits.startConsultation(tx, actor, visitId, body);
        return {
          statusCode: 200,
          // Persist the same safe CONSULTING summary with the idempotent response so first and
          // replayed calls both satisfy the Queue client contract without a second read race.
          data: {
            ...item,
            journeySummary: input.journey.summarizeCommittedStartConsultation(actor, item),
          },
        };
      },
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
