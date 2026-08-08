import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { inventoryLots, inventoryReservationAllocations, inventoryReservations } from "../inventory/schema.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import { clinicConfig, staffAccounts } from "../platform/schema.js";
import { visits } from "../visit/schema.js";

export const fulfillmentPreparationStatuses = ["ACTIVE", "COMPLETED"] as const;
export const fulfillmentConfirmationMethods = ["BARCODE", "MANUAL"] as const;
export const fulfillmentArtifactTypes = ["LABEL", "PREPARATION", "RELEASE"] as const;
export const fulfillmentInvalidationTriggers = ["ABANDON", "REJECT", "ALLERGY_REVISION", "ORDER_REVISION"] as const;

export const fulfillmentLabelVersions = sqliteTable(
  "fulfillment_label_versions",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
    patientHnSnapshot: text("patient_hn_snapshot").notNull(),
    patientDisplayNameSnapshot: text("patient_display_name_snapshot").notNull(),
    clinicNameSnapshot: text("clinic_name_snapshot").notNull(),
  },
  (table) => [
    unique("fulfillment_label_versions_decision_unique").on(table.medicationDecisionId),
    check("fulfillment_label_versions_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`),
    check("fulfillment_label_versions_version_check", sql`${table.version} >= 1`),
    check("fulfillment_label_versions_patient_hn_snapshot_check", sql`length(${table.patientHnSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_label_versions_patient_display_name_snapshot_check", sql`length(${table.patientDisplayNameSnapshot}) BETWEEN 1 AND 200`),
    check("fulfillment_label_versions_clinic_name_snapshot_check", sql`length(${table.clinicNameSnapshot}) BETWEEN 1 AND 200`),
  ],
);

export const fulfillmentLabelItems = sqliteTable(
  "fulfillment_label_items",
  {
    id: text("id").primaryKey(),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    medicationOrderItemId: text("medication_order_item_id").notNull().references(() => medicationOrderItems.id),
    position: integer("position").notNull(),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    strengthSnapshot: text("strength_snapshot").notNull(),
    dosageFormSnapshot: text("dosage_form_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    directionsThSnapshot: text("directions_th_snapshot").notNull(),
    internalBarcodeSnapshot: text("internal_barcode_snapshot").notNull(),
  },
  (table) => [
    unique("fulfillment_label_items_label_position_unique").on(table.labelVersionId, table.position),
    unique("fulfillment_label_items_order_item_unique").on(table.medicationOrderItemId),
    check("fulfillment_label_items_position_check", sql`${table.position} >= 0`),
    check("fulfillment_label_items_medication_revision_check", sql`${table.medicationRevision} >= 1`),
    check("fulfillment_label_items_quantity_check", sql`${table.quantity} BETWEEN 1 AND 9999`),
    check("fulfillment_label_items_display_name_snapshot_check", sql`length(${table.displayNameSnapshot}) BETWEEN 1 AND 200`),
    check("fulfillment_label_items_strength_snapshot_check", sql`length(${table.strengthSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_label_items_dosage_form_snapshot_check", sql`length(${table.dosageFormSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_label_items_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_label_items_directions_snapshot_check", sql`length(${table.directionsThSnapshot}) BETWEEN 1 AND 500`),
    check("fulfillment_label_items_barcode_snapshot_check", sql`length(${table.internalBarcodeSnapshot}) BETWEEN 1 AND 64 AND ${table.internalBarcodeSnapshot} NOT GLOB '*[^!-~]*'`),
  ],
);

export const fulfillmentLabelPrintEvents = sqliteTable(
  "fulfillment_label_print_events",
  {
    id: text("id").primaryKey(),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    sequence: integer("sequence").notNull(),
    requestedAt: text("requested_at").notNull(),
    requestedBy: text("requested_by").notNull().references(() => staffAccounts.id),
    rendererVersion: text("renderer_version").notNull(),
    mediaSizeSnapshot: text("media_size_snapshot").notNull(),
  },
  (table) => [
    unique("fulfillment_label_print_events_label_sequence_unique").on(table.labelVersionId, table.sequence),
    check("fulfillment_label_print_events_sequence_check", sql`${table.sequence} >= 1`),
    check("fulfillment_label_print_events_renderer_version_check", sql`length(${table.rendererVersion}) BETWEEN 1 AND 100`),
    check("fulfillment_label_print_events_media_size_check", sql`${table.mediaSizeSnapshot} = '80x100mm'`),
  ],
);

export const fulfillmentPreparations = sqliteTable(
  "fulfillment_preparations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    reservationId: text("reservation_id").notNull().unique().references(() => inventoryReservations.id),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    revision: integer("revision").notNull().default(1),
    status: text("status", { enum: fulfillmentPreparationStatuses }).notNull().default("ACTIVE"),
    minimumPrintSequence: integer("minimum_print_sequence").notNull().default(1),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
    completedAt: text("completed_at"),
    completedBy: text("completed_by").references(() => staffAccounts.id),
  },
  (table) => [
    check("fulfillment_preparations_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`),
    check("fulfillment_preparations_revision_check", sql`${table.revision} >= 1`),
    check("fulfillment_preparations_minimum_print_sequence_check", sql`${table.minimumPrintSequence} >= 1`),
    check("fulfillment_preparations_status_check", sql`${table.status} IN ('ACTIVE', 'COMPLETED')`),
    check("fulfillment_preparations_completion_fields_check", sql`(${table.status} = 'ACTIVE' AND ${table.completedAt} IS NULL AND ${table.completedBy} IS NULL) OR (${table.status} = 'COMPLETED' AND ${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL)`),
  ],
);

export const fulfillmentPreparationConfirmations = sqliteTable(
  "fulfillment_preparation_confirmations",
  {
    id: text("id").primaryKey(),
    preparationId: text("preparation_id").notNull().references(() => fulfillmentPreparations.id),
    reservationAllocationId: text("reservation_allocation_id").notNull().references(() => inventoryReservationAllocations.id),
    medicationOrderItemId: text("medication_order_item_id").notNull().references(() => medicationOrderItems.id),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id),
    quantity: integer("quantity").notNull(),
    method: text("method", { enum: fulfillmentConfirmationMethods }).notNull(),
    barcodeSnapshot: text("barcode_snapshot"),
    manualReason: text("manual_reason"),
    confirmedAt: text("confirmed_at").notNull(),
    confirmedBy: text("confirmed_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    unique("fulfillment_preparation_confirmations_preparation_allocation_unique").on(table.preparationId, table.reservationAllocationId),
    check("fulfillment_preparation_confirmations_quantity_check", sql`${table.quantity} BETWEEN 1 AND 999999`),
    check("fulfillment_preparation_confirmations_method_check", sql`${table.method} IN ('BARCODE', 'MANUAL')`),
    check("fulfillment_preparation_confirmations_evidence_check", sql`(${table.method} = 'BARCODE' AND ${table.barcodeSnapshot} IS NOT NULL AND length(${table.barcodeSnapshot}) BETWEEN 1 AND 64 AND ${table.barcodeSnapshot} NOT GLOB '*[^!-~]*' AND ${table.manualReason} IS NULL) OR (${table.method} = 'MANUAL' AND ${table.barcodeSnapshot} IS NULL AND ${table.manualReason} IS NOT NULL AND length(trim(${table.manualReason})) BETWEEN 1 AND 500)`),
  ],
);

export const fulfillmentArtifactInvalidations = sqliteTable(
  "fulfillment_artifact_invalidations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    artifactType: text("artifact_type", { enum: fulfillmentArtifactTypes }).notNull(),
    artifactId: text("artifact_id").notNull(),
    trigger: text("trigger", { enum: fulfillmentInvalidationTriggers }).notNull(),
    reason: text("reason").notNull(),
    invalidatedAt: text("invalidated_at").notNull(),
    invalidatedBy: text("invalidated_by").notNull().references(() => staffAccounts.id),
    replacementDecisionId: text("replacement_decision_id").references(() => medicationDecisions.id),
  },
  (table) => [
    unique("fulfillment_artifact_invalidations_artifact_unique").on(table.artifactType, table.artifactId),
    check("fulfillment_artifact_invalidations_type_check", sql`${table.artifactType} IN ('LABEL', 'PREPARATION', 'RELEASE')`),
    check("fulfillment_artifact_invalidations_trigger_check", sql`${table.trigger} IN ('ABANDON', 'REJECT', 'ALLERGY_REVISION', 'ORDER_REVISION')`),
    check("fulfillment_artifact_invalidations_reason_check", sql`length(trim(${table.reason})) BETWEEN 1 AND 500`),
    check("fulfillment_artifact_invalidations_replacement_check", sql`(${table.trigger} = 'ORDER_REVISION' AND ${table.replacementDecisionId} IS NOT NULL) OR (${table.trigger} <> 'ORDER_REVISION' AND ${table.replacementDecisionId} IS NULL)`),
  ],
);

export const fulfillmentReleases = sqliteTable(
  "fulfillment_releases",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    labelPrintEventId: text("label_print_event_id").notNull().references(() => fulfillmentLabelPrintEvents.id),
    preparationId: text("preparation_id").notNull().references(() => fulfillmentPreparations.id),
    preparationRevision: integer("preparation_revision").notNull(),
    reservationId: text("reservation_id").notNull().unique().references(() => inventoryReservations.id),
    releasedAt: text("released_at").notNull(),
    releasedBy: text("released_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    check("fulfillment_releases_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`),
    check("fulfillment_releases_preparation_revision_check", sql`${table.preparationRevision} >= 1`),
  ],
);

export const fulfillmentRejections = sqliteTable(
  "fulfillment_rejections",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    preparationId: text("preparation_id").notNull().unique().references(() => fulfillmentPreparations.id),
    reservationId: text("reservation_id").notNull().references(() => inventoryReservations.id),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    printSequenceAtRejection: integer("print_sequence_at_rejection").notNull(),
    reason: text("reason").notNull(),
    rejectedAt: text("rejected_at").notNull(),
    rejectedBy: text("rejected_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    check("fulfillment_rejections_print_sequence_check", sql`${table.printSequenceAtRejection} >= 1`),
    check("fulfillment_rejections_reason_check", sql`length(trim(${table.reason})) BETWEEN 1 AND 500`),
  ],
);

export const fulfillmentDispenses = sqliteTable(
  "fulfillment_dispenses",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().unique().references(() => visits.id),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    labelVersionId: text("label_version_id").notNull().references(() => fulfillmentLabelVersions.id),
    preparationId: text("preparation_id").notNull().references(() => fulfillmentPreparations.id),
    releaseId: text("release_id").notNull().unique().references(() => fulfillmentReleases.id),
    reservationId: text("reservation_id").notNull().unique().references(() => inventoryReservations.id),
    handedOffAt: text("handed_off_at").notNull(),
    handedOffBy: text("handed_off_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [check("fulfillment_dispenses_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`)],
);

export const fulfillmentDispenseLines = sqliteTable(
  "fulfillment_dispense_lines",
  {
    id: text("id").primaryKey(),
    dispenseId: text("dispense_id").notNull().references(() => fulfillmentDispenses.id),
    reservationAllocationId: text("reservation_allocation_id").notNull().unique().references(() => inventoryReservationAllocations.id),
    medicationOrderItemId: text("medication_order_item_id").notNull().references(() => medicationOrderItems.id),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id),
    quantity: integer("quantity").notNull(),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    strengthSnapshot: text("strength_snapshot").notNull(),
    dosageFormSnapshot: text("dosage_form_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    lotNumberSnapshot: text("lot_number_snapshot").notNull(),
    expiryDateSnapshot: text("expiry_date_snapshot").notNull(),
    directionsThSnapshot: text("directions_th_snapshot").notNull(),
  },
  (table) => [
    index("fulfillment_dispense_lines_dispense_index").on(table.dispenseId),
    check("fulfillment_dispense_lines_quantity_check", sql`${table.quantity} BETWEEN 1 AND 999999`),
    check("fulfillment_dispense_lines_display_name_snapshot_check", sql`length(${table.displayNameSnapshot}) BETWEEN 1 AND 200`),
    check("fulfillment_dispense_lines_strength_snapshot_check", sql`length(${table.strengthSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_dispense_lines_dosage_form_snapshot_check", sql`length(${table.dosageFormSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_dispense_lines_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
    check("fulfillment_dispense_lines_lot_number_snapshot_check", sql`length(trim(${table.lotNumberSnapshot})) BETWEEN 1 AND 100`),
    check("fulfillment_dispense_lines_expiry_date_snapshot_check", sql`${table.expiryDateSnapshot} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("fulfillment_dispense_lines_directions_snapshot_check", sql`length(${table.directionsThSnapshot}) BETWEEN 1 AND 500`),
  ],
);
