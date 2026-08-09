import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { visits } from "../visit/schema.js";
import { staffAccounts } from "../platform/schema.js";

const hashCheck = (column: ReturnType<typeof text>) =>
  sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const medications = sqliteTable(
  "medications",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    strengthText: text("strength_text").notNull(),
    dosageFormText: text("dosage_form_text").notNull(),
    canonicalUnit: text("canonical_unit").notNull(),
    internalBarcode: text("internal_barcode"),
    active: integer("active").notNull().default(1),
    revision: integer("revision").notNull().default(1),
    unitPriceBaht: integer("unit_price_baht").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("medications_id_check", sql`length(${table.id}) = 12 AND ${table.id} GLOB 'DEMO-MED-[0-9][0-9][0-9]'`),
    check("medications_display_name_check", sql`length(${table.displayName}) BETWEEN 1 AND 200`),
    check("medications_strength_text_check", sql`length(${table.strengthText}) BETWEEN 1 AND 100`),
    check("medications_dosage_form_text_check", sql`length(${table.dosageFormText}) BETWEEN 1 AND 100`),
    check("medications_canonical_unit_check", sql`length(${table.canonicalUnit}) BETWEEN 1 AND 100`),
    check("medications_active_check", sql`${table.active} IN (0, 1)`),
    check("medications_revision_check", sql`${table.revision} >= 1`),
    check("medications_unit_price_baht_check", sql`typeof(${table.unitPriceBaht}) = 'integer' AND ${table.unitPriceBaht} BETWEEN 0 AND 1000000`),
  ],
);

export const medicationDecisionDrafts = sqliteTable(
  "medication_decision_drafts",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().unique().references(() => visits.id),
    revision: integer("revision").notNull().default(1),
    kind: text("kind", { enum: ["UNDECIDED", "ORDER", "NO_MEDICATION"] }).notNull().default("UNDECIDED"),
    noMedicationReason: text("no_medication_reason"),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
    updatedBy: text("updated_by").notNull().references(() => staffAccounts.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("medication_decision_drafts_revision_check", sql`${table.revision} >= 1`),
    check("medication_decision_drafts_kind_check", sql`${table.kind} IN ('UNDECIDED', 'ORDER', 'NO_MEDICATION')`),
    check("medication_decision_drafts_no_medication_reason_check", sql`${table.noMedicationReason} IS NULL OR length(${table.noMedicationReason}) <= 500`),
  ],
);

export const medicationOrderDraftItems = sqliteTable(
  "medication_order_draft_items",
  {
    id: text("id").primaryKey(),
    decisionDraftId: text("decision_draft_id").notNull().references(() => medicationDecisionDrafts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
    quantity: integer("quantity").notNull(),
    directionsTh: text("directions_th").notNull(),
  },
  (table) => [
    unique("medication_order_draft_items_draft_position_unique").on(table.decisionDraftId, table.position),
    check("medication_order_draft_items_position_check", sql`${table.position} >= 0`),
    check("medication_order_draft_items_medication_revision_check", sql`${table.medicationRevision} >= 1`),
    check("medication_order_draft_items_quantity_check", sql`${table.quantity} BETWEEN 1 AND 9999`),
    check("medication_order_draft_items_directions_th_check", sql`length(${table.directionsTh}) BETWEEN 1 AND 500`),
  ],
);

export const medicationDecisions = sqliteTable(
  "medication_decisions",
  {
    id: text("id").primaryKey(),
    visitId: text("visit_id").notNull().references(() => visits.id),
    version: integer("version").notNull(),
    kind: text("kind", { enum: ["ORDER", "NO_MEDICATION"] }).notNull(),
    noMedicationReason: text("no_medication_reason"),
    revisionReason: text("revision_reason"),
    supersedesId: text("supersedes_id").references((): AnySQLiteColumn => medicationDecisions.id),
    signedBy: text("signed_by").notNull().references(() => staffAccounts.id),
    signedByDisplayName: text("signed_by_display_name").notNull().default("legacy signer snapshot unavailable"),
    signedAt: text("signed_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("medication_decisions_visit_version_unique").on(table.visitId, table.version),
    check("medication_decisions_version_check", sql`${table.version} >= 1`),
    check("medication_decisions_kind_check", sql`${table.kind} IN ('ORDER', 'NO_MEDICATION')`),
    check("medication_decisions_no_medication_reason_check", sql`${table.noMedicationReason} IS NULL OR length(${table.noMedicationReason}) BETWEEN 1 AND 500`),
    check("medication_decisions_revision_reason_check", sql`${table.revisionReason} IS NULL OR length(${table.revisionReason}) BETWEEN 1 AND 500`),
    check("medication_decisions_content_hash_check", hashCheck(table.contentHash)),
  ],
);

export const medicationOrderItems = sqliteTable(
  "medication_order_items",
  {
    id: text("id").primaryKey(),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    position: integer("position").notNull(),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    strengthSnapshot: text("strength_snapshot").notNull(),
    dosageFormSnapshot: text("dosage_form_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    directionsTh: text("directions_th").notNull(),
  },
  (table) => [
    unique("medication_order_items_decision_position_unique").on(table.medicationDecisionId, table.position),
    check("medication_order_items_position_check", sql`${table.position} >= 0`),
    check("medication_order_items_medication_revision_check", sql`${table.medicationRevision} >= 1`),
    check("medication_order_items_display_name_snapshot_check", sql`length(${table.displayNameSnapshot}) BETWEEN 1 AND 200`),
    check("medication_order_items_strength_snapshot_check", sql`length(${table.strengthSnapshot}) BETWEEN 1 AND 100`),
    check("medication_order_items_dosage_form_snapshot_check", sql`length(${table.dosageFormSnapshot}) BETWEEN 1 AND 100`),
    check("medication_order_items_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
    check("medication_order_items_quantity_check", sql`${table.quantity} BETWEEN 1 AND 9999`),
    check("medication_order_items_directions_th_check", sql`length(${table.directionsTh}) BETWEEN 1 AND 500`),
  ],
);
