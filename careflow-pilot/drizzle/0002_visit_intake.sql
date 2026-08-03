CREATE TABLE `intake_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`weight_kg` real,
	`height_cm` real,
	`temperature_c` real,
	`systolic_mmhg` integer,
	`diastolic_mmhg` integer,
	`heart_rate_bpm` integer,
	`spo2_percent` integer,
	`recorded_by` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "intake_weight_check" CHECK("intake_observations"."weight_kg" IS NULL OR "intake_observations"."weight_kg" BETWEEN 1 AND 350),
	CONSTRAINT "intake_height_check" CHECK("intake_observations"."height_cm" IS NULL OR "intake_observations"."height_cm" BETWEEN 30 AND 250),
	CONSTRAINT "intake_temperature_check" CHECK("intake_observations"."temperature_c" IS NULL OR "intake_observations"."temperature_c" BETWEEN 30 AND 45),
	CONSTRAINT "intake_systolic_check" CHECK("intake_observations"."systolic_mmhg" IS NULL OR "intake_observations"."systolic_mmhg" BETWEEN 50 AND 260),
	CONSTRAINT "intake_diastolic_check" CHECK("intake_observations"."diastolic_mmhg" IS NULL OR "intake_observations"."diastolic_mmhg" BETWEEN 30 AND 180),
	CONSTRAINT "intake_heart_rate_check" CHECK("intake_observations"."heart_rate_bpm" IS NULL OR "intake_observations"."heart_rate_bpm" BETWEEN 20 AND 250),
	CONSTRAINT "intake_spo2_check" CHECK("intake_observations"."spo2_percent" IS NULL OR "intake_observations"."spo2_percent" BETWEEN 50 AND 100),
	CONSTRAINT "intake_blood_pressure_relationship_check" CHECK("intake_observations"."systolic_mmhg" IS NULL OR "intake_observations"."diastolic_mmhg" IS NULL OR "intake_observations"."systolic_mmhg" >= "intake_observations"."diastolic_mmhg")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_observations_visit_id_unique` ON `intake_observations` (`visit_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`chief_complaint` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`arrived_at` text NOT NULL,
	`started_at` text,
	`closed_at` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visits_status_check" CHECK("visits"."status" IN ('WAITING', 'CONSULTING', 'AWAITING_PREPARATION', 'PREPARING', 'AWAITING_RELEASE', 'AWAITING_HANDOFF', 'AWAITING_ORDER_REVISION', 'AWAITING_CHARGE', 'AWAITING_PAYMENT', 'READY_TO_CLOSE', 'CLOSED')),
	CONSTRAINT "visits_chief_complaint_check" CHECK(length(trim("visits"."chief_complaint")) BETWEEN 1 AND 500),
	CONSTRAINT "visits_revision_check" CHECK("visits"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visits_clinic_patient_active_unique` ON `visits` (`clinic_id`,`patient_id`) WHERE "visits"."status" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX `visits_clinic_status_arrived_index` ON `visits` (`clinic_id`,`status`,`arrived_at`);