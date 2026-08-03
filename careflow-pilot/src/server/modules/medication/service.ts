import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type {
  Actor,
  MedicationDecisionDraftDto,
  MedicationDecisionDraftInput,
  MedicationDto,
} from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import {
  assertExpectedRevision,
  staffAccounts,
  type AppDatabase,
  type AppTransaction,
  type AuditedTransaction,
} from "../platform/index.js";
import { medicationDecisionDrafts, medicationOrderDraftItems, medications } from "./schema.js";

const SEARCH_RESULT_LIMIT = 20;

export interface MedicationService {
  searchMedications(query: string): MedicationDto[];
  assertMedicationRevision(
    tx: AppTransaction,
    id: string,
    expectedRevision: number,
  ): MedicationDto;
  getDecisionDraft(visitId: string): MedicationDecisionDraftDto | null;
  saveDecisionDraft(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
    input: MedicationDecisionDraftInput,
  ): MedicationDecisionDraftDto;
}

export interface MedicationServiceOptions {
  database: DatabaseHandle;
  clock?: () => Date;
  idFactory?: () => string;
}

type MedicationRow = typeof medications.$inferSelect;
type DecisionDraftRow = typeof medicationDecisionDrafts.$inferSelect;
type MedicationTransaction = AppDatabase | AppTransaction;

function toDto(row: MedicationRow): MedicationDto {
  return {
    id: row.id,
    displayName: row.displayName,
    strengthText: row.strengthText,
    dosageFormText: row.dosageFormText,
    canonicalUnit: row.canonicalUnit,
    revision: row.revision,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function assertSearchQuery(query: string): string {
  if (typeof query !== "string") {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "คำค้นหาไม่ถูกต้อง",
      fieldErrors: { q: "คำค้นหาไม่ถูกต้อง" },
    });
  }
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < 2 || length > 80) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "คำค้นหาต้องมี 2–80 ตัวอักษร",
      fieldErrors: { q: "คำค้นหาต้องมี 2–80 ตัวอักษร" },
    });
  }
  return trimmed;
}

function toDecisionDraftDto(tx: MedicationTransaction, row: DecisionDraftRow): MedicationDecisionDraftDto {
  const updatedBy = tx.select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
    .from(staffAccounts)
    .where(eq(staffAccounts.id, row.updatedBy))
    .get();
  if (!updatedBy) throw new Error("Medication decision draft updater is missing");
  const base = {
    id: row.id,
    visitId: row.visitId,
    revision: row.revision,
    updatedBy,
    updatedAt: row.updatedAt,
  };
  if (row.kind === "UNDECIDED") {
    return { ...base, kind: "UNDECIDED", noMedicationReason: null, items: [] };
  }
  if (row.kind === "NO_MEDICATION") {
    return {
      ...base,
      kind: "NO_MEDICATION",
      noMedicationReason: row.noMedicationReason ?? "",
      items: [],
    };
  }
  const items = tx.select({
    medication: medications,
    quantity: medicationOrderDraftItems.quantity,
    directionsTh: medicationOrderDraftItems.directionsTh,
  })
    .from(medicationOrderDraftItems)
    .innerJoin(medications, eq(medicationOrderDraftItems.medicationId, medications.id))
    .where(eq(medicationOrderDraftItems.decisionDraftId, row.id))
    .orderBy(asc(medicationOrderDraftItems.position))
    .all()
    .map((item) => ({ medication: toDto(item.medication), quantity: item.quantity, directionsTh: item.directionsTh }));
  return { ...base, kind: "ORDER", noMedicationReason: null, items };
}

export function createMedicationService(input: MedicationServiceOptions): MedicationService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  const assertMedicationRevision = (
    tx: AppTransaction,
    id: string,
    expectedRevision: number,
  ): MedicationDto => {
    const row = tx
      .select()
      .from(medications)
      .where(and(eq(medications.id, id), eq(medications.active, 1)))
      .get();
    if (!row) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบยาสังเคราะห์" });
    assertExpectedRevision(row.revision, expectedRevision, `medication.${id}`);
    return toDto(row);
  };
  return {
    searchMedications(query) {
      const pattern = `%${escapeLike(assertSearchQuery(query))}%`;
      const rows = input.database.db
        .select()
        .from(medications)
        .where(and(
          eq(medications.active, 1),
          or(
            sql`${medications.id} LIKE ${pattern} ESCAPE '\\'`,
            sql`${medications.displayName} LIKE ${pattern} ESCAPE '\\'`,
            sql`${medications.strengthText} LIKE ${pattern} ESCAPE '\\'`,
            sql`${medications.dosageFormText} LIKE ${pattern} ESCAPE '\\'`,
          ),
        ))
        .orderBy(asc(medications.displayName), asc(medications.id))
        .limit(SEARCH_RESULT_LIMIT)
        .all();
      return rows.map(toDto);
    },

    assertMedicationRevision(tx, id, expectedRevision) {
      return assertMedicationRevision(tx, id, expectedRevision);
    },

    getDecisionDraft(visitId) {
      const row = input.database.db.select().from(medicationDecisionDrafts)
        .where(eq(medicationDecisionDrafts.visitId, visitId))
        .get();
      return row ? toDecisionDraftDto(input.database.db, row) : null;
    },

    saveDecisionDraft(tx, actor, visitId, expectedRevision, decision) {
      const current = tx.select().from(medicationDecisionDrafts)
        .where(eq(medicationDecisionDrafts.visitId, visitId))
        .get();
      assertExpectedRevision(current?.revision ?? 0, expectedRevision, "medicationDraft");
      const catalogItems = decision.kind === "ORDER"
        ? decision.items.map((item) => ({
          ...item,
          medication: assertMedicationRevision(tx, item.medicationId, item.medicationRevision),
        }))
        : [];
      const now = clock().toISOString();
      const id = current?.id ?? idFactory();
      const noMedicationReason = decision.kind === "NO_MEDICATION" ? decision.noMedicationReason : null;
      if (current) {
        const changed = tx.update(medicationDecisionDrafts)
          .set({
            revision: current.revision + 1,
            kind: decision.kind,
            noMedicationReason,
            updatedBy: actor.id,
            updatedAt: now,
          })
          .where(and(
            eq(medicationDecisionDrafts.id, current.id),
            eq(medicationDecisionDrafts.revision, expectedRevision),
          ))
          .run();
        if (changed.changes !== 1) {
          const latest = tx.select().from(medicationDecisionDrafts)
            .where(eq(medicationDecisionDrafts.visitId, visitId)).get();
          assertExpectedRevision(latest?.revision ?? 0, expectedRevision, "medicationDraft");
          throw new Error("Medication decision draft revision update failed");
        }
      } else {
        tx.insert(medicationDecisionDrafts).values({
          id,
          visitId,
          revision: 1,
          kind: decision.kind,
          noMedicationReason,
          createdBy: actor.id,
          updatedBy: actor.id,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
      tx.delete(medicationOrderDraftItems).where(eq(medicationOrderDraftItems.decisionDraftId, id)).run();
      if (catalogItems.length > 0) {
        tx.insert(medicationOrderDraftItems).values(catalogItems.map((item, position) => ({
          id: idFactory(),
          decisionDraftId: id,
          position,
          medicationId: item.medication.id,
          medicationRevision: item.medication.revision,
          quantity: item.quantity,
          directionsTh: item.directionsTh,
        }))).run();
      }
      const saved = tx.select().from(medicationDecisionDrafts).where(eq(medicationDecisionDrafts.id, id)).get();
      if (!saved) throw new Error("Medication decision draft save failed");
      return toDecisionDraftDto(tx, saved);
    },
  };
}
