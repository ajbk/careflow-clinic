import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { visitStatusSchema } from "../../../shared/contracts.js";
import type {
  Actor,
  IntakePayload,
  QueueItemDto,
  ReviewAllergyBody,
  StartConsultationBody,
  SubmitIntakeBody,
  VisitSummaryDto,
  VisitWorkspaceDto,
  SignedMedicationDecisionDto,
} from "../../../shared/contracts.js";
import type { PatientDto } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import {
  appendAuditEvent,
  assertExpectedRevision,
  hasPermission,
  type AppTransaction,
  type AuditedTransaction,
  type AuditEventInput,
  staffAccounts,
} from "../platform/index.js";
import { intakeObservations, visits } from "./schema.js";

export interface VisitPatientReader {
  assertPatientRevision(tx: AppTransaction, id: string, expected: number): PatientDto;
  getPatientById(id: string): PatientDto | null;
  getPatientsByIds(ids: readonly string[]): Map<string, PatientDto>;
}

export interface VisitServiceOptions {
  database: DatabaseHandle;
  patients: VisitPatientReader;
  clock?: () => Date;
  idFactory?: () => string;
  appendAudit?: (input: AuditEventInput) => void;
}

export interface VisitService {
  submitIntake(tx: AuditedTransaction, actor: Actor, body: SubmitIntakeBody): QueueItemDto;
  listQueue(actor: Actor): QueueItemDto[];
  getDashboardToday(): { waiting: number; consulting: number; updatedAt: string };
  getVisitSummary(visitId: string): VisitSummaryDto | null;
  getWorkspace(visitId: string, actor: Actor): VisitWorkspaceDto;
  startConsultation(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    body: StartConsultationBody,
  ): QueueItemDto;
  assertAllergyReviewVisit(
    tx: AuditedTransaction,
    actor: Actor,
    patientId: string,
    body: ReviewAllergyBody,
  ): VisitSummaryDto;
  assertConsultationDraftVisit(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
  ): VisitSummaryDto;
  assertFinalizeConsultationVisit(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
    expectedPatientRevision: number,
  ): VisitSummaryDto;
  finalizeConsultation(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedRevision: number,
    decisionKind: SignedMedicationDecisionDto["kind"],
  ): VisitSummaryDto;
  assertDecisionRevisionVisit(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    expectedVisitRevision: number,
    expectedPatientRevision: number,
  ): VisitSummaryDto;
  transitionDecisionRevision(
    tx: AuditedTransaction,
    actor: Actor,
    visit: VisitSummaryDto,
    decisionKind: SignedMedicationDecisionDto["kind"],
  ): VisitSummaryDto;
  transitionAllergySafety(
    tx: AuditedTransaction,
    actor: Actor,
    visit: VisitSummaryDto,
    reason: string,
  ): VisitSummaryDto;
}

type VisitRow = typeof visits.$inferSelect;
type IntakeRow = typeof intakeObservations.$inferSelect;

const activeStatuses = ["WAITING", "CONSULTING"] as const;

function isActiveStatus(status: string): status is (typeof activeStatuses)[number] {
  return status === "WAITING" || status === "CONSULTING";
}

function notFound(messageTh = "ไม่พบข้อมูลที่ร้องขอ"): ApiError {
  return new ApiError({ code: "NOT_FOUND", messageTh });
}

function toVitals(row: IntakeRow): IntakePayload["vitals"] {
  return {
    weightKg: row.weightKg ?? null,
    heightCm: row.heightCm ?? null,
    temperatureC: row.temperatureC ?? null,
    systolicMmhg: row.systolicMmhg ?? null,
    diastolicMmhg: row.diastolicMmhg ?? null,
    heartRateBpm: row.heartRateBpm ?? null,
    spo2Percent: row.spo2Percent ?? null,
  };
}

function toQueuePatient(patient: PatientDto): QueueItemDto["patient"] {
  return {
    id: patient.id,
    hn: patient.hn,
    displayName: patient.displayName,
    birthDate: patient.birthDate,
    sex: patient.sex,
  };
}

function allowedActions(actor: Actor, status: string): QueueItemDto["allowedActions"] {
  return actor.role === "doctor" && status === "WAITING" ? ["START_CONSULTATION"] : [];
}

function toQueueItem(
  visit: VisitRow,
  observation: IntakeRow,
  patient: PatientDto,
  actor: Actor,
): QueueItemDto {
  if (!isActiveStatus(visit.status)) throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่รองรับคิวนี้" });
  return {
    visit: {
      id: visit.id,
      status: visit.status,
      revision: visit.revision,
      arrivedAt: visit.arrivedAt,
      startedAt: visit.startedAt,
    },
    patient: toQueuePatient(patient),
    chiefComplaint: visit.chiefComplaint,
    vitals: toVitals(observation),
    allowedActions: allowedActions(actor, visit.status),
  };
}

function isActiveVisitUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("visits_clinic_patient_active_unique") ||
    message.includes("UNIQUE constraint failed: visits.clinic_id, visits.patient_id")
  );
}

function activeVisitExists(): ApiError {
  return new ApiError({
    code: "ACTIVE_VISIT_EXISTS",
    messageTh: "ผู้ป่วยรายนี้มี Visit ที่ยังไม่ปิดอยู่แล้ว",
  });
}

function findObservation(
  database: DatabaseHandle["db"] | AppTransaction,
  visitId: string,
): IntakeRow {
  const row = database
    .select()
    .from(intakeObservations)
    .where(eq(intakeObservations.visitId, visitId))
    .get();
  if (!row) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ข้อมูล Visit ไม่ครบถ้วน" });
  return row;
}

function dayStartUtc(now: Date): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  const start = new Date(`${localDate}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function createVisitService(input: VisitServiceOptions): VisitService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  const writeAudit = input.appendAudit ?? appendAuditEvent;

  const service: VisitService = {
    submitIntake(tx, actor, body) {
      const patient = input.patients.assertPatientRevision(
        tx,
        body.payload.patientId,
        body.expectedRevisions.patient,
      );
      const existing = tx
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.clinicId, "clinic"),
            eq(visits.patientId, body.payload.patientId),
            sql`${visits.status} <> 'CLOSED'`,
          ),
        )
        .get();
      if (existing) throw activeVisitExists();

      const now = clock().toISOString();
      const visitId = idFactory();
      const observationId = idFactory();
      const payload = body.payload;
      try {
        tx.insert(visits)
          .values({
            id: visitId,
            clinicId: "clinic",
            patientId: payload.patientId,
            status: "WAITING",
            chiefComplaint: payload.chiefComplaint,
            revision: 1,
            arrivedAt: now,
            startedAt: null,
            closedAt: null,
            createdBy: actor.id,
          })
          .run();
      } catch (error) {
        if (isActiveVisitUniqueViolation(error)) throw activeVisitExists();
        throw error;
      }

      tx.insert(intakeObservations)
        .values({
          id: observationId,
          visitId,
          weightKg: payload.vitals.weightKg,
          heightCm: payload.vitals.heightCm,
          temperatureC: payload.vitals.temperatureC,
          systolicMmhg: payload.vitals.systolicMmhg,
          diastolicMmhg: payload.vitals.diastolicMmhg,
          heartRateBpm: payload.vitals.heartRateBpm,
          spo2Percent: payload.vitals.spo2Percent,
          recordedBy: actor.id,
          recordedAt: now,
        })
        .run();

      writeAudit({
        tx,
        actor,
        id: idFactory(),
        action: "visit.intake-submitted",
        entityType: "visit",
        entityId: visitId,
        entityRevision: 1,
        reason: null,
        occurredAt: now,
        metadata: { patientId: payload.patientId, observationId },
      });

      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!visit) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "สร้าง Visit ไม่สำเร็จ" });
      const observation: IntakeRow = {
        id: observationId,
        visitId,
        weightKg: payload.vitals.weightKg,
        heightCm: payload.vitals.heightCm,
        temperatureC: payload.vitals.temperatureC,
        systolicMmhg: payload.vitals.systolicMmhg,
        diastolicMmhg: payload.vitals.diastolicMmhg,
        heartRateBpm: payload.vitals.heartRateBpm,
        spo2Percent: payload.vitals.spo2Percent,
        recordedBy: actor.id,
        recordedAt: now,
      };
      return toQueueItem(visit, observation, patient, actor);
    },

    listQueue(actor) {
      const rows = input.database.db
        .select()
        .from(visits)
        .where(and(eq(visits.clinicId, "clinic"), inArray(visits.status, activeStatuses)))
        .orderBy(sql`CASE ${visits.status} WHEN 'WAITING' THEN 0 ELSE 1 END`, asc(visits.arrivedAt), asc(visits.id))
        .all();
      const patientMap = input.patients.getPatientsByIds(rows.map((row) => row.patientId));
      return rows.map((visit) => {
        const patient = patientMap.get(visit.patientId);
        if (!patient) throw notFound("ไม่พบผู้ป่วยของ Visit");
        return toQueueItem(visit, findObservation(input.database.db, visit.id), patient, actor);
      });
    },

    getDashboardToday() {
      const now = clock();
      const { start, end } = dayStartUtc(now);
      const rows = input.database.db
        .select({ status: visits.status })
        .from(visits)
        .where(
          and(
            eq(visits.clinicId, "clinic"),
            inArray(visits.status, activeStatuses),
            sql`${visits.arrivedAt} >= ${start}`,
            sql`${visits.arrivedAt} < ${end}`,
          ),
        )
        .all();
      return {
        waiting: rows.filter((row) => row.status === "WAITING").length,
        consulting: rows.filter((row) => row.status === "CONSULTING").length,
        updatedAt: now.toISOString(),
      };
    },

    getVisitSummary(visitId) {
      const visit = input.database.db.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!visit) return null;
      return {
        id: visit.id,
        status: visitStatusSchema.parse(visit.status),
        revision: visit.revision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      };
    },

    getWorkspace(visitId, actor) {
      const visit = input.database.db
        .select()
        .from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!visit) throw notFound("ไม่พบ Visit");
      const patient = input.patients.getPatientById(visit.patientId);
      if (!patient) throw notFound("ไม่พบผู้ป่วยของ Visit");
      const observation = findObservation(input.database.db, visit.id);
      const recorder = input.database.db
        .select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
        .from(staffAccounts)
        .where(and(eq(staffAccounts.id, observation.recordedBy), eq(staffAccounts.clinicId, "clinic")))
        .get();
      if (!recorder) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบผู้บันทึก Intake" });
      if (!isActiveStatus(visit.status)) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่รองรับห้องทำงานนี้" });
      }
      return {
        visit: {
          id: visit.id,
          status: visit.status,
          revision: visit.revision,
          arrivedAt: visit.arrivedAt,
          startedAt: visit.startedAt,
        },
        patient,
        intake: {
          id: observation.id,
          chiefComplaint: visit.chiefComplaint,
          vitals: toVitals(observation),
          recordedAt: observation.recordedAt,
          recordedBy: recorder,
        },
        allowedActions: allowedActions(actor, visit.status),
      };
    },

    startConsultation(tx, actor, visitId, body) {
      if (!hasPermission(actor, "visit:start-consultation")) {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      const current = tx
        .select()
        .from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!current) throw notFound("ไม่พบ Visit");
      const patient = input.patients.getPatientById(current.patientId);
      if (!patient) throw notFound("ไม่พบผู้ป่วยของ Visit");
      const now = clock().toISOString();
      const nextRevision = current.revision + 1;
      const changed = tx
        .update(visits)
        .set({ status: "CONSULTING", startedAt: now, revision: nextRevision })
        .where(
          and(
            eq(visits.id, visitId),
            eq(visits.clinicId, "clinic"),
            eq(visits.status, "WAITING"),
            eq(visits.revision, body.expectedRevisions.visit),
          ),
        )
        .run();
      if (changed.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visitId)).get();
        if (!latest) throw notFound("ไม่พบ Visit");
        if (latest.revision !== body.expectedRevisions.visit) {
          assertExpectedRevision(latest.revision, body.expectedRevisions.visit, "visit");
        }
        throw new ApiError({ code: "INVALID_STATE", messageTh: "Visit นี้เริ่มห้องตรวจไปแล้ว" });
      }

      writeAudit({
        tx,
        actor,
        id: idFactory(),
        action: "visit.consultation-started",
        entityType: "visit",
        entityId: visitId,
        entityRevision: nextRevision,
        reason: null,
        occurredAt: now,
      });

      const updated = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "อัปเดต Visit ไม่สำเร็จ" });
      return toQueueItem(updated, findObservation(tx, visitId), patient, actor);
    },

    assertAllergyReviewVisit(tx, actor, patientId, body) {
      const visit = tx
        .select()
        .from(visits)
        .where(and(eq(visits.id, body.payload.visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!visit) throw notFound("ไม่พบ Visit");
      if (visit.patientId !== patientId) {
        throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ของผู้ป่วยรายนี้" });
      }
      assertExpectedRevision(visit.revision, body.expectedRevisions.visit, "visit");
      const allowed = visit.status === "WAITING" || (
        actor.role === "doctor" && (visit.status === "CONSULTING" || visit.status === "AWAITING_PREPARATION")
      );
      if (!allowed) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้ทบทวนข้อมูลแพ้" });
      }
      return {
        id: visit.id,
        status: visitStatusSchema.parse(visit.status),
        revision: visit.revision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      };
    },

    assertConsultationDraftVisit(tx, actor, visitId, expectedRevision) {
      const visit = tx.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!visit) throw notFound("ไม่พบ Visit");
      assertExpectedRevision(visit.revision, expectedRevision, "visit");
      if (actor.role !== "doctor") {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      if (visit.status !== "CONSULTING") {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้บันทึกร่าง" });
      }
      return {
        id: visit.id,
        status: visitStatusSchema.parse(visit.status),
        revision: visit.revision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      };
    },

    assertFinalizeConsultationVisit(tx, actor, visitId, expectedRevision, expectedPatientRevision) {
      const visit = tx.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
        .get();
      if (!visit) throw notFound("ไม่พบ Visit");
      assertExpectedRevision(visit.revision, expectedRevision, "visit");
      if (actor.role !== "doctor") {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      if (visit.status !== "CONSULTING") {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้ลงนามการตรวจ" });
      }
      input.patients.assertPatientRevision(tx, visit.patientId, expectedPatientRevision);
      return {
        id: visit.id,
        status: visitStatusSchema.parse(visit.status),
        revision: visit.revision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      };
    },

    finalizeConsultation(tx, actor, visitId, expectedRevision, decisionKind) {
      if (actor.role !== "doctor") {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      const nextStatus = decisionKind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE";
      const changed = tx.update(visits)
        .set({ status: nextStatus, revision: expectedRevision + 1 })
        .where(and(
          eq(visits.id, visitId),
          eq(visits.clinicId, "clinic"),
          eq(visits.status, "CONSULTING"),
          eq(visits.revision, expectedRevision),
        ))
        .run();
      if (changed.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visitId)).get();
        if (!latest) throw notFound("ไม่พบ Visit");
        if (latest.revision !== expectedRevision) {
          assertExpectedRevision(latest.revision, expectedRevision, "visit");
        }
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้ลงนามการตรวจ" });
      }
      const updated = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "อัปเดต Visit ไม่สำเร็จ" });
      return {
        id: updated.id,
        status: visitStatusSchema.parse(updated.status),
        revision: updated.revision,
        arrivedAt: updated.arrivedAt,
        startedAt: updated.startedAt,
      };
    },

    assertDecisionRevisionVisit(tx, actor, visitId, expectedVisitRevision, expectedPatientRevision) {
      const visit = tx.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic"))).get();
      if (!visit) throw notFound("ไม่พบ Visit");
      assertExpectedRevision(visit.revision, expectedVisitRevision, "visit");
      if (actor.role !== "doctor") {
        throw new ApiError({ code: "FORBIDDEN", messageTh: "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ" });
      }
      if (
        visit.status !== "AWAITING_ORDER_REVISION" &&
        visit.status !== "AWAITING_PREPARATION" &&
        visit.status !== "AWAITING_CHARGE"
      ) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้แก้ไขคำสั่งยา" });
      }
      input.patients.assertPatientRevision(tx, visit.patientId, expectedPatientRevision);
      return {
        id: visit.id,
        status: visitStatusSchema.parse(visit.status),
        revision: visit.revision,
        arrivedAt: visit.arrivedAt,
        startedAt: visit.startedAt,
      };
    },

    transitionDecisionRevision(tx, actor, visit, decisionKind) {
      const nextStatus = decisionKind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE";
      const changed = tx.update(visits)
        .set({ status: nextStatus, revision: visit.revision + 1 })
        .where(and(
          eq(visits.id, visit.id),
          eq(visits.clinicId, "clinic"),
          eq(visits.status, visit.status),
          eq(visits.revision, visit.revision),
        )).run();
      if (changed.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visit.id)).get();
        if (!latest) throw notFound("ไม่พบ Visit");
        if (latest.revision !== visit.revision) assertExpectedRevision(latest.revision, visit.revision, "visit");
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้แก้ไขคำสั่งยา" });
      }
      const updated = tx.select().from(visits).where(eq(visits.id, visit.id)).get();
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "อัปเดต Visit ไม่สำเร็จ" });
      return {
        id: updated.id,
        status: visitStatusSchema.parse(updated.status),
        revision: updated.revision,
        arrivedAt: updated.arrivedAt,
        startedAt: updated.startedAt,
      };
    },

    transitionAllergySafety(tx, actor, visit, reason) {
      if (actor.role !== "doctor" || visit.status !== "AWAITING_PREPARATION") {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้ทบทวนข้อมูลแพ้" });
      }
      const nextRevision = visit.revision + 1;
      const changed = tx.update(visits)
        .set({ status: "AWAITING_ORDER_REVISION", revision: nextRevision })
        .where(and(
          eq(visits.id, visit.id),
          eq(visits.clinicId, "clinic"),
          eq(visits.status, "AWAITING_PREPARATION"),
          eq(visits.revision, visit.revision),
        )).run();
      if (changed.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visit.id)).get();
        if (!latest) throw notFound("ไม่พบ Visit");
        if (latest.revision !== visit.revision) assertExpectedRevision(latest.revision, visit.revision, "visit");
        throw new ApiError({ code: "INVALID_STATE", messageTh: "สถานะ Visit ไม่อนุญาตให้ทบทวนข้อมูลแพ้" });
      }
      const updated = tx.select().from(visits).where(eq(visits.id, visit.id)).get();
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "อัปเดต Visit ไม่สำเร็จ" });
      writeAudit({
        tx, actor, id: idFactory(), action: "visit.allergy-safety-changed", entityType: "visit",
        entityId: updated.id, entityRevision: nextRevision, reason, occurredAt: clock().toISOString(),
        metadata: { previousStatus: "AWAITING_PREPARATION", nextStatus: "AWAITING_ORDER_REVISION" },
      });
      return {
        id: updated.id,
        status: visitStatusSchema.parse(updated.status),
        revision: updated.revision,
        arrivedAt: updated.arrivedAt,
        startedAt: updated.startedAt,
      };
    },
  };

  return service;
}
