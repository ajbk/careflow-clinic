import type {
  Actor,
  AllergyReviewResultDto,
  ReviewAllergyBody,
  SaveConsultationDraftBody,
  ClinicalNoteDraftDto,
  MedicationDecisionDraftDto,
} from "../../shared/contracts.js";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import type { MedicationService } from "../modules/medication/index.js";
import type { NoteService } from "../modules/note/index.js";
import type { PatientService } from "../modules/patient/index.js";
import { appendAuditEvent, type AuditedTransaction } from "../modules/platform/index.js";
import type { VisitService } from "../modules/visit/index.js";

export interface ClinicalWorkflow {
  reviewAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    patientId: string,
    body: ReviewAllergyBody,
  ): AllergyReviewResultDto;
  saveConsultationDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    body: SaveConsultationDraftBody,
  ): { note: ClinicalNoteDraftDto; medicationDecision: MedicationDecisionDraftDto };
  replayConsultationDraft(reference: {
    visitId: string;
    noteDraftRevision: number;
    medicationDraftRevision: number;
    medicationDecisionKind: MedicationDecisionDraftDto["kind"];
  }): { note: ClinicalNoteDraftDto; medicationDecision: MedicationDecisionDraftDto };
  replayAllergyReview(reference: {
    patientId: string;
    patientRevision: number;
    allergyRevision: number;
    allergyState: AllergyReviewResultDto["allergy"]["state"];
    visitId: string;
    visitRevision: number;
    visitStatus: AllergyReviewResultDto["visit"]["status"];
  }): AllergyReviewResultDto;
}

export function createClinicalWorkflow(input: {
  patients: PatientService;
  visits: VisitService;
  notes: NoteService;
  medications: MedicationService;
  clock?: () => Date;
  idFactory?: () => string;
}): ClinicalWorkflow {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  return {
    reviewAllergy(tx, actor, patientId, body) {
      const visit = input.visits.assertAllergyReviewVisit(tx, actor, patientId, body);
      const { patient, allergy } = input.patients.reviewAllergy(
        tx,
        actor,
        patientId,
        body.expectedRevisions.patient,
        body.payload,
      );
      return { patient, allergy, visit };
    },

    saveConsultationDraft(tx, actor, visitId, body) {
      if (actor.role !== "doctor") {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      input.visits.assertConsultationDraftVisit(tx, actor, visitId, body.expectedRevisions.visit);
      const note = input.notes.saveDraft(
        tx, actor, visitId, body.expectedRevisions.noteDraft, body.payload.note,
      );
      const medicationDecision = input.medications.saveDecisionDraft(
        tx,
        actor,
        visitId,
        body.expectedRevisions.medicationDraft,
        body.payload.medicationDecision,
      );
      appendAuditEvent({
        tx,
        actor,
        id: idFactory(),
        action: "note.draft-saved",
        entityType: "clinical_note_draft",
        entityId: note.id,
        entityRevision: note.revision,
        reason: null,
        occurredAt: clock().toISOString(),
      });
      return { note, medicationDecision };
    },

    replayConsultationDraft(reference) {
      const note = input.notes.getDraft(reference.visitId);
      const medicationDecision = input.medications.getDecisionDraft(reference.visitId);
      if (!note || !medicationDecision) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลร่างสำหรับการเรียกซ้ำ" });
      }
      return { note, medicationDecision };
    },

    replayAllergyReview(reference) {
      const patient = input.patients.getPatientById(reference.patientId);
      const visit = input.visits.getVisitSummary(reference.visitId);
      if (!patient || !visit) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลทบทวนสำหรับการเรียกซ้ำ" });
      }
      return {
        patient,
        allergy: input.patients.getAllergyAssessment(reference.patientId),
        visit,
      };
    },
  };
}
