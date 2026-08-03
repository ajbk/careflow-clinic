import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { PatientDto } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import {
  appendAuditEvent,
  assertExpectedRevision,
  clinicCounters,
  type AppTransaction,
  type AuditAction,
  type AuditedTransaction,
} from "../platform/index.js";
import type { Actor } from "../../../shared/contracts.js";
import { patients } from "./schema.js";

const SYNTHETIC_COUNTER_KEY = "synthetic_patient";
const SYNTHETIC_COUNTER_LIMIT = 999_999;
const SEARCH_RESULT_LIMIT = 20;

export interface PatientService {
  createSyntheticPatient(tx: AppTransaction, actor: Actor): PatientDto;
  searchPatients(query: string): PatientDto[];
  getPatientById(id: string): PatientDto | null;
  getPatientsByIds(ids: readonly string[]): Map<string, PatientDto>;
  assertPatientRevision(tx: AppTransaction, id: string, expected: number): PatientDto;
}

export interface PatientServiceOptions {
  database: DatabaseHandle;
  clock?: () => Date;
}

type PatientRow = typeof patients.$inferSelect;

function toDto(row: PatientRow): PatientDto {
  return {
    id: row.id,
    hn: row.hn,
    displayName: row.displayName,
    phone: row.phone,
    birthDate: row.birthDate,
    sex: row.sex,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function validationError(messageTh: string, field = "q"): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    messageTh,
    fieldErrors: { [field]: messageTh },
  });
}

function assertSearchQuery(query: string): string {
  if (typeof query !== "string") throw validationError("คำค้นหาไม่ถูกต้อง");
  const trimmed = query.trim();
  const length = Array.from(trimmed).length;
  if (length < 2 || length > 80) {
    throw validationError("คำค้นหาต้องมี 2–80 ตัวอักษร");
  }
  return trimmed;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function allocateSyntheticCounter(tx: AppTransaction): number {
  const allocated = tx
    .update(clinicCounters)
    .set({ value: sql`${clinicCounters.value} + 1` })
    .where(
      and(
        eq(clinicCounters.key, SYNTHETIC_COUNTER_KEY),
        lt(clinicCounters.value, SYNTHETIC_COUNTER_LIMIT),
      ),
    )
    .returning({ value: clinicCounters.value })
    .get();

  if (!allocated) {
    throw new ApiError({
      code: "SYNTHETIC_ID_EXHAUSTED",
      messageTh: "รหัสผู้ป่วยสังเคราะห์เต็มแล้ว ไม่สามารถสร้างรายการใหม่ได้",
    });
  }
  return allocated.value;
}

export function createPatientService(input: PatientServiceOptions): PatientService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = () => randomUUID();

  const service: PatientService = {
    createSyntheticPatient(tx, actor) {
      const counter = allocateSyntheticCounter(tx);
      const sixDigitCode = String(counter).padStart(6, "0");
      const fourDigitSuffix = String(counter % 10_000).padStart(4, "0");
      const now = clock().toISOString();
      const id = idFactory();
      const hn = `DEMO-${sixDigitCode}`;
      const displayName = `ผู้ป่วยทดสอบ ${sixDigitCode}`;
      const phone = `000000${fourDigitSuffix}`;

      tx.insert(patients)
        .values({
          id,
          clinicId: "clinic",
          hn,
          displayName,
          phone,
          birthDate: "1990-01-01",
          sex: "unknown",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const action: AuditAction = "patient.synthetic-created";
      appendAuditEvent({
        tx: tx as AuditedTransaction,
        actor,
        id: idFactory(),
        action,
        entityType: "patient",
        entityId: id,
        entityRevision: 1,
        reason: null,
        occurredAt: now,
        metadata: { hn },
      });

      return { id, hn, displayName, phone, birthDate: "1990-01-01", sex: "unknown", revision: 1, createdAt: now };
    },

    searchPatients(query) {
      const trimmed = assertSearchQuery(query);
      const pattern = `%${escapeLike(trimmed)}%`;
      const rows = input.database.db
        .select()
        .from(patients)
        .where(
          and(
            eq(patients.clinicId, "clinic"),
            or(
              sql`${patients.hn} LIKE ${pattern} ESCAPE '\\'`,
              sql`${patients.displayName} LIKE ${pattern} ESCAPE '\\'`,
              sql`${patients.phone} LIKE ${pattern} ESCAPE '\\'`,
            ),
          ),
        )
        .orderBy(desc(patients.createdAt), desc(patients.hn))
        .limit(SEARCH_RESULT_LIMIT)
        .all();
      return rows.map(toDto);
    },

    getPatientById(id) {
      const row = input.database.db
        .select()
        .from(patients)
        .where(and(eq(patients.id, id), eq(patients.clinicId, "clinic")))
        .get();
      return row ? toDto(row) : null;
    },

    getPatientsByIds(ids) {
      const uniqueIds = [...new Set(ids)];
      const result = new Map<string, PatientDto>();
      for (let offset = 0; offset < uniqueIds.length; offset += 100) {
        const batch = uniqueIds.slice(offset, offset + 100);
        const rows = input.database.db
          .select()
          .from(patients)
          .where(and(eq(patients.clinicId, "clinic"), inArray(patients.id, batch)))
          .all();
        for (const row of rows) result.set(row.id, toDto(row));
      }
      return result;
    },

    assertPatientRevision(tx, id, expected) {
      const row = tx
        .select()
        .from(patients)
        .where(and(eq(patients.id, id), eq(patients.clinicId, "clinic")))
        .get();
      if (!row) {
        throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบผู้ป่วยสังเคราะห์" });
      }
      assertExpectedRevision(row.revision, expected, "patient");
      return toDto(row);
    },
  };

  return service;
}
