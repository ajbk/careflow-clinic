CREATE TABLE `inventory_reservation_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`medication_order_item_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`position` integer NOT NULL,
	`quantity` integer NOT NULL,
	`medication_id` text NOT NULL,
	`lot_number_snapshot` text NOT NULL,
	`expiry_date_snapshot` text NOT NULL,
	`unit_snapshot` text NOT NULL,
	`allocated_at` text NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_reservation_allocations_position_check" CHECK("inventory_reservation_allocations"."position" >= 0),
	CONSTRAINT "inventory_reservation_allocations_quantity_check" CHECK("inventory_reservation_allocations"."quantity" BETWEEN 1 AND 999999),
	CONSTRAINT "inventory_reservation_allocations_medication_id_check" CHECK(length("inventory_reservation_allocations"."medication_id") > 0),
	CONSTRAINT "inventory_reservation_allocations_lot_number_snapshot_check" CHECK(length(trim("inventory_reservation_allocations"."lot_number_snapshot")) BETWEEN 1 AND 100),
	CONSTRAINT "inventory_reservation_allocations_expiry_date_snapshot_check" CHECK("inventory_reservation_allocations"."expiry_date_snapshot" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "inventory_reservation_allocations_unit_snapshot_check" CHECK(length("inventory_reservation_allocations"."unit_snapshot") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX `inventory_reservation_allocations_lot_index` ON `inventory_reservation_allocations` (`lot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_reservation_allocations_reservation_item_lot_unique` ON `inventory_reservation_allocations` (`reservation_id`,`medication_order_item_id`,`lot_id`);--> statement-breakpoint
CREATE TABLE `inventory_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`released_at` text,
	`released_by` text,
	`release_reason` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_reservations_decision_version_check" CHECK("inventory_reservations"."medication_decision_version" >= 1),
	CONSTRAINT "inventory_reservations_status_check" CHECK("inventory_reservations"."status" IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
	CONSTRAINT "inventory_reservations_release_fields_check" CHECK(("inventory_reservations"."status" <> 'RELEASED' AND "inventory_reservations"."released_at" IS NULL AND "inventory_reservations"."released_by" IS NULL AND "inventory_reservations"."release_reason" IS NULL)
        OR ("inventory_reservations"."status" = 'RELEASED' AND "inventory_reservations"."released_at" IS NOT NULL AND "inventory_reservations"."released_by" IS NOT NULL AND length(trim("inventory_reservations"."release_reason")) BETWEEN 1 AND 500)),
	CONSTRAINT "inventory_reservations_release_reason_check" CHECK("inventory_reservations"."release_reason" IS NULL OR length("inventory_reservations"."release_reason") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_reservations_active_visit_decision_unique` ON `inventory_reservations` (`clinic_id`,`visit_id`,`medication_decision_id`,`medication_decision_version`) WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX `inventory_reservations_visit_created_index` ON `inventory_reservations` (`clinic_id`,`visit_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_allocations_block_update`
BEFORE UPDATE ON `inventory_reservation_allocations`
BEGIN
  SELECT RAISE(ABORT, 'inventory_reservation_allocations are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_allocations_block_delete`
BEFORE DELETE ON `inventory_reservation_allocations`
BEGIN
  SELECT RAISE(ABORT, 'inventory_reservation_allocations are append-only');
END;
