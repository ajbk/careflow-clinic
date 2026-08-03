import { and, asc, eq, or, sql } from "drizzle-orm";
import type { MedicationDto } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import { assertExpectedRevision, type AppTransaction } from "../platform/index.js";
import { medications } from "./schema.js";

const SEARCH_RESULT_LIMIT = 20;

export interface MedicationService {
  searchMedications(query: string): MedicationDto[];
  assertMedicationRevision(
    tx: AppTransaction,
    id: string,
    expectedRevision: number,
  ): MedicationDto;
}

export interface MedicationServiceOptions {
  database: DatabaseHandle;
}

type MedicationRow = typeof medications.$inferSelect;

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

export function createMedicationService(input: MedicationServiceOptions): MedicationService {
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
      const row = tx
        .select()
        .from(medications)
        .where(and(eq(medications.id, id), eq(medications.active, 1)))
        .get();
      if (!row) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบยาสังเคราะห์" });
      assertExpectedRevision(row.revision, expectedRevision, `medication.${id}`);
      return toDto(row);
    },
  };
}
