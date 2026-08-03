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
