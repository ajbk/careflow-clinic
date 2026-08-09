import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { fulfillmentDispenseLines, fulfillmentDispenses } from "../fulfillment/schema.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import { clinicConfig, staffAccounts } from "../platform/schema.js";
import { visits } from "../visit/schema.js";

export const medicationOrderPriceSnapshots = sqliteTable(
  "medication_order_price_snapshots",
  {
    id: text("id").primaryKey(),
    medicationOrderItemId: text("medication_order_item_id")
      .notNull()
      .references(() => medicationOrderItems.id),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id),
    medicationRevision: integer("medication_revision").notNull(),
    unitPriceBahtSnapshot: integer("unit_price_baht_snapshot").notNull(),
    currency: text("currency", { enum: ["THB"] }).notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    unique("medication_order_price_snapshots_order_item_unique").on(table.medicationOrderItemId),
    check("medication_order_price_snapshots_medication_revision_check", sql`${table.medicationRevision} >= 1`),
    check("medication_order_price_snapshots_unit_price_baht_check", sql`typeof(${table.unitPriceBahtSnapshot}) = 'integer' AND ${table.unitPriceBahtSnapshot} BETWEEN 0 AND 1000000`),
    check("medication_order_price_snapshots_currency_check", sql`${table.currency} = 'THB'`),
  ],
);

export const fulfillmentDispensePriceSnapshots = sqliteTable(
  "fulfillment_dispense_price_snapshots",
  {
    id: text("id").primaryKey(),
    fulfillmentDispenseLineId: text("fulfillment_dispense_line_id")
      .notNull()
      .references(() => fulfillmentDispenseLines.id),
    orderPriceSnapshotId: text("order_price_snapshot_id")
      .notNull()
      .references(() => medicationOrderPriceSnapshots.id),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id),
    unitPriceBahtSnapshot: integer("unit_price_baht_snapshot").notNull(),
    currency: text("currency", { enum: ["THB"] }).notNull(),
    capturedAt: text("captured_at").notNull(),
  },
  (table) => [
    unique("fulfillment_dispense_price_snapshots_dispense_line_unique").on(table.fulfillmentDispenseLineId),
    check("fulfillment_dispense_price_snapshots_unit_price_baht_check", sql`typeof(${table.unitPriceBahtSnapshot}) = 'integer' AND ${table.unitPriceBahtSnapshot} BETWEEN 0 AND 1000000`),
    check("fulfillment_dispense_price_snapshots_currency_check", sql`${table.currency} = 'THB'`),
  ],
);

const financeHashCheck = (column: ReturnType<typeof text>) =>
  sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export const financeCharges = sqliteTable(
  "finance_charges",
  {
    id: text("id").primaryKey(),
    clinicId: text("clinic_id")
      .notNull()
      .references(() => clinicConfig.id),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    sourceKind: text("source_kind", { enum: ["ORDER", "NO_MEDICATION"] }).notNull(),
    medicationDecisionId: text("medication_decision_id")
      .notNull()
      .references(() => medicationDecisions.id),
    medicationDecisionVersion: integer("medication_decision_version").notNull(),
    fulfillmentDispenseId: text("fulfillment_dispense_id").references(() => fulfillmentDispenses.id),
    clinicPricingRevision: integer("clinic_pricing_revision").notNull(),
    consultationFeeBahtSnapshot: integer("consultation_fee_baht_snapshot").notNull(),
    currency: text("currency", { enum: ["THB"] }).notNull(),
    lineCount: integer("line_count").notNull(),
    finalizedBy: text("finalized_by")
      .notNull()
      .references(() => staffAccounts.id),
    finalizedByDisplayName: text("finalized_by_display_name").notNull(),
    finalizedAt: text("finalized_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("finance_charges_visit_unique").on(table.visitId),
    check("finance_charges_source_kind_check", sql`${table.sourceKind} IN ('ORDER', 'NO_MEDICATION')`),
    check("finance_charges_medication_decision_version_check", sql`${table.medicationDecisionVersion} >= 1`),
    check("finance_charges_clinic_pricing_revision_check", sql`${table.clinicPricingRevision} >= 1`),
    check("finance_charges_consultation_fee_baht_snapshot_check", sql`typeof(${table.consultationFeeBahtSnapshot}) = 'integer' AND ${table.consultationFeeBahtSnapshot} BETWEEN 1 AND 1000000`),
    check("finance_charges_currency_check", sql`${table.currency} = 'THB'`),
    check("finance_charges_line_count_check", sql`${table.lineCount} BETWEEN 1 AND 21`),
    check("finance_charges_finalized_by_display_name_check", sql`length(trim(${table.finalizedByDisplayName})) BETWEEN 1 AND 200`),
    check("finance_charges_content_hash_check", financeHashCheck(table.contentHash)),
    check(
      "finance_charges_source_shape_check",
      sql`(${table.sourceKind} = 'ORDER' AND ${table.fulfillmentDispenseId} IS NOT NULL) OR (${table.sourceKind} = 'NO_MEDICATION' AND ${table.fulfillmentDispenseId} IS NULL)`,
    ),
  ],
);

export const financeChargeLines = sqliteTable(
  "finance_charge_lines",
  {
    id: text("id").primaryKey(),
    chargeId: text("charge_id")
      .notNull()
      .references(() => financeCharges.id),
    position: integer("position").notNull(),
    lineType: text("line_type", { enum: ["CONSULTATION", "MEDICATION"] }).notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceBaht: integer("unit_price_baht").notNull(),
    lineTotalBaht: integer("line_total_baht").notNull(),
    medicationOrderItemId: text("medication_order_item_id").references(() => medicationOrderItems.id),
    fulfillmentDispenseLineId: text("fulfillment_dispense_line_id").references(() => fulfillmentDispenseLines.id),
  },
  (table) => [
    unique("finance_charge_lines_charge_position_unique").on(table.chargeId, table.position),
    unique("finance_charge_lines_dispense_line_unique").on(table.fulfillmentDispenseLineId),
    uniqueIndex("finance_charge_lines_one_consultation_per_charge")
      .on(table.chargeId)
      .where(sql`${table.lineType} = 'CONSULTATION'`),
    check("finance_charge_lines_position_check", sql`${table.position} BETWEEN 0 AND 20`),
    check("finance_charge_lines_line_type_check", sql`${table.lineType} IN ('CONSULTATION', 'MEDICATION')`),
    check("finance_charge_lines_description_snapshot_check", sql`length(trim(${table.descriptionSnapshot})) BETWEEN 1 AND 200`),
    check("finance_charge_lines_quantity_check", sql`typeof(${table.quantity}) = 'integer' AND ${table.quantity} BETWEEN 1 AND 999999`),
    check("finance_charge_lines_unit_price_baht_check", sql`typeof(${table.unitPriceBaht}) = 'integer' AND ${table.unitPriceBaht} BETWEEN 0 AND 1000000`),
    check("finance_charge_lines_line_total_baht_check", sql`typeof(${table.lineTotalBaht}) = 'integer' AND ${table.lineTotalBaht} BETWEEN 0 AND 100000000 AND ${table.lineTotalBaht} = ${table.quantity} * ${table.unitPriceBaht}`),
    check(
      "finance_charge_lines_source_shape_check",
      sql`(${table.lineType} = 'CONSULTATION' AND ${table.position} = 0 AND ${table.quantity} = 1 AND ${table.medicationOrderItemId} IS NULL AND ${table.fulfillmentDispenseLineId} IS NULL) OR (${table.lineType} = 'MEDICATION' AND ${table.position} BETWEEN 1 AND 20 AND ${table.medicationOrderItemId} IS NOT NULL AND ${table.fulfillmentDispenseLineId} IS NOT NULL)`,
    ),
  ],
);

export const financeChargeAdjustments = sqliteTable(
  "finance_charge_adjustments",
  {
    id: text("id").primaryKey(),
    chargeId: text("charge_id")
      .notNull()
      .references(() => financeCharges.id),
    kind: text("kind", { enum: ["FULL_WAIVER"] }).notNull(),
    amountBaht: integer("amount_baht").notNull(),
    reason: text("reason").notNull(),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => staffAccounts.id),
    approvedByDisplayName: text("approved_by_display_name").notNull(),
    approvedAt: text("approved_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("finance_charge_adjustments_charge_unique").on(table.chargeId),
    check("finance_charge_adjustments_kind_check", sql`${table.kind} = 'FULL_WAIVER'`),
    check("finance_charge_adjustments_amount_baht_check", sql`typeof(${table.amountBaht}) = 'integer' AND ${table.amountBaht} BETWEEN -100000000 AND -1`),
    check("finance_charge_adjustments_reason_check", sql`length(trim(${table.reason})) BETWEEN 1 AND 500`),
    check("finance_charge_adjustments_approved_by_display_name_check", sql`length(trim(${table.approvedByDisplayName})) BETWEEN 1 AND 200`),
    check("finance_charge_adjustments_content_hash_check", financeHashCheck(table.contentHash)),
  ],
);

export const financePayments = sqliteTable(
  "finance_payments",
  {
    id: text("id").primaryKey(),
    chargeId: text("charge_id")
      .notNull()
      .references(() => financeCharges.id),
    visitId: text("visit_id")
      .notNull()
      .references(() => visits.id),
    method: text("method", { enum: ["CASH", "PROMPTPAY"] }).notNull(),
    amountBaht: integer("amount_baht").notNull(),
    manualReference: text("manual_reference"),
    confirmedBy: text("confirmed_by")
      .notNull()
      .references(() => staffAccounts.id),
    confirmedByDisplayName: text("confirmed_by_display_name").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    unique("finance_payments_charge_unique").on(table.chargeId),
    unique("finance_payments_visit_unique").on(table.visitId),
    check("finance_payments_method_check", sql`${table.method} IN ('CASH', 'PROMPTPAY')`),
    check("finance_payments_amount_baht_check", sql`typeof(${table.amountBaht}) = 'integer' AND ${table.amountBaht} BETWEEN 1 AND 100000000`),
    check(
      "finance_payments_manual_reference_check",
      sql`(${table.method} = 'CASH' AND ${table.manualReference} IS NULL) OR (${table.method} = 'PROMPTPAY' AND length(trim(${table.manualReference})) BETWEEN 1 AND 100)`,
    ),
    check("finance_payments_confirmed_by_display_name_check", sql`length(trim(${table.confirmedByDisplayName})) BETWEEN 1 AND 200`),
    check("finance_payments_content_hash_check", financeHashCheck(table.contentHash)),
  ],
);
