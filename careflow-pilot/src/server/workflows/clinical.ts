import type {
  Actor,
  AllergyReviewResultDto,
  ClinicalNoteAmendmentDto,
  ReviewAllergyBody,
  SaveConsultationDraftBody,
  ClinicalNoteDraftDto,
  MedicationDecisionDraftDto,
  FinalizeConsultationBody,
  FinalizeConsultationResultDto,
  MedicationDecisionRevisionResultDto,
  SignClinicalNoteAmendmentBody,
  SignMedicationDecisionRevisionBody,
  VisitSummaryDto,
} from "../../shared/contracts.js";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import type { MedicationService } from "../modules/medication/index.js";
import type { NoteService } from "../modules/note/index.js";
import type { PatientService } from "../modules/patient/index.js";
import { appendAuditEvent, hasPermission, type AuditedTransaction } from "../modules/platform/index.js";
import type { VisitService } from "../modules/visit/index.js";

export interface ClinicalWorkflow {
  reviewAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    patientId: string,
    body: ReviewAllergyBody,
  ): AllergyReviewResultDto;
  amendNote(
    tx: AuditedTransaction,
    actor: Actor,
    noteId: string,
    body: SignClinicalNoteAmendmentBody,
  ): ClinicalNoteAmendmentDto;
  reviseMedicationDecision(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    body: SignMedicationDecisionRevisionBody,
  ): MedicationDecisionRevisionResultDto;
  saveConsultationDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    body: SaveConsultationDraftBody,
  ): { note: ClinicalNoteDraftDto; medicationDecision: MedicationDecisionDraftDto };
  finalizeConsultation(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    body: FinalizeConsultationBody,
  ): FinalizeConsultationResultDto;
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
  replayFinalizedConsultation(reference: {
    visit: VisitSummaryDto;
    clinicalNoteId: string;
    clinicalNoteVersion: number;
    medicationDecisionId: string;
    medicationDecisionVersion: number;
  }): FinalizeConsultationResultDto;
  replayAmendment(reference: { clinicalNoteId: string; amendmentId: string; amendmentVersion: number }): ClinicalNoteAmendmentDto;
  replayMedicationDecisionRevision(reference: {
    visit: VisitSummaryDto;
    medicationDecisionId: string;
    medicationDecisionVersion: number;
  }): MedicationDecisionRevisionResultDto;
}

export function createClinicalWorkflow(input: {
  patients: PatientService;
  visits: VisitService;
  notes: NoteService;
  medications: MedicationService;
  clock?: () => Date;
  idFactory?: () => string;
  /** Test seam for proving the enclosing transaction rolls back before the Visit write. */
  beforeVisitTransition?: () => void;
  /** Test seam for proving allergy evidence and its audit roll back with the safety transition. */
  beforeAllergySafetyTransition?: () => void;
  /** Test seam for proving decision evidence and its audit roll back with its Visit transition. */
  beforeDecisionRevisionTransition?: () => void;
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
      if (visit.status !== "AWAITING_PREPARATION") return { patient, allergy, visit };
      const decision = input.medications.getSignedDecision(visit.id);
      if (!decision || decision.kind !== "ORDER") {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "Visit นี้ไม่มีคำสั่งยาที่ต้องทบทวน" });
      }
      input.beforeAllergySafetyTransition?.();
      return { patient, allergy, visit: input.visits.transitionAllergySafety(tx, actor, visit, body.payload.reason) };
    },

    amendNote(tx, actor, noteId, body) {
      if (!hasPermission(actor, "clinical:amend")) {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      return input.notes.signAmendment(
        tx, actor, noteId, body.expectedRevisions.amendment, body.payload.content, body.payload.reason,
      );
    },

    reviseMedicationDecision(tx, actor, visitId, body) {
      if (!hasPermission(actor, "medication:sign-decision")) {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      const visit = input.visits.assertDecisionRevisionVisit(
        tx, actor, visitId, body.expectedRevisions.visit, body.expectedRevisions.patient,
      );
      const medicationDecision = input.medications.signDecisionRevision(
        tx, actor, visitId, body.expectedRevisions.medicationDecision,
        body.payload.decision, body.payload.revisionReason,
      );
      input.beforeDecisionRevisionTransition?.();
      return {
        visit: input.visits.transitionDecisionRevision(tx, actor, visit, medicationDecision.kind),
        medicationDecision,
      };
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

    finalizeConsultation(tx, actor, visitId, body) {
      if (!hasPermission(actor, "clinical:sign") || !hasPermission(actor, "medication:sign-decision")) {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      input.visits.assertFinalizeConsultationVisit(
        tx,
        actor,
        visitId,
        body.expectedRevisions.visit,
        body.expectedRevisions.patient,
      );
      const clinicalNote = input.notes.signDraft(
        tx, actor, visitId, body.expectedRevisions.noteDraft,
      );
      const medicationDecision = input.medications.signDecisionDraft(
        tx, actor, visitId, body.expectedRevisions.medicationDraft,
      );
      input.beforeVisitTransition?.();
      const visit = input.visits.finalizeConsultation(
        tx, actor, visitId, body.expectedRevisions.visit, medicationDecision.kind,
      );
      appendAuditEvent({
        tx, actor, id: idFactory(), action: "visit.consultation-finalized", entityType: "visit",
        entityId: visit.id, entityRevision: visit.revision, reason: null, occurredAt: clock().toISOString(),
      });
      return { visit, clinicalNote, medicationDecision };
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

    replayFinalizedConsultation(reference) {
      const clinicalNote = input.notes.getSignedNoteById(reference.clinicalNoteId);
      const medicationDecision = input.medications.getSignedDecisionById(reference.medicationDecisionId);
      if (
        !clinicalNote ||
        !medicationDecision ||
        clinicalNote.visitId !== reference.visit.id ||
        clinicalNote.version !== reference.clinicalNoteVersion ||
        medicationDecision.visitId !== reference.visit.id ||
        medicationDecision.version !== reference.medicationDecisionVersion
      ) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลที่ลงนามสำหรับการเรียกซ้ำ" });
      }
      return { visit: reference.visit, clinicalNote, medicationDecision };
    },

    replayAmendment(reference) {
      const amendment = input.notes.getAmendment(reference.clinicalNoteId, reference.amendmentVersion);
      if (!amendment || amendment.id !== reference.amendmentId) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลแก้ไขเพิ่มเติมสำหรับการเรียกซ้ำ" });
      }
      return amendment;
    },

    replayMedicationDecisionRevision(reference) {
      const medicationDecision = input.medications.getSignedDecisionById(reference.medicationDecisionId);
      if (
        !medicationDecision ||
        medicationDecision.visitId !== reference.visit.id ||
        medicationDecision.version !== reference.medicationDecisionVersion
      ) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบคำสั่งยาที่แก้ไขสำหรับการเรียกซ้ำ" });
      }
      return { visit: reference.visit, medicationDecision };
    },
  };
}
