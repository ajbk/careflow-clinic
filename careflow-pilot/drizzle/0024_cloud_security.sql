CREATE TABLE `auth_rate_limits` (
  `bucket` text PRIMARY KEY NOT NULL CONSTRAINT `auth_rate_limits_bucket_check` CHECK(length(bucket) = 64),
  `attempts` integer NOT NULL CONSTRAINT `auth_rate_limits_attempts_check` CHECK(attempts >= 1),
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_rate_limits_expiry` ON `auth_rate_limits` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `security_events` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text REFERENCES staff_accounts(id),
  `action` text NOT NULL CONSTRAINT `security_events_action_check` CHECK(action IN ('login.succeeded','login.failed','logout','request.denied','record.read','password.changed')),
  `route` text NOT NULL,
  `status` integer NOT NULL CONSTRAINT `security_events_status_check` CHECK(status BETWEEN 100 AND 599),
  `occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `security_events_block_update` BEFORE UPDATE ON `security_events`
BEGIN SELECT RAISE(ABORT, 'security events are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `security_events_block_delete` BEFORE DELETE ON `security_events`
BEGIN SELECT RAISE(ABORT, 'security events are append-only'); END;

--> statement-breakpoint
CREATE TRIGGER `security_events_protected_insert_conflict_guard` BEFORE INSERT ON `security_events`
WHEN EXISTS (SELECT 1 FROM `security_events` existing WHERE existing.`id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'security_events insert conflicts with protected evidence'); END;
