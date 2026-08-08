CREATE TABLE `inventory_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`medication_revision` integer NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`strength_snapshot` text NOT NULL,
	`dosage_form_snapshot` text NOT NULL,
	`unit_snapshot` text NOT NULL,
	`lot_number` text NOT NULL,
	`expiry_date` text NOT NULL,
	`supplier_name` text NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_lots_medication_revision_check" CHECK("inventory_lots"."medication_revision" >= 1),
	CONSTRAINT "inventory_lots_display_name_snapshot_check" CHECK(length("inventory_lots"."display_name_snapshot") BETWEEN 1 AND 200),
	CONSTRAINT "inventory_lots_strength_snapshot_check" CHECK(length("inventory_lots"."strength_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "inventory_lots_dosage_form_snapshot_check" CHECK(length("inventory_lots"."dosage_form_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "inventory_lots_unit_snapshot_check" CHECK(length("inventory_lots"."unit_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "inventory_lots_lot_number_check" CHECK(length(trim("inventory_lots"."lot_number")) BETWEEN 1 AND 100),
	CONSTRAINT "inventory_lots_expiry_date_check" CHECK("inventory_lots"."expiry_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "inventory_lots_supplier_name_check" CHECK(length(trim("inventory_lots"."supplier_name")) BETWEEN 1 AND 200),
	CONSTRAINT "inventory_lots_status_check" CHECK("inventory_lots"."status" IN ('AVAILABLE', 'QUARANTINED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_lots_clinic_medication_lot_unique` ON `inventory_lots` (`clinic_id`,`medication_id`,`lot_number`);--> statement-breakpoint
CREATE TABLE `inventory_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_snapshot` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `inventory_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_receipt_lines_quantity_check" CHECK("inventory_receipt_lines"."quantity" BETWEEN 1 AND 999999),
	CONSTRAINT "inventory_receipt_lines_unit_snapshot_check" CHECK(length("inventory_receipt_lines"."unit_snapshot") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE `inventory_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`received_at` text NOT NULL,
	`received_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_receipts_supplier_name_check" CHECK(length(trim("inventory_receipts"."supplier_name")) BETWEEN 1 AND 200),
	CONSTRAINT "inventory_receipts_note_check" CHECK(length("inventory_receipts"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE `inventory_stock_movements` (
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
	FOREIGN KEY (`source_id`) REFERENCES `inventory_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_stock_movements_movement_type_check" CHECK("inventory_stock_movements"."movement_type" = 'RECEIPT'),
	CONSTRAINT "inventory_stock_movements_quantity_delta_check" CHECK("inventory_stock_movements"."quantity_delta" BETWEEN 1 AND 999999),
	CONSTRAINT "inventory_stock_movements_source_type_check" CHECK("inventory_stock_movements"."source_type" = 'RECEIPT'),
	CONSTRAINT "inventory_stock_movements_reason_check" CHECK(length("inventory_stock_movements"."reason") <= 500)
);
--> statement-breakpoint
CREATE TRIGGER `inventory_receipts_block_update`
BEFORE UPDATE ON `inventory_receipts`
BEGIN
	SELECT RAISE(ABORT, 'inventory_receipts are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipts_block_delete`
BEFORE DELETE ON `inventory_receipts`
BEGIN
	SELECT RAISE(ABORT, 'inventory_receipts are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipt_lines_block_update`
BEFORE UPDATE ON `inventory_receipt_lines`
BEGIN
	SELECT RAISE(ABORT, 'inventory_receipt_lines are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipt_lines_block_delete`
BEFORE DELETE ON `inventory_receipt_lines`
BEGIN
	SELECT RAISE(ABORT, 'inventory_receipt_lines are append-only');
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
