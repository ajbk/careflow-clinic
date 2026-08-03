CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`actor_id` text,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_revision` integer NOT NULL,
	`reason` text,
	`occurred_at` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_events_actor_role_check" CHECK("audit_events"."actor_role" IN ('assistant', 'doctor', 'system')),
	CONSTRAINT "audit_events_entity_revision_check" CHECK("audit_events"."entity_revision" >= 1),
	CONSTRAINT "audit_events_metadata_json_check" CHECK(json_valid("audit_events"."metadata_json")),
	CONSTRAINT "audit_events_actor_identity_check" CHECK(("audit_events"."actor_role" = 'system' AND "audit_events"."actor_id" IS NULL) OR ("audit_events"."actor_role" IN ('assistant', 'doctor') AND "audit_events"."actor_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `clinic_config` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`synthetic_only` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "clinic_config_id_check" CHECK("clinic_config"."id" = 'clinic'),
	CONSTRAINT "clinic_config_name_check" CHECK(length(trim("clinic_config"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "clinic_config_timezone_check" CHECK("clinic_config"."timezone" = 'Asia/Bangkok'),
	CONSTRAINT "clinic_config_synthetic_only_check" CHECK("clinic_config"."synthetic_only" = 1)
);
--> statement-breakpoint
CREATE TABLE `clinic_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL,
	CONSTRAINT "clinic_counters_value_check" CHECK("clinic_counters"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE `idempotency_records` (
	`clinic_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`actor_id`, `key`),
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "idempotency_records_status_check" CHECK("idempotency_records"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "idempotency_records_response_json_check" CHECK(json_valid("idempotency_records"."response_json"))
);
--> statement-breakpoint
CREATE TABLE `platform_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`staff_id` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `staff_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`username` text collate nocase NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer NOT NULL,
	`pilot_acknowledged_at` text,
	`active` integer NOT NULL,
	`revision` integer NOT NULL,
	`last_password_changed_at` text NOT NULL,
	`disabled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_accounts_role_check" CHECK("staff_accounts"."role" IN ('assistant', 'doctor')),
	CONSTRAINT "staff_accounts_must_change_password_check" CHECK("staff_accounts"."must_change_password" IN (0, 1)),
	CONSTRAINT "staff_accounts_active_check" CHECK("staff_accounts"."active" IN (0, 1)),
	CONSTRAINT "staff_accounts_revision_check" CHECK("staff_accounts"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_accounts_clinic_username_unique` ON `staff_accounts` (`clinic_id`,`username`);
--> statement-breakpoint
CREATE TRIGGER `audit_events_block_update`
BEFORE UPDATE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_block_delete`
BEFORE DELETE ON `audit_events`
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;
--> statement-breakpoint
PRAGMA application_id = 1128680535;
--> statement-breakpoint
INSERT OR IGNORE INTO `platform_metadata` (`key`, `value`)
VALUES ('product_id', 'careflow-pilot');
--> statement-breakpoint
WITH `migration_timestamp` (`value`) AS (
	SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
INSERT OR IGNORE INTO `clinic_config` (
	`id`, `name`, `timezone`, `synthetic_only`, `created_at`, `updated_at`
)
SELECT
	'clinic',
	'คลินิกชนบท CareFlow Pilot',
	'Asia/Bangkok',
	1,
	`value`,
	`value`
FROM `migration_timestamp`;
