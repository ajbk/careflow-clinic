CREATE TABLE `inventory_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`corrects_movement_id` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrects_movement_id`) REFERENCES `inventory_stock_movements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_adjustments_quantity_delta_check" CHECK("inventory_adjustments"."quantity_delta" BETWEEN -999999 AND 999999 AND "inventory_adjustments"."quantity_delta" <> 0),
	CONSTRAINT "inventory_adjustments_reason_check" CHECK(length(trim("inventory_adjustments"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE TABLE `inventory_lot_status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`next_status` text NOT NULL,
	`reason` text NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_id` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_lot_status_events_previous_status_check" CHECK("inventory_lot_status_events"."previous_status" IN ('AVAILABLE', 'QUARANTINED')),
	CONSTRAINT "inventory_lot_status_events_next_status_check" CHECK("inventory_lot_status_events"."next_status" IN ('AVAILABLE', 'QUARANTINED')),
	CONSTRAINT "inventory_lot_status_events_transition_check" CHECK("inventory_lot_status_events"."previous_status" <> "inventory_lot_status_events"."next_status"),
	CONSTRAINT "inventory_lot_status_events_reason_check" CHECK(length(trim("inventory_lot_status_events"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `inventory_lot_status_events_lot_occurred_index` ON `inventory_lot_status_events` (`lot_id`,`occurred_at`);--> statement-breakpoint
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
	CONSTRAINT "inventory_stock_movements_movement_type_check" CHECK("__new_inventory_stock_movements"."movement_type" IN ('RECEIPT', 'DISPENSE', 'ADJUSTMENT')),
	CONSTRAINT "inventory_stock_movements_quantity_delta_check" CHECK("__new_inventory_stock_movements"."quantity_delta" BETWEEN -999999 AND 999999 AND "__new_inventory_stock_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_stock_movements_source_type_check" CHECK("__new_inventory_stock_movements"."source_type" IN ('RECEIPT', 'DISPENSE', 'ADJUSTMENT')),
	CONSTRAINT "inventory_stock_movements_shape_check" CHECK(("__new_inventory_stock_movements"."movement_type" = 'RECEIPT' AND "__new_inventory_stock_movements"."source_type" = 'RECEIPT' AND "__new_inventory_stock_movements"."quantity_delta" > 0) OR ("__new_inventory_stock_movements"."movement_type" = 'DISPENSE' AND "__new_inventory_stock_movements"."source_type" = 'DISPENSE' AND "__new_inventory_stock_movements"."quantity_delta" < 0) OR ("__new_inventory_stock_movements"."movement_type" = 'ADJUSTMENT' AND "__new_inventory_stock_movements"."source_type" = 'ADJUSTMENT')),
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
CREATE UNIQUE INDEX `inventory_stock_movements_source_lot_unique` ON `inventory_stock_movements` (`source_type`,`source_id`,`lot_id`);
--> statement-breakpoint
CREATE TRIGGER `inventory_stock_movements_source_insert_guard`
BEFORE INSERT ON `inventory_stock_movements`
WHEN (NEW.source_type = 'RECEIPT' AND NOT EXISTS (
  SELECT 1 FROM `inventory_receipt_lines` AS line
  WHERE line.receipt_id = NEW.source_id AND line.lot_id = NEW.lot_id AND line.quantity = NEW.quantity_delta
)) OR (NEW.source_type = 'DISPENSE' AND NOT EXISTS (
  SELECT 1 FROM `fulfillment_dispense_lines` AS line
  WHERE line.id = NEW.source_id AND line.lot_id = NEW.lot_id AND line.quantity = -NEW.quantity_delta
)) OR (NEW.source_type = 'ADJUSTMENT' AND NOT EXISTS (
  SELECT 1 FROM `inventory_adjustments` AS adjustment
  WHERE adjustment.id = NEW.source_id AND adjustment.lot_id = NEW.lot_id AND adjustment.quantity_delta = NEW.quantity_delta
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
--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_block_update`
BEFORE UPDATE ON `inventory_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'inventory_adjustments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_block_delete`
BEFORE DELETE ON `inventory_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'inventory_adjustments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lot_status_events_block_update`
BEFORE UPDATE ON `inventory_lot_status_events`
BEGIN
  SELECT RAISE(ABORT, 'inventory_lot_status_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lot_status_events_block_delete`
BEFORE DELETE ON `inventory_lot_status_events`
BEGIN
  SELECT RAISE(ABORT, 'inventory_lot_status_events are append-only');
END;
