PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_inventory_reservations` (
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
	CONSTRAINT "inventory_reservations_decision_version_check" CHECK("__new_inventory_reservations"."medication_decision_version" >= 1),
	CONSTRAINT "inventory_reservations_status_check" CHECK("__new_inventory_reservations"."status" IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
	CONSTRAINT "inventory_reservations_release_fields_check" CHECK(("__new_inventory_reservations"."status" <> 'RELEASED' AND "__new_inventory_reservations"."released_at" IS NULL AND "__new_inventory_reservations"."released_by" IS NULL AND "__new_inventory_reservations"."release_reason" IS NULL)
        OR ("__new_inventory_reservations"."status" = 'RELEASED' AND "__new_inventory_reservations"."released_at" IS NOT NULL AND "__new_inventory_reservations"."released_by" IS NOT NULL AND "__new_inventory_reservations"."release_reason" IS NOT NULL AND length(trim("__new_inventory_reservations"."release_reason")) BETWEEN 1 AND 500)),
	CONSTRAINT "inventory_reservations_release_reason_check" CHECK("__new_inventory_reservations"."release_reason" IS NULL OR length("__new_inventory_reservations"."release_reason") <= 500)
);
--> statement-breakpoint
INSERT INTO `__new_inventory_reservations`("id", "clinic_id", "visit_id", "medication_decision_id", "medication_decision_version", "status", "created_at", "created_by", "released_at", "released_by", "release_reason") SELECT "id", "clinic_id", "visit_id", "medication_decision_id", "medication_decision_version", "status", "created_at", "created_by", "released_at", "released_by", "release_reason" FROM `inventory_reservations`;--> statement-breakpoint
DROP TABLE `inventory_reservations`;--> statement-breakpoint
ALTER TABLE `__new_inventory_reservations` RENAME TO `inventory_reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_reservations_active_visit_decision_unique` ON `inventory_reservations` (`clinic_id`,`visit_id`,`medication_decision_id`,`medication_decision_version`) WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX `inventory_reservations_visit_created_index` ON `inventory_reservations` (`clinic_id`,`visit_id`,`created_at`);