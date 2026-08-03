import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  Actor,
  ClinicalNoteAmendmentDto,
  ClinicalNoteDraftDto,
  ClinicalNoteDraftInput,
  SignedClinicalNoteDto,
} from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import {
  appendAuditEvent,
  assertExpectedRevision,
  hashEvidence,
  staffAccounts,
  type AppDatabase,
  type AppTransaction,
  type AuditedTransaction,
} from "../platform/index.js";
import { clinicalNoteAmendments, clinicalNoteDiagnoses, clinicalNoteDraftDiagnoses, clinicalNoteDrafts, clinicalNotes } from "./schema.js";

export interface NoteService {
  getDraft(visitId: string): ClinicalNoteDraftDto | null;
  getSignedNote(visitId: string): SignedClinicalNoteDto | null;
  getAmendment(clinicalNoteId: string, version: number): ClinicalNoteAmendmentDto | null;
  saveDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
    input: ClinicalNoteDraftInput,
  ): ClinicalNoteDraftDto;
  signDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedDraftRevision: number,
  ): SignedClinicalNoteDto;
  signAmendment(
    tx: AuditedTransaction,
    actor: Actor,
    noteId: string,
    expectedAmendmentVersion: number,
    content: string,
    reason: string,
  ): ClinicalNoteAmendmentDto;
}

export interface NoteServiceOptions {
  database: DatabaseHandle;
  clock?: () => Date;
  idFactory?: () => string;
}

type NoteDraftRow = typeof clinicalNoteDrafts.$inferSelect;
type NoteTransaction = AppDatabase | AppTransaction;

function toDto(tx: NoteTransaction, row: NoteDraftRow): ClinicalNoteDraftDto {
  const updatedBy = tx.select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
    .from(staffAccounts)
    .where(eq(staffAccounts.id, row.updatedBy))
    .get();
  if (!updatedBy) throw new Error("Clinical note draft updater is missing");
  const diagnoses = tx.select({ diagnosisText: clinicalNoteDraftDiagnoses.diagnosisText })
    .from(clinicalNoteDraftDiagnoses)
    .where(eq(clinicalNoteDraftDiagnoses.draftId, row.id))
    .orderBy(asc(clinicalNoteDraftDiagnoses.position))
    .all()
    .map((diagnosis) => diagnosis.diagnosisText);
  return {
    id: row.id,
    visitId: row.visitId,
    revision: row.revision,
    subjective: row.subjective,
    objective: row.objective,
    assessment: row.assessment,
    plan: row.plan,
    diagnoses,
    updatedBy,
    updatedAt: row.updatedAt,
  };
}

function completeText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "ร่างบันทึกยังไม่ครบถ้วน",
      fieldErrors: { [field]: "ต้องระบุข้อมูลก่อนลงนาม" },
    });
  }
  return trimmed;
}

export function createNoteService(options: NoteServiceOptions): NoteService {
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;

  return {
    getDraft(visitId) {
      const row = options.database.db.select().from(clinicalNoteDrafts)
        .where(eq(clinicalNoteDrafts.visitId, visitId))
        .get();
      return row ? toDto(options.database.db, row) : null;
    },

    getSignedNote(visitId) {
      const note = options.database.db.select().from(clinicalNotes)
        .where(eq(clinicalNotes.visitId, visitId)).get();
      if (!note) return null;
      const diagnoses = options.database.db.select({ diagnosisText: clinicalNoteDiagnoses.diagnosisText })
        .from(clinicalNoteDiagnoses).where(eq(clinicalNoteDiagnoses.clinicalNoteId, note.id))
        .orderBy(asc(clinicalNoteDiagnoses.position)).all().map((row) => row.diagnosisText);
      return {
        id: note.id, visitId: note.visitId, version: note.version,
        subjective: note.subjective, objective: note.objective, assessment: note.assessment, plan: note.plan,
        diagnoses, sourceDraftRevision: note.sourceDraftRevision, revisionReason: null, supersedesId: null,
        signedBy: { id: note.signedBy, displayName: note.signedByDisplayName },
        signedAt: note.signedAt, contentHash: note.contentHash,
      };
    },

    getAmendment(clinicalNoteId, version) {
      const amendment = options.database.db.select().from(clinicalNoteAmendments)
        .where(and(
          eq(clinicalNoteAmendments.clinicalNoteId, clinicalNoteId),
          eq(clinicalNoteAmendments.version, version),
        )).get();
      if (!amendment) return null;
      return {
        id: amendment.id,
        clinicalNoteId: amendment.clinicalNoteId,
        version: amendment.version,
        content: amendment.content,
        reason: amendment.reason,
        signedBy: { id: amendment.signedBy, displayName: amendment.signedByDisplayName },
        signedAt: amendment.signedAt,
        contentHash: amendment.contentHash,
      };
    },

    saveDraft(tx, actor, visitId, expectedRevision, input) {
      const current = tx.select().from(clinicalNoteDrafts)
        .where(eq(clinicalNoteDrafts.visitId, visitId))
        .get();
      assertExpectedRevision(current?.revision ?? 0, expectedRevision, "noteDraft");
      const now = clock().toISOString();
      const id = current?.id ?? idFactory();
      if (current) {
        const changed = tx.update(clinicalNoteDrafts)
          .set({
            revision: current.revision + 1,
            subjective: input.subjective,
            objective: input.objective,
            assessment: input.assessment,
            plan: input.plan,
            updatedBy: actor.id,
            updatedAt: now,
          })
          .where(and(eq(clinicalNoteDrafts.id, current.id), eq(clinicalNoteDrafts.revision, expectedRevision)))
          .run();
        if (changed.changes !== 1) {
          const latest = tx.select().from(clinicalNoteDrafts)
            .where(eq(clinicalNoteDrafts.visitId, visitId)).get();
          assertExpectedRevision(latest?.revision ?? 0, expectedRevision, "noteDraft");
          throw new Error("Clinical note draft revision update failed");
        }
      } else {
        tx.insert(clinicalNoteDrafts).values({
          id,
          visitId,
          revision: 1,
          subjective: input.subjective,
          objective: input.objective,
          assessment: input.assessment,
          plan: input.plan,
          createdBy: actor.id,
          updatedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
      tx.delete(clinicalNoteDraftDiagnoses).where(eq(clinicalNoteDraftDiagnoses.draftId, id)).run();
      if (input.diagnoses.length > 0) {
        tx.insert(clinicalNoteDraftDiagnoses).values(input.diagnoses.map((diagnosisText, position) => ({
          id: idFactory(), draftId: id, position, diagnosisText,
        }))).run();
      }
      const saved = tx.select().from(clinicalNoteDrafts).where(eq(clinicalNoteDrafts.id, id)).get();
      if (!saved) throw new Error("Clinical note draft save failed");
      return toDto(tx, saved);
    },

    signDraft(tx, actor, visitId, expectedDraftRevision) {
      const draft = tx.select().from(clinicalNoteDrafts)
        .where(eq(clinicalNoteDrafts.visitId, visitId)).get();
      assertExpectedRevision(draft?.revision ?? 0, expectedDraftRevision, "noteDraft");
      if (!draft) throw new Error("Clinical note draft revision assertion did not fail");
      const subjective = completeText(draft.subjective, "noteDraft.subjective");
      const objective = completeText(draft.objective, "noteDraft.objective");
      const assessment = completeText(draft.assessment, "noteDraft.assessment");
      const plan = completeText(draft.plan, "noteDraft.plan");
      const diagnoses = tx.select({ diagnosisText: clinicalNoteDraftDiagnoses.diagnosisText })
        .from(clinicalNoteDraftDiagnoses)
        .where(eq(clinicalNoteDraftDiagnoses.draftId, draft.id))
        .orderBy(asc(clinicalNoteDraftDiagnoses.position))
        .all()
        .map((row) => completeText(row.diagnosisText, "noteDraft.diagnoses"));
      if (diagnoses.length === 0 || diagnoses.length > 20) {
        throw new ApiError({
          code: "VALIDATION_FAILED",
          messageTh: "ร่างบันทึกยังไม่ครบถ้วน",
          fieldErrors: { "noteDraft.diagnoses": "ต้องระบุการวินิจฉัย 1–20 รายการก่อนลงนาม" },
        });
      }
      const prior = tx.select({ id: clinicalNotes.id }).from(clinicalNotes)
        .where(eq(clinicalNotes.visitId, visitId)).get();
      if (prior) throw new ApiError({ code: "INVALID_STATE", messageTh: "Visit นี้มีบันทึกที่ลงนามแล้ว" });
      const id = idFactory();
      const signedAt = clock().toISOString();
      const evidence = {
        id,
        visitId,
        version: 1,
        subjective,
        objective,
        assessment,
        plan,
        diagnoses,
        sourceDraftRevision: draft.revision,
        revisionReason: null,
        supersedesId: null,
        signedBy: { id: actor.id, displayName: actor.displayName },
        signedAt,
      } as const;
      const signed: SignedClinicalNoteDto = { ...evidence, contentHash: hashEvidence(evidence) };
      tx.insert(clinicalNotes).values({
        id: signed.id,
        visitId: signed.visitId,
        version: signed.version,
        subjective: signed.subjective,
        objective: signed.objective,
        assessment: signed.assessment,
        plan: signed.plan,
        sourceDraftRevision: signed.sourceDraftRevision,
        signedBy: actor.id,
        signedByDisplayName: actor.displayName,
        signedAt: signed.signedAt,
        contentHash: signed.contentHash,
      }).run();
      tx.insert(clinicalNoteDiagnoses).values(signed.diagnoses.map((diagnosisText, position) => ({
        id: idFactory(), clinicalNoteId: signed.id, position, diagnosisText,
      }))).run();
      appendAuditEvent({
        tx, actor, id: idFactory(), action: "note.signed", entityType: "clinical_note",
        entityId: signed.id, entityRevision: signed.version, reason: null, occurredAt: signed.signedAt,
      });
      return signed;
    },

    signAmendment(tx, actor, noteId, expectedAmendmentVersion, content, reason) {
      const note = tx.select({ id: clinicalNotes.id }).from(clinicalNotes)
        .where(eq(clinicalNotes.id, noteId)).get();
      if (!note) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบบันทึกที่ลงนาม" });
      const currentVersion = tx.select({ maximum: sql<number>`coalesce(max(${clinicalNoteAmendments.version}), 0)` })
        .from(clinicalNoteAmendments)
        .where(eq(clinicalNoteAmendments.clinicalNoteId, noteId))
        .get()?.maximum ?? 0;
      assertExpectedRevision(currentVersion, expectedAmendmentVersion, "amendment");
      const signedAt = clock().toISOString();
      const evidence = {
        id: idFactory(),
        clinicalNoteId: noteId,
        version: currentVersion + 1,
        content: completeText(content, "amendment.content"),
        reason: completeText(reason, "amendment.reason"),
        signedBy: { id: actor.id, displayName: actor.displayName },
        signedAt,
      } as const;
      const amendment: ClinicalNoteAmendmentDto = { ...evidence, contentHash: hashEvidence(evidence) };
      tx.insert(clinicalNoteAmendments).values({
        id: amendment.id,
        clinicalNoteId: amendment.clinicalNoteId,
        version: amendment.version,
        content: amendment.content,
        reason: amendment.reason,
        signedBy: actor.id,
        signedByDisplayName: actor.displayName,
        signedAt: amendment.signedAt,
        contentHash: amendment.contentHash,
      }).run();
      appendAuditEvent({
        tx, actor, id: idFactory(), action: "note.amendment-signed", entityType: "clinical_note_amendment",
        entityId: amendment.id, entityRevision: amendment.version, reason: amendment.reason,
        occurredAt: amendment.signedAt, metadata: { clinicalNoteId: noteId },
      });
      return amendment;
    },
  };
}
