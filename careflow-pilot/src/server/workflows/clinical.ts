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
  VisitWorkspaceDto,
} from "../../shared/contracts.js";
import { visitSummarySchema } from "../../shared/contracts.js";
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { eq } from "drizzle-orm";
import type { MedicationService } from "../modules/medication/index.js";
import type { NoteService } from "../modules/note/index.js";
import type { PatientService } from "../modules/patient/index.js";
import type { InventoryService } from "../modules/inventory/index.js";
import type { FulfillmentService } from "../modules/fulfillment/index.js";
import { fulfillmentDispenses } from "../modules/fulfillment/index.js";
import { appendAuditEvent, hasPermission, type AuditedTransaction } from "../modules/platform/index.js";
import type { VisitService } from "../modules/visit/index.js";

type CurrentFinalizationReplayReference = {
  visit: VisitSummaryDto;
  clinicalNoteId: string;
  clinicalNoteVersion: number;
  medicationDecisionId: string;
  medicationDecisionVersion: number;
};
type CurrentDecisionRevisionReplayReference = {
  visit: VisitSummaryDto;
  medicationDecisionId: string;
  medicationDecisionVersion: number;
};
type LegacyFinalizationReplayReference = {
  visitId: string;
  visitRevision: number;
  clinicalNoteId: string;
  clinicalNoteVersion?: number;
  medicationDecisionId: string;
  medicationDecisionVersion?: number;
};
type LegacyDecisionRevisionReplayReference = {
  visitId: string;
  visitRevision: number;
  medicationDecisionId: string;
  medicationDecisionVersion: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Keep finalization availability private and aligned with the two signing services. */
function finalizableNoteDraft(draft: ClinicalNoteDraftDto | null): boolean {
  return draft !== null &&
    [draft.subjective, draft.objective, draft.assessment, draft.plan].every((value) => value.trim().length > 0) &&
    draft.diagnoses.length >= 1 && draft.diagnoses.length <= 20 &&
    draft.diagnoses.every((diagnosis) => diagnosis.trim().length > 0);
}

function finalizableMedicationDraft(draft: MedicationDecisionDraftDto | null): boolean {
  if (draft === null || draft.kind === "UNDECIDED") return false;
  if (draft.kind === "NO_MEDICATION") return draft.noMedicationReason.trim().length > 0;
  return draft.items.length >= 1 && draft.items.length <= 20 && draft.items.every((item) =>
    item.quantity >= 1 && item.directionsTh.trim().length > 0,
  );
}

function invalidReplayReference(): never {
  throw new Error("Invalid clinical idempotency replay reference");
}

export interface ClinicalWorkflow {
  getWorkspace(visitId: string, actor: Actor): VisitWorkspaceDto;
  /** Presence-only clinical evidence for Journey; no note prose, diagnoses, identifiers, or hashes escape. */
  getJourneyEvidence(visitId: string): {
    hasDraft: boolean;
    hasMedicationDraft: boolean;
    canFinalize: boolean;
    hasSignedNote: boolean;
  };
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
  } | LegacyFinalizationReplayReference): FinalizeConsultationResultDto;
  replayAmendment(reference: { clinicalNoteId: string; amendmentId: string; amendmentVersion: number }): ClinicalNoteAmendmentDto;
  replayMedicationDecisionRevision(reference: {
    visit: VisitSummaryDto;
    medicationDecisionId: string;
    medicationDecisionVersion: number;
  } | LegacyDecisionRevisionReplayReference): MedicationDecisionRevisionResultDto;
}

export function createClinicalWorkflow(input: {
  patients: PatientService;
  visits: VisitService;
  notes: NoteService;
  medications: MedicationService;
  inventory: InventoryService;
  fulfillment: FulfillmentService;
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
  const releasePreparationReservation = (
    tx: AuditedTransaction,
    actor: Actor,
    visit: VisitSummaryDto,
    reason: string,
    trigger: "allergy-safety" | "medication-revision",
    nextStatus: "AWAITING_ORDER_REVISION" | "AWAITING_PREPARATION" | "AWAITING_CHARGE",
  ): void => {
    if (visit.status !== "PREPARING" && visit.status !== "AWAITING_RELEASE" && visit.status !== "AWAITING_HANDOFF") return;
    const released = input.inventory.releaseActiveReservation(tx, actor, visit.id, reason);
    if (!released) return;
    const occurredAt = released.releasedAt ?? clock().toISOString();
    appendAuditEvent({
      tx,
      actor,
      id: idFactory(),
      action: "inventory.reservation-released",
      entityType: "inventory_reservation",
      entityId: released.id,
      entityRevision: 1,
      reason,
      occurredAt,
      metadata: {
        visitId: visit.id,
        trigger,
        allocations: released.allocations.map((allocation) => ({
          lotId: allocation.lotId,
          lotNumber: allocation.lotNumberSnapshot,
          quantity: allocation.quantity,
          unit: allocation.unitSnapshot,
        })),
      },
    });
    appendAuditEvent({
      tx,
      actor,
      id: idFactory(),
      action: "visit.preparation-abandoned",
      entityType: "visit",
      entityId: visit.id,
      entityRevision: visit.revision + 1,
      reason,
      occurredAt,
        metadata: { previousStatus: visit.status, nextStatus, trigger },
    });
  };
  const normalizeFinalizedReference = (reference: unknown): CurrentFinalizationReplayReference => {
    if (!isRecord(reference)) return invalidReplayReference();
    if ("visit" in reference) {
      if (!hasExactlyKeys(reference, [
        "visit", "clinicalNoteId", "clinicalNoteVersion", "medicationDecisionId", "medicationDecisionVersion",
      ])) return invalidReplayReference();
      const visit = visitSummarySchema.safeParse(reference.visit);
      if (
        !visit.success ||
        !isNonEmptyString(reference.clinicalNoteId) ||
        !isPositiveInteger(reference.clinicalNoteVersion) ||
        !isNonEmptyString(reference.medicationDecisionId) ||
        !isPositiveInteger(reference.medicationDecisionVersion)
      ) return invalidReplayReference();
      return {
        visit: visit.data,
        clinicalNoteId: reference.clinicalNoteId,
        clinicalNoteVersion: reference.clinicalNoteVersion,
        medicationDecisionId: reference.medicationDecisionId,
        medicationDecisionVersion: reference.medicationDecisionVersion,
      };
    }
    if (!hasOnlyKeys(reference, [
      "visitId", "visitRevision", "clinicalNoteId", "clinicalNoteVersion", "medicationDecisionId", "medicationDecisionVersion",
    ]) ||
      !isNonEmptyString(reference.visitId) ||
      !isPositiveInteger(reference.visitRevision) ||
      !isNonEmptyString(reference.clinicalNoteId) ||
      !isNonEmptyString(reference.medicationDecisionId) ||
      ("clinicalNoteVersion" in reference && !isPositiveInteger(reference.clinicalNoteVersion)) ||
      ("medicationDecisionVersion" in reference && !isPositiveInteger(reference.medicationDecisionVersion))
    ) return invalidReplayReference();
    const visit = input.visits.getVisitSummary(reference.visitId);
    const clinicalNote = input.notes.getSignedNoteById(reference.clinicalNoteId);
    const medicationDecision = input.medications.getSignedDecisionById(reference.medicationDecisionId);
    if (
      !visit ||
      !clinicalNote ||
      !medicationDecision ||
      clinicalNote.visitId !== reference.visitId ||
      medicationDecision.visitId !== reference.visitId ||
      ("clinicalNoteVersion" in reference && clinicalNote.version !== reference.clinicalNoteVersion) ||
      ("medicationDecisionVersion" in reference && medicationDecision.version !== reference.medicationDecisionVersion)
    ) return invalidReplayReference();
    return {
      visit: {
        id: reference.visitId,
        status: medicationDecision.kind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE",
        revision: reference.visitRevision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      },
      clinicalNoteId: clinicalNote.id,
      clinicalNoteVersion: clinicalNote.version,
      medicationDecisionId: medicationDecision.id,
      medicationDecisionVersion: medicationDecision.version,
    };
  };
  const normalizeDecisionRevisionReference = (reference: unknown): CurrentDecisionRevisionReplayReference => {
    if (!isRecord(reference)) return invalidReplayReference();
    if ("visit" in reference) {
      if (!hasExactlyKeys(reference, ["visit", "medicationDecisionId", "medicationDecisionVersion"])) {
        return invalidReplayReference();
      }
      const visit = visitSummarySchema.safeParse(reference.visit);
      if (
        !visit.success ||
        !isNonEmptyString(reference.medicationDecisionId) ||
        !isPositiveInteger(reference.medicationDecisionVersion)
      ) return invalidReplayReference();
      return {
        visit: visit.data,
        medicationDecisionId: reference.medicationDecisionId,
        medicationDecisionVersion: reference.medicationDecisionVersion,
      };
    }
    if (!hasExactlyKeys(reference, ["visitId", "visitRevision", "medicationDecisionId", "medicationDecisionVersion"]) ||
      !isNonEmptyString(reference.visitId) ||
      !isPositiveInteger(reference.visitRevision) ||
      !isNonEmptyString(reference.medicationDecisionId) ||
      !isPositiveInteger(reference.medicationDecisionVersion)
    ) return invalidReplayReference();
    const visit = input.visits.getVisitSummary(reference.visitId);
    const medicationDecision = input.medications.getSignedDecisionById(reference.medicationDecisionId);
    if (
      !visit ||
      !medicationDecision ||
      medicationDecision.visitId !== reference.visitId ||
      medicationDecision.version !== reference.medicationDecisionVersion
    ) return invalidReplayReference();
    return {
      visit: {
        id: reference.visitId,
        status: medicationDecision.kind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE",
        revision: reference.visitRevision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      },
      medicationDecisionId: medicationDecision.id,
      medicationDecisionVersion: medicationDecision.version,
    };
  };
  return {
    getJourneyEvidence(visitId) {
      const noteDraft = input.notes.getDraft(visitId);
      const medicationDraft = input.medications.getDecisionDraft(visitId);
      return {
        hasDraft: noteDraft !== null,
        hasMedicationDraft: medicationDraft !== null,
        canFinalize: finalizableNoteDraft(noteDraft) && finalizableMedicationDraft(medicationDraft),
        hasSignedNote: input.notes.getSignedNote(visitId) !== null,
      };
    },

    getWorkspace(visitId, actor) {
      if (!hasPermission(actor, "clinical:read")) {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      const base = input.visits.getWorkspaceBase(visitId);
      const allergy = input.patients.getAllergyAssessment(base.patient.id);
      const signedClinicalNote = input.notes.getSignedNote(visitId);
      const medicationDecision = input.medications.getSignedDecision(visitId);
      const hasDispense = input.fulfillment.readHandoffChain(visitId).dispense !== null;
      const recentNotes = input.notes.getRecentSignedNotesForPatient(base.patient.id);
      const recentDecisions = input.medications.getRecentSignedDecisionsForPatient(base.patient.id);
      const latestNote = recentNotes[0] ?? null;
      const latestDecision = recentDecisions[0] ?? null;
      const unknown = { state: "UNKNOWN" as const, value: null, source: null };
      const noteSource = latestNote
        ? { type: "CLINICAL_NOTE" as const, id: latestNote.id, occurredAt: latestNote.signedAt }
        : null;
      const decisionSource = latestDecision
        ? { type: "MEDICATION_DECISION" as const, id: latestDecision.id, occurredAt: latestDecision.signedAt }
        : null;
      return {
        ...base,
        patientSnapshot: {
          allergy,
          activeProblems: latestNote
            ? { state: "VALUE" as const, value: latestNote.diagnoses, source: noteSource! }
            : unknown,
          currentMedicationContext: latestDecision
            ? {
                state: "VALUE" as const,
                value: latestDecision.kind === "ORDER"
                  ? latestDecision.items.map((item) => item.displayName)
                  : [`ไม่สั่งยา: ${latestDecision.noMedicationReason}`],
                source: decisionSource!,
              }
            : unknown,
          latestRelevantPlan: latestNote
            ? { state: "VALUE" as const, value: latestNote.plan, source: noteSource! }
            : unknown,
          pendingFollowUp: unknown,
          recentVisits: recentNotes.map((note) => ({
            visitId: note.visitId, noteId: note.id, signedAt: note.signedAt,
            diagnoses: note.diagnoses, plan: note.plan,
          })),
        },
        consultationDraft: {
          note: input.notes.getDraft(visitId),
          medicationDecision: input.medications.getDecisionDraft(visitId),
        },
        signedClinicalNote,
        amendments: signedClinicalNote ? input.notes.listAmendments(signedClinicalNote.id) : [],
        medicationDecision,
        allowedActions: base.visit.status === "WAITING" ? ["START_CONSULTATION", "REVIEW_ALLERGY"]
          : base.visit.status === "CONSULTING" ? ["SAVE_DRAFT", "FINALIZE_CONSULTATION", "REVIEW_ALLERGY"]
          : hasDispense ? ["AMEND_NOTE"] : ["AMEND_NOTE", "REVISE_MEDICATION_DECISION"],
      };
    },

    reviewAllergy(tx, actor, patientId, body) {
      const visit = input.visits.assertAllergyReviewVisit(tx, actor, patientId, body);
      const { patient, allergy } = input.patients.reviewAllergy(
        tx,
        actor,
        patientId,
        body.expectedRevisions.patient,
        body.payload,
      );
      if (!["AWAITING_PREPARATION", "PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF"].includes(visit.status)) return { patient, allergy, visit };
      const decision = input.medications.getSignedDecision(visit.id);
      if (!decision || decision.kind !== "ORDER") {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "Visit นี้ไม่มีคำสั่งยาที่ต้องทบทวน" });
      }
      releasePreparationReservation(tx, actor, visit, body.payload.reason, "allergy-safety", "AWAITING_ORDER_REVISION");
      input.fulfillment.invalidateCurrentArtifacts(tx, actor, visit.id, "ALLERGY_REVISION", body.payload.reason);
      input.beforeAllergySafetyTransition?.();
      return { patient, allergy, visit: input.visits.transitionAllergySafety(tx, actor, visit, body.payload.reason) };
    },

    amendNote(tx, actor, noteId, body) {
      if (actor.role !== "doctor" || !hasPermission(actor, "clinical:amend")) {
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
      if (tx.select({ id: fulfillmentDispenses.id }).from(fulfillmentDispenses).where(eq(fulfillmentDispenses.visitId, visitId)).get()) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "ไม่สามารถแก้ไขคำสั่งยาได้หลังส่งมอบยาแล้ว" });
      }
      const visit = input.visits.assertDecisionRevisionVisit(
        tx, actor, visitId, body.expectedRevisions.visit, body.expectedRevisions.patient,
      );
      const medicationDecision = input.medications.signDecisionRevision(
        tx, actor, visitId, body.expectedRevisions.medicationDecision,
        body.payload.decision, body.payload.revisionReason,
      );
      input.fulfillment.invalidateCurrentArtifacts(tx, actor, visitId, "ORDER_REVISION", body.payload.revisionReason, medicationDecision.id);
      if (medicationDecision.kind === "ORDER") {
        input.fulfillment.createLabelForSignedOrder(tx, actor, visitId, medicationDecision.id);
      }
      releasePreparationReservation(
        tx,
        actor,
        visit,
        body.payload.revisionReason,
        "medication-revision",
        medicationDecision.kind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE",
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
      // Draft prose is deliberately absent from the idempotency reference. Never replay a newer draft as if it were historical.
      const currentRevisions: Record<string, number> = {};
      if (note.revision !== reference.noteDraftRevision) currentRevisions.noteDraft = note.revision;
      if (medicationDecision.revision !== reference.medicationDraftRevision) {
        currentRevisions.medicationDraft = medicationDecision.revision;
      }
      if (medicationDecision.kind !== reference.medicationDecisionKind) {
        currentRevisions.medicationDraft = medicationDecision.revision;
      }
      if (Object.keys(currentRevisions).length > 0) {
        throw new ApiError({
          code: "REVISION_CONFLICT",
          messageTh: "ข้อมูลร่างสำหรับการเรียกซ้ำถูกแก้ไขแล้ว กรุณาส่งคำสั่งใหม่",
          currentRevisions,
        });
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
      if (medicationDecision.kind === "ORDER") input.fulfillment.createLabelForSignedOrder(tx, actor, visitId, medicationDecision.id);
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
      // Allergy and Visit references are revision tokens; a changed token means the historical response is unavailable.
      const allergy = input.patients.getAllergyAssessment(reference.patientId);
      const currentRevisions: Record<string, number> = {};
      if (patient.revision !== reference.patientRevision) currentRevisions.patient = patient.revision;
      if (allergy.revision !== reference.allergyRevision || allergy.state !== reference.allergyState) {
        currentRevisions.allergy = allergy.revision;
      }
      if (visit.revision !== reference.visitRevision || visit.status !== reference.visitStatus) {
        currentRevisions.visit = visit.revision;
      }
      if (Object.keys(currentRevisions).length > 0) {
        throw new ApiError({
          code: "REVISION_CONFLICT",
          messageTh: "ข้อมูลทบทวนสำหรับการเรียกซ้ำถูกแก้ไขแล้ว กรุณาส่งคำสั่งใหม่",
          currentRevisions,
        });
      }
      return {
        patient,
        allergy,
        visit,
      };
    },

    replayFinalizedConsultation(reference) {
      const normalized = normalizeFinalizedReference(reference);
      const clinicalNote = input.notes.getSignedNoteById(normalized.clinicalNoteId);
      const medicationDecision = input.medications.getSignedDecisionById(normalized.medicationDecisionId);
      if (
        !clinicalNote ||
        !medicationDecision ||
        clinicalNote.visitId !== normalized.visit.id ||
        clinicalNote.version !== normalized.clinicalNoteVersion ||
        medicationDecision.visitId !== normalized.visit.id ||
        medicationDecision.version !== normalized.medicationDecisionVersion
      ) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลที่ลงนามสำหรับการเรียกซ้ำ" });
      }
      return { visit: normalized.visit, clinicalNote, medicationDecision };
    },

    replayAmendment(reference) {
      const amendment = input.notes.getAmendment(reference.clinicalNoteId, reference.amendmentVersion);
      if (!amendment || amendment.id !== reference.amendmentId) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบข้อมูลแก้ไขเพิ่มเติมสำหรับการเรียกซ้ำ" });
      }
      return amendment;
    },

    replayMedicationDecisionRevision(reference) {
      const normalized = normalizeDecisionRevisionReference(reference);
      const medicationDecision = input.medications.getSignedDecisionById(normalized.medicationDecisionId);
      if (
        !medicationDecision ||
        medicationDecision.visitId !== normalized.visit.id ||
        medicationDecision.version !== normalized.medicationDecisionVersion
      ) {
        throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบคำสั่งยาที่แก้ไขสำหรับการเรียกซ้ำ" });
      }
      return { visit: normalized.visit, medicationDecision };
    },
  };
}
