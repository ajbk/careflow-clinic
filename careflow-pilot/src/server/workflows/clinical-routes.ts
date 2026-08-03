import type { FastifyInstance } from "fastify";
import {
  allergyReviewResultSchema,
  saveConsultationDraftBodySchema,
  saveConsultationDraftResponseSchema,
  reviewAllergyBodySchema,
  type AllergyReviewResultDto,
  type ClinicalNoteDraftDto,
  type MedicationDecisionDraftDto,
} from "../../shared/contracts.js";
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
      safeReplay: {
        store: (data) => ({
          patientId: data.patient.id,
          patientRevision: data.patient.revision,
          allergyRevision: data.allergy.revision,
          allergyState: data.allergy.state,
          visitId: data.visit.id,
          visitRevision: data.visit.revision,
          visitStatus: data.visit.status,
        }),
        rebuild: (_tx, reference) => input.clinical.replayAllergyReview(reference),
        isLegacyResponse: (data): data is AllergyReviewResultDto => allergyReviewResultSchema.safeParse(data).success,
      },
    });
    return reply.code(result.statusCode).send(result.body);
  });

  input.app.post("/api/visits/:visitId/consultation-draft", async (request, reply) => {
    const actor = requireActor(request, "clinical:save-draft");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const body = saveConsultationDraftBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "clinical.save-draft.v1",
      scope: visitId,
      requestBody: body,
      work: (tx) => ({
        statusCode: 200,
        data: input.clinical.saveConsultationDraft(tx, actor, visitId, body),
      }),
      safeReplay: {
        store: (data) => ({
          visitId: data.note.visitId,
          noteDraftRevision: data.note.revision,
          medicationDraftRevision: data.medicationDecision.revision,
          medicationDecisionKind: data.medicationDecision.kind,
        }),
        rebuild: (_tx, reference) => input.clinical.replayConsultationDraft(reference),
        isLegacyResponse: (data): data is {
          note: ClinicalNoteDraftDto;
          medicationDecision: MedicationDecisionDraftDto;
        } => saveConsultationDraftResponseSchema.safeParse({ data, replayed: false }).success,
      },
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
