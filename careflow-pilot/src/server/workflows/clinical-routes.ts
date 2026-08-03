import type { FastifyInstance } from "fastify";
import { reviewAllergyBodySchema } from "../../shared/contracts.js";
import { requireActor } from "../auth/hooks.js";
import type { DatabaseHandle } from "../db/client.js";
import { executeIdempotent } from "../modules/platform/index.js";
import type { ClinicalWorkflow } from "./clinical.js";

export function registerClinicalRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  clinical: ClinicalWorkflow;
}): void {
  input.app.post("/api/patients/:patientId/allergy-revisions", async (request, reply) => {
    const actor = requireActor(request, "patient:update-allergy");
    const patientId = (request.params as { patientId?: string }).patientId ?? "";
    const body = reviewAllergyBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "patient.review-allergy.v1",
      scope: patientId,
      requestBody: body,
      work: (tx) => ({
        statusCode: 201,
        data: input.clinical.reviewAllergy(tx, actor, patientId, body),
      }),
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
