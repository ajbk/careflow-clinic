import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { medications } from "../medication/schema.js";
import { clinicConfig, staffAccounts } from "../platform/schema.js";

export const inventoryLots = sqliteTable(
  "inventory_lots",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id").notNull().references(() => clinicConfig.id),
    medicationId: text("medication_id").notNull().references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
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
    movementType: text("movement_type", { enum: ["RECEIPT"] }).notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    sourceType: text("source_type", { enum: ["RECEIPT"] }).notNull(),
    sourceId: text("source_id").notNull().references(() => inventoryReceipts.id),
    reason: text("reason").notNull().default(""),
    occurredAt: text("occurred_at").notNull(),
    actorId: text("actor_id").notNull().references(() => staffAccounts.id),
  },
  (table) => [
    check("inventory_stock_movements_movement_type_check", sql`${table.movementType} = 'RECEIPT'`),
    check("inventory_stock_movements_quantity_delta_check", sql`${table.quantityDelta} BETWEEN 1 AND 999999`),
    check("inventory_stock_movements_source_type_check", sql`${table.sourceType} = 'RECEIPT'`),
    check("inventory_stock_movements_reason_check", sql`length(${table.reason}) <= 500`),
  ],
);
