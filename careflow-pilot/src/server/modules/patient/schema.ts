import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { clinicConfig, staffAccounts } from "../platform/schema.js";

export const patients = sqliteTable(
  "patients",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    hn: text("hn").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    birthDate: text("birth_date").notNull(),
    sex: text("sex", { enum: ["female", "male", "unknown"] }).notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("patients_clinic_hn_unique").on(table.clinicId, table.hn),
    check(
      "patients_hn_check",
      sql`length(${table.hn}) = 11 AND ${table.hn} GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "patients_display_name_check",
      sql`${table.displayName} = 'ผู้ป่วยทดสอบ ' || substr(${table.hn}, 6)`,
    ),
    check(
      "patients_phone_check",
      sql`length(${table.phone}) = 10 AND ${table.phone} GLOB '000000[0-9][0-9][0-9][0-9]'`,
    ),
    check(
      "patients_phone_hn_check",
      sql`${table.phone} = '000000' || substr(${table.hn}, -4)`,
    ),
    check(
      "patients_sex_check",
      sql`${table.sex} IN ('female', 'male', 'unknown')`,
    ),
    check(
      "patients_demographics_check",
      sql`${table.birthDate} = '1990-01-01' AND ${table.sex} = 'unknown'`,
    ),
    check("patients_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const patientAllergyRevisions = sqliteTable(
  "patient_allergy_revisions",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull().references(() => patients.id),
    revision: integer("revision").notNull(),
    state: text("state", { enum: ["UNKNOWN", "NONE_KNOWN", "PRESENT"] }).notNull(),
    sourceText: text("source_text").notNull(),
    reason: text("reason").notNull(),
    reviewedBy: text("reviewed_by").notNull().references(() => staffAccounts.id),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (table) => [
    unique("patient_allergy_revisions_patient_revision_unique").on(table.patientId, table.revision),
    check("patient_allergy_revisions_revision_check", sql`${table.revision} >= 1`),
    check("patient_allergy_revisions_state_check", sql`${table.state} IN ('UNKNOWN', 'NONE_KNOWN', 'PRESENT')`),
    check("patient_allergy_revisions_source_text_check", sql`length(${table.sourceText}) BETWEEN 1 AND 500`),
    check("patient_allergy_revisions_reason_check", sql`length(${table.reason}) BETWEEN 1 AND 500`),
  ],
);

export const patientAllergyItems = sqliteTable(
  "patient_allergy_items",
  {
    id: text("id").primaryKey(),
    allergyRevisionId: text("allergy_revision_id").notNull().references(() => patientAllergyRevisions.id),
    position: integer("position").notNull(),
    substance: text("substance").notNull(),
    reaction: text("reaction").notNull(),
    severity: text("severity", { enum: ["UNKNOWN", "MILD", "MODERATE", "SEVERE"] }).notNull(),
    note: text("note"),
  },
  (table) => [
    unique("patient_allergy_items_revision_position_unique").on(table.allergyRevisionId, table.position),
    check("patient_allergy_items_position_check", sql`${table.position} >= 0`),
    check("patient_allergy_items_substance_check", sql`length(${table.substance}) BETWEEN 1 AND 200`),
    check("patient_allergy_items_reaction_check", sql`length(${table.reaction}) BETWEEN 1 AND 300`),
    check("patient_allergy_items_severity_check", sql`${table.severity} IN ('UNKNOWN', 'MILD', 'MODERATE', 'SEVERE')`),
    check("patient_allergy_items_note_check", sql`${table.note} IS NULL OR length(${table.note}) <= 500`),
  ],
);
