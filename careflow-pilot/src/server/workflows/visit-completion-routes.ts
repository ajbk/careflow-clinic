import type { FastifyInstance } from "fastify";
import {
  closeVisitBodySchema,
  closeVisitResponseSchema,
  type VisitClosureDto,
} from "../../shared/contracts.js";
import { requireActor } from "../auth/hooks.js";
import type { DatabaseHandle } from "../db/client.js";
import { executeIdempotent } from "../modules/platform/index.js";
import type { VisitCloseWriteStage, VisitCompletionWorkflow } from "./visit-completion.js";

function requestVisitId(request: { params: unknown }): string {
  return (request.params as { visitId?: string }).visitId ?? "";
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string {
  return typeof request.headers["idempotency-key"] === "string"
    ? request.headers["idempotency-key"]
    : "";
}

export function registerVisitCompletionRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  completion: VisitCompletionWorkflow;
  failureInjector?: (stage: VisitCloseWriteStage) => void;
}): void {
  input.app.post("/api/visits/:visitId/close", async (request, reply) => {
    // Authorization must occur before parsing or reading potentially clinical evidence.
    const actor = requireActor(request, "visit:close");
    const body = closeVisitBodySchema.parse(request.body);
    const visitId = requestVisitId(request);
    const result = executeIdempotent<VisitClosureDto, { visitId: string; closureId: string }>({
      db: input.database.db,
      actor,
      key: idempotencyKey(request),
      operation: "visit.close.v1",
      scope: visitId,
      requestBody: body,
      work: (tx) => ({
        statusCode: 201,
        data: input.completion.closeVisit(tx, actor, visitId, body),
      }),
      safeReplay: {
        store: (closure) => ({ visitId: closure.visitId, closureId: closure.id }),
        rebuild: (tx, reference) => input.completion.replayClose(tx, reference),
        isLegacyResponse: (data): data is VisitClosureDto => (
          closeVisitResponseSchema.safeParse({ data, replayed: false }).success
        ),
      },
      afterStore: () => input.failureInjector?.("AFTER_IDEMPOTENCY_INSERT"),
    });
    return reply.code(result.body.replayed ? 200 : result.statusCode).send(result.body);
  });

  input.app.get("/api/visits/:visitId/opd-card", async (request) => {
    const actor = requireActor(request, "opd:read");
    return { data: input.completion.getOpdCard(actor, requestVisitId(request)) };
  });
}
