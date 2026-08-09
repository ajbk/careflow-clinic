import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { fulfillmentDispenseLines } from "../fulfillment/schema.js";
import { medicationOrderItems, medications } from "../medication/schema.js";

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
