import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Actor, ClinicalNoteDraftDto, ClinicalNoteDraftInput } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { assertExpectedRevision, type AppDatabase, type AppTransaction, type AuditedTransaction } from "../platform/index.js";
import { staffAccounts } from "../platform/index.js";
import { clinicalNoteDraftDiagnoses, clinicalNoteDrafts } from "./schema.js";

export interface NoteService {
  getDraft(visitId: string): ClinicalNoteDraftDto | null;
  saveDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
    input: ClinicalNoteDraftInput,
  ): ClinicalNoteDraftDto;
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
  };
}
