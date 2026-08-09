import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { patients } from "../patient/index.js";
import { clinicConfig, staffAccounts } from "../platform/index.js";
import {
  financeChargeAdjustments,
  financeCharges,
  financePayments,
} from "../finance/schema.js";
import { visitStatuses } from "../../../shared/contracts.js";

export const visits = sqliteTable(
  "visits",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id),
    status: text("status", { enum: [...visitStatuses] as [string, ...string[]] })
      .notNull()
      .default("WAITING"),
    chiefComplaint: text("chief_complaint").notNull(),
    revision: integer("revision").notNull().default(1),
    arrivedAt: text("arrived_at").notNull(),
    startedAt: text("started_at"),
    closedAt: text("closed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffAccounts.id),
  },
  (table) => [
    check(
      "visits_status_check",
      sql`${table.status} IN ('WAITING', 'CONSULTING', 'AWAITING_PREPARATION', 'PREPARING', 'AWAITING_RELEASE', 'AWAITING_HANDOFF', 'AWAITING_ORDER_REVISION', 'AWAITING_CHARGE', 'AWAITING_PAYMENT', 'READY_TO_CLOSE', 'CLOSED')`,
    ),
    check(
      "visits_chief_complaint_check",
      sql`length(trim(${table.chiefComplaint})) BETWEEN 1 AND 500`,
    ),
    check("visits_revision_check", sql`${table.revision} >= 1`),
    uniqueIndex("visits_clinic_patient_active_unique")
      .on(table.clinicId, table.patientId)
      .where(sql`${table.status} <> 'CLOSED'`),
    index("visits_clinic_status_arrived_index").on(table.clinicId, table.status, table.arrivedAt),
  ],
);

export const intakeObservations = sqliteTable(
  "intake_observations",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id")
      .notNull()
      .unique()
      .references(() => visits.id),
    weightKg: real("weight_kg"),
    heightCm: real("height_cm"),
    temperatureC: real("temperature_c"),
    systolicMmhg: integer("systolic_mmhg"),
    diastolicMmhg: integer("diastolic_mmhg"),
    heartRateBpm: integer("heart_rate_bpm"),
    spo2Percent: integer("spo2_percent"),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => staffAccounts.id),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [
    check(
      "intake_weight_check",
      sql`${table.weightKg} IS NULL OR ${table.weightKg} BETWEEN 1 AND 350`,
    ),
    check(
      "intake_height_check",
      sql`${table.heightCm} IS NULL OR ${table.heightCm} BETWEEN 30 AND 250`,
    ),
    check(
      "intake_temperature_check",
      sql`${table.temperatureC} IS NULL OR ${table.temperatureC} BETWEEN 30 AND 45`,
    ),
    check(
      "intake_systolic_check",
      sql`${table.systolicMmhg} IS NULL OR ${table.systolicMmhg} BETWEEN 50 AND 260`,
    ),
    check(
      "intake_diastolic_check",
      sql`${table.diastolicMmhg} IS NULL OR ${table.diastolicMmhg} BETWEEN 30 AND 180`,
    ),
    check(
      "intake_heart_rate_check",
      sql`${table.heartRateBpm} IS NULL OR ${table.heartRateBpm} BETWEEN 20 AND 250`,
    ),
    check(
      "intake_spo2_check",
      sql`${table.spo2Percent} IS NULL OR ${table.spo2Percent} BETWEEN 50 AND 100`,
    ),
    check(
      "intake_blood_pressure_relationship_check",
      sql`${table.systolicMmhg} IS NULL OR ${table.diastolicMmhg} IS NULL OR ${table.systolicMmhg} >= ${table.diastolicMmhg}`,
    ),
  ],
);

const closureHashCheck = (column: ReturnType<typeof text>) =>
  sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

/** Immutable proof that a Doctor closed one fully resolved Visit. */
export const visitClosures = sqliteTable(
  "visit_closures",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    visitId: text("visit_id")
      .notNull()
      .unique()
      .references(() => visits.id),
    /** The READY_TO_CLOSE revision validated before the one CLOSED transition. */
    visitRevision: integer("visit_revision").notNull(),
    chargeId: text("charge_id")
      .notNull()
      .unique()
      .references(() => financeCharges.id),
    paymentId: text("payment_id").references(() => financePayments.id),
    waiverAdjustmentId: text("waiver_adjustment_id").references(() => financeChargeAdjustments.id),
    clinicNameSnapshot: text("clinic_name_snapshot").notNull(),
    patientIdSnapshot: text("patient_id_snapshot").notNull(),
    patientHnSnapshot: text("patient_hn_snapshot").notNull(),
    patientDisplayNameSnapshot: text("patient_display_name_snapshot").notNull(),
    patientBirthDateSnapshot: text("patient_birth_date_snapshot").notNull(),
    patientSexSnapshot: text("patient_sex_snapshot", { enum: ["female", "male", "unknown"] }).notNull(),
    doctorIdSnapshot: text("doctor_id_snapshot")
      .notNull()
      .references(() => staffAccounts.id),
    doctorDisplayNameSnapshot: text("doctor_display_name_snapshot").notNull(),
    closedAt: text("closed_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    check("visit_closures_visit_revision_check", sql`${table.visitRevision} >= 1`),
    check(
      "visit_closures_resolution_shape_check",
      sql`(${table.paymentId} IS NOT NULL AND ${table.waiverAdjustmentId} IS NULL) OR (${table.paymentId} IS NULL AND ${table.waiverAdjustmentId} IS NOT NULL)`,
    ),
    check("visit_closures_clinic_name_snapshot_check", sql`length(trim(${table.clinicNameSnapshot})) BETWEEN 1 AND 120`),
    check("visit_closures_patient_id_snapshot_check", sql`length(trim(${table.patientIdSnapshot})) BETWEEN 1 AND 120`),
    check("visit_closures_patient_hn_snapshot_check", sql`${table.patientHnSnapshot} GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'`),
    check("visit_closures_patient_name_snapshot_check", sql`length(trim(${table.patientDisplayNameSnapshot})) BETWEEN 1 AND 200`),
    check("visit_closures_patient_birth_date_snapshot_check", sql`${table.patientBirthDateSnapshot} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("visit_closures_patient_sex_snapshot_check", sql`${table.patientSexSnapshot} IN ('female', 'male', 'unknown')`),
    check("visit_closures_doctor_display_name_snapshot_check", sql`length(trim(${table.doctorDisplayNameSnapshot})) BETWEEN 1 AND 200`),
    check("visit_closures_content_hash_check", closureHashCheck(table.contentHash)),
    index("visit_closures_clinic_closed_at_index").on(table.clinicId, table.closedAt),
  ],
);
