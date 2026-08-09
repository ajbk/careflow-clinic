import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import { clinicConfig, staffAccounts } from "../platform/schema.js";
import { visits } from "../visit/schema.js";

export const inventoryLots = sqliteTable(
  "inventory_lots",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
    revision: integer("revision").notNull().default(1),
    displayNameSnapshot: text("display_name_snapshot").notNull(),
    strengthSnapshot: text("strength_snapshot").notNull(),
    dosageFormSnapshot: text("dosage_form_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    lotNumber: text("lot_number").notNull(),
    expiryDate: text("expiry_date").notNull(),
    supplierName: text("supplier_name").notNull(),
    status: text("status", { enum: ["AVAILABLE", "QUARANTINED"] }).notNull().default("AVAILABLE"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    unique("inventory_lots_clinic_medication_lot_unique").on(
      table.clinicId, table.medicationId, table.lotNumber,
    ),
    check("inventory_lots_medication_revision_check", sql`${table.medicationRevision} >= 1`),
    check("inventory_lots_revision_check", sql`${table.revision} >= 1`),
    check("inventory_lots_display_name_snapshot_check", sql`length(${table.displayNameSnapshot}) BETWEEN 1 AND 200`),
    check("inventory_lots_strength_snapshot_check", sql`length(${table.strengthSnapshot}) BETWEEN 1 AND 100`),
    check("inventory_lots_dosage_form_snapshot_check", sql`length(${table.dosageFormSnapshot}) BETWEEN 1 AND 100`),
    check("inventory_lots_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
    check("inventory_lots_lot_number_check", sql`length(trim(${table.lotNumber})) BETWEEN 1 AND 100`),
    check("inventory_lots_expiry_date_check", sql`${table.expiryDate} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("inventory_lots_supplier_name_check", sql`length(trim(${table.supplierName})) BETWEEN 1 AND 200`),
    check("inventory_lots_status_check", sql`${table.status} IN ('AVAILABLE', 'QUARANTINED')`),
  ],
);

export const inventoryReceipts = sqliteTable(
  "inventory_receipts",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    supplierName: text("supplier_name").notNull(),
    note: text("note").notNull().default(""),
    receivedAt: text("received_at").notNull(),
    receivedBy: text("received_by").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    check("inventory_receipts_supplier_name_check", sql`length(trim(${table.supplierName})) BETWEEN 1 AND 200`),
    check("inventory_receipts_note_check", sql`length(${table.note}) <= 500`),
  ],
);

export const inventoryReceiptLines = sqliteTable(
  "inventory_receipt_lines",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id").notNull().references(() => inventoryReceipts.id),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id),
    quantity: integer("quantity").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
  },
  (table) => [
    check("inventory_receipt_lines_quantity_check", sql`${table.quantity} BETWEEN 1 AND 999999`),
    check("inventory_receipt_lines_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
  ],
);

export const inventoryStockMovements = sqliteTable(
  "inventory_stock_movements",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id),
    movementType: text("movement_type", { enum: ["RECEIPT", "DISPENSE"] }).notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    sourceType: text("source_type", { enum: ["RECEIPT", "DISPENSE"] }).notNull(),
    // Polymorphic source validated by database triggers. A static FK here would
    // incorrectly force DISPENSE movements to reference receipts.
    sourceId: text("source_id").notNull(),
    reason: text("reason").notNull().default(""),
    occurredAt: text("occurred_at").notNull(),
    actorId: text("actor_id").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    uniqueIndex("inventory_stock_movements_source_lot_unique").on(table.sourceType, table.sourceId, table.lotId),
    check("inventory_stock_movements_movement_type_check", sql`${table.movementType} IN ('RECEIPT', 'DISPENSE')`),
    check("inventory_stock_movements_quantity_delta_check", sql`${table.quantityDelta} BETWEEN -999999 AND 999999 AND ${table.quantityDelta} <> 0`),
    check("inventory_stock_movements_source_type_check", sql`${table.sourceType} IN ('RECEIPT', 'DISPENSE')`),
    check("inventory_stock_movements_shape_check", sql`(${table.movementType} = 'RECEIPT' AND ${table.sourceType} = 'RECEIPT' AND ${table.quantityDelta} > 0) OR (${table.movementType} = 'DISPENSE' AND ${table.sourceType} = 'DISPENSE' AND ${table.quantityDelta} < 0)`),
    check("inventory_stock_movements_reason_check", sql`length(${table.reason}) <= 500`),
  ],
);

export const inventoryReservationStatuses = ["ACTIVE", "RELEASED", "CONSUMED"] as const;

export const inventoryReservations = sqliteTable(
  "inventory_reservations",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    visitId: text("visit_id").notNull().references(() => visits.id),
    medicationDecisionId: text("medication_decision_id").notNull().references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    status: text("status", { enum: [...inventoryReservationStatuses] as [string, ...string[]] })
      .notNull().default("ACTIVE"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().references(() => staffAccounts.id),
    releasedAt: text("released_at"),
    releasedBy: text("released_by").references(() => staffAccounts.id),
    releaseReason: text("release_reason"),
    consumedAt: text("consumed_at"),
    consumedBy: text("consumed_by").references(() => staffAccounts.id),
    consumedDispenseId: text("consumed_dispense_id"),
  },
  (table) => [
    uniqueIndex("inventory_reservations_active_visit_decision_unique")
      .on(table.clinicId, table.visitId, table.medicationDecisionId, table.medicationDecisionVersion)
      .where(sql`${table.status} = 'ACTIVE'`),
    index("inventory_reservations_visit_created_index").on(table.clinicId, table.visitId, table.createdAt),
    check("inventory_reservations_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`),
    check("inventory_reservations_status_check", sql`${table.status} IN ('ACTIVE', 'RELEASED', 'CONSUMED')`),
    check(
      "inventory_reservations_release_fields_check",
      sql`(${table.status} <> 'RELEASED' AND ${table.releasedAt} IS NULL AND ${table.releasedBy} IS NULL AND ${table.releaseReason} IS NULL)
        OR (${table.status} = 'RELEASED' AND ${table.releasedAt} IS NOT NULL AND ${table.releasedBy} IS NOT NULL AND length(trim(${table.releaseReason})) BETWEEN 1 AND 500)`,
    ),
    check("inventory_reservations_release_reason_check", sql`${table.releaseReason} IS NULL OR length(${table.releaseReason}) <= 500`),
  ],
);

export const inventoryReservationAllocations = sqliteTable(
  "inventory_reservation_allocations",
  {
    id: text("id").primaryKey(),
    reservationId: text("reservation_id").notNull().references(() => inventoryReservations.id),
    medicationOrderItemId: text("medication_order_item_id").notNull().references(() => medicationOrderItems.id),
    lotId: text("lot_id").notNull().references(() => inventoryLots.id),
    position: integer("position").notNull(),
    quantity: integer("quantity").notNull(),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    lotNumberSnapshot: text("lot_number_snapshot").notNull(),
    expiryDateSnapshot: text("expiry_date_snapshot").notNull(),
    unitSnapshot: text("unit_snapshot").notNull(),
    allocatedAt: text("allocated_at").notNull(),
  },
  (table) => [
    unique("inventory_reservation_allocations_reservation_item_lot_unique")
      .on(table.reservationId, table.medicationOrderItemId, table.lotId),
    index("inventory_reservation_allocations_lot_index").on(table.lotId),
    check("inventory_reservation_allocations_position_check", sql`${table.position} >= 0`),
    check("inventory_reservation_allocations_quantity_check", sql`${table.quantity} BETWEEN 1 AND 999999`),
    check("inventory_reservation_allocations_medication_id_check", sql`length(${table.medicationId}) > 0`),
    check("inventory_reservation_allocations_lot_number_snapshot_check", sql`length(trim(${table.lotNumberSnapshot})) BETWEEN 1 AND 100`),
    check("inventory_reservation_allocations_expiry_date_snapshot_check", sql`${table.expiryDateSnapshot} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`),
    check("inventory_reservation_allocations_unit_snapshot_check", sql`length(${table.unitSnapshot}) BETWEEN 1 AND 100`),
  ],
);
