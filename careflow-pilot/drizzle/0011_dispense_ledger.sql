-- The movement table is a leaf: it has outbound references only. Rebuild it
-- with foreign_keys still enabled so any unexpected inbound dependency fails.
CREATE TABLE `__new_inventory_stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`movement_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_stock_movements_movement_type_check" CHECK("__new_inventory_stock_movements"."movement_type" IN ('RECEIPT', 'DISPENSE')),
	CONSTRAINT "inventory_stock_movements_quantity_delta_check" CHECK("__new_inventory_stock_movements"."quantity_delta" BETWEEN -999999 AND 999999 AND "__new_inventory_stock_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_stock_movements_source_type_check" CHECK("__new_inventory_stock_movements"."source_type" IN ('RECEIPT', 'DISPENSE')),
	CONSTRAINT "inventory_stock_movements_shape_check" CHECK(("__new_inventory_stock_movements"."movement_type" = 'RECEIPT' AND "__new_inventory_stock_movements"."source_type" = 'RECEIPT' AND "__new_inventory_stock_movements"."quantity_delta" > 0) OR ("__new_inventory_stock_movements"."movement_type" = 'DISPENSE' AND "__new_inventory_stock_movements"."source_type" = 'DISPENSE' AND "__new_inventory_stock_movements"."quantity_delta" < 0)),
	CONSTRAINT "inventory_stock_movements_reason_check" CHECK(length("__new_inventory_stock_movements"."reason") <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_inventory_stock_movements` (`id`, `clinic_id`, `lot_id`, `movement_type`, `quantity_delta`, `source_type`, `source_id`, `reason`, `occurred_at`, `actor_id`)
SELECT `id`, `clinic_id`, `lot_id`, `movement_type`, `quantity_delta`, `source_type`, `source_id`, `reason`, `occurred_at`, `actor_id`
FROM `inventory_stock_movements`;
--> statement-breakpoint
DROP TABLE `inventory_stock_movements`;
--> statement-breakpoint
ALTER TABLE `__new_inventory_stock_movements` RENAME TO `inventory_stock_movements`;
--> statement-breakpoint
CREATE TRIGGER `inventory_stock_movements_source_insert_guard`
BEFORE INSERT ON `inventory_stock_movements`
WHEN (NEW.source_type = 'RECEIPT' AND NOT EXISTS (
  SELECT 1 FROM `inventory_receipt_lines` AS line
  WHERE line.receipt_id = NEW.source_id AND line.lot_id = NEW.lot_id AND line.quantity = NEW.quantity_delta
)) OR (NEW.source_type = 'DISPENSE' AND NOT EXISTS (
  SELECT 1 FROM `fulfillment_dispense_lines` AS line
  WHERE line.id = NEW.source_id AND line.lot_id = NEW.lot_id AND line.quantity = -NEW.quantity_delta
))
BEGIN
  SELECT RAISE(ABORT, 'inventory stock movement source is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_stock_movements_block_update`
BEFORE UPDATE ON `inventory_stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'inventory_stock_movements are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_stock_movements_block_delete`
BEFORE DELETE ON `inventory_stock_movements`
BEGIN
  SELECT RAISE(ABORT, 'inventory_stock_movements are append-only');
END;
