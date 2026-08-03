CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`hn` text NOT NULL,
	`display_name` text NOT NULL,
	`phone` text NOT NULL,
	`birth_date` text NOT NULL,
	`sex` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patients_hn_check" CHECK(length("patients"."hn") = 11 AND "patients"."hn" GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "patients_display_name_check" CHECK("patients"."display_name" = 'ผู้ป่วยทดสอบ ' || substr("patients"."hn", 6)),
	CONSTRAINT "patients_phone_check" CHECK(length("patients"."phone") = 10 AND "patients"."phone" GLOB '000000[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "patients_phone_hn_check" CHECK("patients"."phone" = '000000' || substr("patients"."hn", -4)),
	CONSTRAINT "patients_demographics_check" CHECK("patients"."birth_date" = '1990-01-01' AND "patients"."sex" = 'unknown'),
	CONSTRAINT "patients_revision_check" CHECK("patients"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_clinic_hn_unique` ON `patients` (`clinic_id`,`hn`);
--> statement-breakpoint
INSERT OR IGNORE INTO `clinic_counters` (`key`, `value`)
VALUES ('synthetic_patient', 0);
