import type { FastifyInstance } from "fastify";
import {
  allergyReviewResultSchema,
  clinicalNoteAmendmentResponseSchema,
  medicationDecisionRevisionResponseSchema,
  finalizeConsultationBodySchema,
  finalizeConsultationResponseSchema,
  saveConsultationDraftBodySchema,
  saveConsultationDraftResponseSchema,
  reviewAllergyBodySchema,
  signClinicalNoteAmendmentBodySchema,
  signMedicationDecisionRevisionBodySchema,
  type AllergyReviewResultDto,
  type ClinicalNoteDraftDto,
  type ClinicalNoteAmendmentDto,
  type MedicationDecisionDraftDto,
  type MedicationDecisionRevisionResultDto,
  type FinalizeConsultationResultDto,
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
  input.app.get("/api/visits/:visitId/workspace", async (request) => {
    const actor = requireActor(request, "clinical:read");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    return { data: input.clinical.getWorkspace(visitId, actor) };
  });

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

  input.app.post("/api/clinical-notes/:noteId/amendments", async (request, reply) => {
    const actor = requireActor(request, "clinical:amend");
    const noteId = (request.params as { noteId?: string }).noteId ?? "";
    const body = signClinicalNoteAmendmentBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "clinical.amend-note.v1",
      scope: noteId,
      requestBody: body,
      work: (tx) => ({ statusCode: 201, data: input.clinical.amendNote(tx, actor, noteId, body) }),
      safeReplay: {
        store: (data) => ({
          clinicalNoteId: data.clinicalNoteId,
          amendmentId: data.id,
          amendmentVersion: data.version,
        }),
        rebuild: (_tx, reference) => input.clinical.replayAmendment(reference),
        isLegacyResponse: (data): data is ClinicalNoteAmendmentDto => (
          clinicalNoteAmendmentResponseSchema.safeParse({ data, replayed: false }).success
        ),
      },
    });
    return reply.code(result.statusCode).send(result.body);
  });

  input.app.post("/api/visits/:visitId/medication-decision-revisions", async (request, reply) => {
    const actor = requireActor(request, "medication:sign-decision");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const body = signMedicationDecisionRevisionBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "medication.revise-decision.v1",
      scope: visitId,
      requestBody: body,
      work: (tx) => ({ statusCode: 201, data: input.clinical.reviseMedicationDecision(tx, actor, visitId, body) }),
      safeReplay: {
        store: (data) => ({
          visit: data.visit,
          medicationDecisionId: data.medicationDecision.id,
          medicationDecisionVersion: data.medicationDecision.version,
        }),
        rebuild: (_tx, reference) => input.clinical.replayMedicationDecisionRevision(reference),
        isLegacyResponse: (data): data is MedicationDecisionRevisionResultDto => (
          medicationDecisionRevisionResponseSchema.safeParse({ data, replayed: false }).success
        ),
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

  input.app.post("/api/visits/:visitId/finalize-consultation", async (request, reply) => {
    requireActor(request, "clinical:sign");
    const actor = requireActor(request, "medication:sign-decision");
    const visitId = (request.params as { visitId?: string }).visitId ?? "";
    const body = finalizeConsultationBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "clinical.finalize-consultation.v1",
      scope: visitId,
      requestBody: body,
      work: (tx) => ({
        statusCode: 200,
        data: input.clinical.finalizeConsultation(tx, actor, visitId, body),
      }),
      safeReplay: {
        store: (data) => ({
          visit: data.visit,
          clinicalNoteId: data.clinicalNote.id,
          clinicalNoteVersion: data.clinicalNote.version,
          medicationDecisionId: data.medicationDecision.id,
          medicationDecisionVersion: data.medicationDecision.version,
        }),
        rebuild: (_tx, reference) => input.clinical.replayFinalizedConsultation(reference),
        isLegacyResponse: (data): data is FinalizeConsultationResultDto => (
          finalizeConsultationResponseSchema.safeParse({ data, replayed: false }).success
        ),
      },
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
