import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { visits } from "../visit/schema.js";
import { staffAccounts } from "../platform/schema.js";

const hashCheck = (column: ReturnType<typeof text>) =>
  sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const clinicalNoteDrafts = sqliteTable(
  "clinical_note_drafts",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().unique().references(() => visits.id),
    revision: integer("revision").notNull().default(1),
    subjective: text("subjective").notNull().default(""),
    objective: text("objective").notNull().default(""),
    assessment: text("assessment").notNull().default(""),
    plan: text("plan").notNull().default(""),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
    updatedBy: text("updated_by").notNull().references(() => staffAccounts.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("clinical_note_drafts_revision_check", sql`${table.revision} >= 1`),
    check("clinical_note_drafts_subjective_check", sql`length(${table.subjective}) BETWEEN 0 AND 4000`),
    check("clinical_note_drafts_objective_check", sql`length(${table.objective}) BETWEEN 0 AND 4000`),
    check("clinical_note_drafts_assessment_check", sql`length(${table.assessment}) BETWEEN 0 AND 4000`),
    check("clinical_note_drafts_plan_check", sql`length(${table.plan}) BETWEEN 0 AND 4000`),
  ],
);

export const clinicalNoteDraftDiagnoses = sqliteTable(
  "clinical_note_draft_diagnoses",
  {
    id: text("id").primaryKey(),
    draftId: text("draft_id").notNull().references(() => clinicalNoteDrafts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    diagnosisText: text("diagnosis_text").notNull(),
  },
  (table) => [
    unique("clinical_note_draft_diagnoses_draft_position_unique").on(table.draftId, table.position),
    check("clinical_note_draft_diagnoses_position_check", sql`${table.position} >= 0`),
    check("clinical_note_draft_diagnoses_text_check", sql`length(${table.diagnosisText}) BETWEEN 1 AND 300`),
  ],
);

export const clinicalNotes = sqliteTable(
  "clinical_notes",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().references(() => visits.id),
    version: integer("version").notNull(),
    subjective: text("subjective").notNull(),
    objective: text("objective").notNull(),
    assessment: text("assessment").notNull(),
    plan: text("plan").notNull(),
    sourceDraftRevision: integer("source_draft_revision").notNull(),
    signedBy: text("signed_by").notNull().references(() => staffAccounts.id),
    signedAt: text("signed_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("clinical_notes_visit_version_unique").on(table.visitId, table.version),
    check("clinical_notes_version_check", sql`${table.version} >= 1`),
    check("clinical_notes_subjective_check", sql`length(${table.subjective}) BETWEEN 1 AND 4000`),
    check("clinical_notes_objective_check", sql`length(${table.objective}) BETWEEN 1 AND 4000`),
    check("clinical_notes_assessment_check", sql`length(${table.assessment}) BETWEEN 1 AND 4000`),
    check("clinical_notes_plan_check", sql`length(${table.plan}) BETWEEN 1 AND 4000`),
    check("clinical_notes_source_draft_revision_check", sql`${table.sourceDraftRevision} >= 1`),
    check("clinical_notes_content_hash_check", hashCheck(table.contentHash)),
  ],
);

export const clinicalNoteDiagnoses = sqliteTable(
  "clinical_note_diagnoses",
  {
    id: text("id").primaryKey(),
    clinicalNoteId: text("clinical_note_id").notNull().references(() => clinicalNotes.id),
    position: integer("position").notNull(),
    diagnosisText: text("diagnosis_text").notNull(),
  },
  (table) => [
    unique("clinical_note_diagnoses_note_position_unique").on(table.clinicalNoteId, table.position),
    check("clinical_note_diagnoses_position_check", sql`${table.position} >= 0`),
    check("clinical_note_diagnoses_text_check", sql`length(${table.diagnosisText}) BETWEEN 1 AND 300`),
  ],
);

export const clinicalNoteAmendments = sqliteTable(
  "clinical_note_amendments",
  {
    id: text("id").primaryKey(),
    clinicalNoteId: text("clinical_note_id").notNull().references(() => clinicalNotes.id),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    reason: text("reason").notNull(),
    signedBy: text("signed_by").notNull().references(() => staffAccounts.id),
    signedAt: text("signed_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("clinical_note_amendments_note_version_unique").on(table.clinicalNoteId, table.version),
    check("clinical_note_amendments_version_check", sql`${table.version} >= 1`),
    check("clinical_note_amendments_content_check", sql`length(${table.content}) BETWEEN 1 AND 4000`),
    check("clinical_note_amendments_reason_check", sql`length(${table.reason}) BETWEEN 1 AND 500`),
    check("clinical_note_amendments_content_hash_check", hashCheck(table.contentHash)),
  ],
);
