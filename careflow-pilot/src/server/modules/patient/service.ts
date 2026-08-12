import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type {
  AllergyAssessmentDto,
  Actor,
  IntakeAllergyAnswer,
  PatientAllergyContextDto,
  PatientDto,
  ReviewAllergyPayload,
} from "../../../shared/contracts.js";
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
import { staffAccounts } from "../platform/index.js";
import { patientAllergyItems, patientAllergyRevisions, patients } from "./schema.js";

const SYNTHETIC_COUNTER_KEY = "synthetic_patient";
const SYNTHETIC_COUNTER_LIMIT = 999_999;
const SEARCH_RESULT_LIMIT = 20;

export type IntakeWriteStage =
  | "AFTER_VISIT_INSERT"
  | "AFTER_OBSERVATION_INSERT"
  | "AFTER_ALLERGY_INSERT"
  | "AFTER_PATIENT_REVISION"
  | "AFTER_ALLERGY_AUDIT"
  | "AFTER_INTAKE_AUDIT";

export interface PatientService {
  createSyntheticPatient(tx: AppTransaction, actor: Actor): PatientDto;
  searchPatients(query: string): PatientDto[];
  getPatientById(id: string): PatientDto | null;
  getPatientsByIds(ids: readonly string[]): Map<string, PatientDto>;
  assertPatientRevision(tx: AppTransaction, id: string, expected: number): PatientDto;
  getAllergyAssessment(patientId: string): AllergyAssessmentDto;
  getAllergyAssessments(patientIds: readonly string[]): Map<string, AllergyAssessmentDto>;
  getAllergyContext(patientId: string): PatientAllergyContextDto;
  recordIntakeAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    input: {
      patientId: string;
      visitId: string;
      expectedPatientRevision: number;
      answer: IntakeAllergyAnswer;
      occurredAt: string;
      afterWrite?: (stage: IntakeWriteStage) => void;
    },
  ): PatientAllergyContextDto;
  assertResolvedAllergy(tx: AppTransaction, patientId: string): AllergyAssessmentDto;
  reviewAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    patientId: string,
    expectedPatientRevision: number,
    payload: ReviewAllergyPayload,
  ): { patient: PatientDto; allergy: AllergyAssessmentDto };
}

export interface PatientServiceOptions {
  database: DatabaseHandle;
  clock?: () => Date;
}

type PatientRow = typeof patients.$inferSelect;
type AllergyRevisionRow = typeof patientAllergyRevisions.$inferSelect;

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

function initialAllergyAssessment(): AllergyAssessmentDto {
  return {
    id: null,
    revision: 0,
    state: "UNKNOWN",
    items: [],
    sourceText: null,
    reason: null,
    reviewedBy: null,
    reviewedAt: null,
  };
}

function readAllergyAssessment(
  database: DatabaseHandle["db"] | AppTransaction,
  patientId: string,
): AllergyAssessmentDto {
  const revision = database
    .select({
      id: patientAllergyRevisions.id,
      revision: patientAllergyRevisions.revision,
      state: patientAllergyRevisions.state,
      sourceText: patientAllergyRevisions.sourceText,
      reason: patientAllergyRevisions.reason,
      reviewedAt: patientAllergyRevisions.reviewedAt,
      reviewedById: staffAccounts.id,
      reviewedByDisplayName: staffAccounts.displayName,
    })
    .from(patientAllergyRevisions)
    .innerJoin(staffAccounts, eq(staffAccounts.id, patientAllergyRevisions.reviewedBy))
    .where(and(eq(patientAllergyRevisions.patientId, patientId), eq(staffAccounts.clinicId, "clinic")))
    .orderBy(desc(patientAllergyRevisions.revision))
    .limit(1)
    .get();
  if (!revision) return initialAllergyAssessment();

  const items = database
    .select({
      substance: patientAllergyItems.substance,
      reaction: patientAllergyItems.reaction,
      severity: patientAllergyItems.severity,
      note: patientAllergyItems.note,
    })
    .from(patientAllergyItems)
    .where(eq(patientAllergyItems.allergyRevisionId, revision.id))
    .orderBy(asc(patientAllergyItems.position))
    .all();
  return {
    id: revision.id,
    revision: revision.revision,
    state: revision.state,
    items,
    sourceText: revision.sourceText,
    reason: revision.reason,
    reviewedBy: { id: revision.reviewedById, displayName: revision.reviewedByDisplayName },
    reviewedAt: revision.reviewedAt,
  };
}

function toAllergyAssessment(
  tx: AppTransaction,
  row: AllergyRevisionRow,
): AllergyAssessmentDto {
  const reviewer = tx
    .select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
    .from(staffAccounts)
    .where(and(eq(staffAccounts.id, row.reviewedBy), eq(staffAccounts.clinicId, "clinic")))
    .get();
  if (!reviewer) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบผู้ทบทวนข้อมูลแพ้" });
  const items = tx
    .select({
      substance: patientAllergyItems.substance,
      reaction: patientAllergyItems.reaction,
      severity: patientAllergyItems.severity,
      note: patientAllergyItems.note,
    })
    .from(patientAllergyItems)
    .where(eq(patientAllergyItems.allergyRevisionId, row.id))
    .orderBy(asc(patientAllergyItems.position))
    .all();
  return {
    id: row.id,
    revision: row.revision,
    state: row.state,
    items,
    sourceText: row.sourceText,
    reason: row.reason,
    reviewedBy: reviewer,
    reviewedAt: row.reviewedAt,
  };
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

  const appendAllergyRevision = (value: {
    tx: AuditedTransaction;
    actor: Actor;
    patientId: string;
    expectedPatientRevision: number;
    previous?: AllergyAssessmentDto;
    state: AllergyAssessmentDto["state"];
    items: ReviewAllergyPayload["items"];
    sourceText: string;
    reason: string;
    visitId: string;
    occurredAt: string;
    afterWrite?: (stage: IntakeWriteStage) => void;
  }): PatientAllergyContextDto => {
    const previous = value.previous ?? readAllergyAssessment(value.tx, value.patientId);
    const currentPatient = value.tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, value.patientId), eq(patients.clinicId, "clinic")))
      .get();
    if (!currentPatient) {
      throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบผู้ป่วยสังเคราะห์" });
    }
    assertExpectedRevision(currentPatient.revision, value.expectedPatientRevision, "patient");

    const allergyRevision = previous.revision + 1;
    const allergyRevisionId = idFactory();
    value.tx.insert(patientAllergyRevisions)
      .values({
        id: allergyRevisionId,
        patientId: value.patientId,
        revision: allergyRevision,
        state: value.state,
        sourceText: value.sourceText,
        reason: value.reason,
        reviewedBy: value.actor.id,
        reviewedAt: value.occurredAt,
      })
      .run();
    if (value.items.length > 0) {
      value.tx.insert(patientAllergyItems)
        .values(value.items.map((item, position) => ({
          id: idFactory(),
          allergyRevisionId,
          position,
          substance: item.substance,
          reaction: item.reaction,
          severity: item.severity,
          note: item.note,
        })))
        .run();
    }
    value.afterWrite?.("AFTER_ALLERGY_INSERT");

    const nextPatientRevision = value.expectedPatientRevision + 1;
    const updated = value.tx.update(patients)
      .set({ revision: nextPatientRevision, updatedAt: value.occurredAt })
      .where(and(
        eq(patients.id, value.patientId),
        eq(patients.clinicId, "clinic"),
        eq(patients.revision, value.expectedPatientRevision),
      ))
      .run();
    if (updated.changes !== 1) {
      const latest = value.tx
        .select()
        .from(patients)
        .where(and(eq(patients.id, value.patientId), eq(patients.clinicId, "clinic")))
        .get();
      if (!latest) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบผู้ป่วยสังเคราะห์" });
      assertExpectedRevision(latest.revision, value.expectedPatientRevision, "patient");
      throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "อัปเดตข้อมูลแพ้ไม่สำเร็จ" });
    }
    value.afterWrite?.("AFTER_PATIENT_REVISION");

    const patient = value.tx
      .select()
      .from(patients)
      .where(and(eq(patients.id, value.patientId), eq(patients.clinicId, "clinic")))
      .get();
    const created = value.tx
      .select()
      .from(patientAllergyRevisions)
      .where(eq(patientAllergyRevisions.id, allergyRevisionId))
      .get();
    if (!patient || !created) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "บันทึกข้อมูลแพ้ไม่สำเร็จ" });

    appendAuditEvent({
      tx: value.tx,
      actor: value.actor,
      id: idFactory(),
      action: "allergy.updated",
      entityType: "patient",
      entityId: value.patientId,
      entityRevision: nextPatientRevision,
      reason: value.reason,
      occurredAt: value.occurredAt,
      metadata: {
        visitId: value.visitId,
        previousState: previous.state,
        state: value.state,
        allergyRevisionId,
        allergyRevision,
        itemCount: value.items.length,
      },
    });
    value.afterWrite?.("AFTER_ALLERGY_AUDIT");

    return { patient: toDto(patient), allergy: toAllergyAssessment(value.tx, created) };
  };

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

    getAllergyAssessment(patientId) {
      return readAllergyAssessment(input.database.db, patientId);
    },

    getAllergyAssessments(patientIds) {
      return new Map(patientIds.map((patientId) => [patientId, readAllergyAssessment(input.database.db, patientId)]));
    },

    getAllergyContext(patientId) {
      const patient = service.getPatientById(patientId);
      if (!patient) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบผู้ป่วยสังเคราะห์" });
      return { patient, allergy: service.getAllergyAssessment(patientId) };
    },

    recordIntakeAllergy(tx, actor, record) {
      service.assertPatientRevision(tx, record.patientId, record.expectedPatientRevision);
      const previous = readAllergyAssessment(tx, record.patientId);
      const state = record.answer.answer === "YES" ? "PRESENT" : "NONE_KNOWN";
      const suppliedReason = record.answer.changeReason?.trim() ?? "";
      const changedResolvedState = previous.state !== "UNKNOWN" && previous.state !== state;
      if (changedResolvedState && suppliedReason.length === 0) {
        throw new ApiError({
          code: "VALIDATION_FAILED",
          messageTh: "กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน",
          fieldErrors: {
            "payload.allergy.changeReason": "กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน",
          },
        });
      }
      const reason = suppliedReason || "ทบทวนก่อนส่งเข้าคิว";
      return appendAllergyRevision({
        tx,
        actor,
        patientId: record.patientId,
        expectedPatientRevision: record.expectedPatientRevision,
        previous,
        state,
        items: record.answer.items,
        sourceText: "ผู้ป่วยตอบระหว่าง Intake",
        reason,
        visitId: record.visitId,
        occurredAt: record.occurredAt,
        afterWrite: record.afterWrite,
      });
    },

    assertResolvedAllergy(tx, patientId) {
      const patient = tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.clinicId, "clinic")))
        .get();
      if (!patient) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบผู้ป่วยสังเคราะห์" });
      const allergy = readAllergyAssessment(tx, patientId);
      if (allergy.state === "UNKNOWN") {
        throw new ApiError({
          code: "INVALID_STATE",
          messageTh: "ยังลงนามไม่ได้ กรุณาทบทวนประวัติแพ้ยาก่อน",
        });
      }
      return allergy;
    },

    reviewAllergy(tx, actor, patientId, expectedPatientRevision, payload) {
      return appendAllergyRevision({
        tx,
        actor,
        patientId,
        expectedPatientRevision,
        state: payload.state,
        items: payload.items,
        sourceText: payload.sourceText,
        reason: payload.reason,
        visitId: payload.visitId,
        occurredAt: clock().toISOString(),
      });
    },
  };

  return service;
}
