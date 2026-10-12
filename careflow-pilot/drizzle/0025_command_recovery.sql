ALTER TABLE `idempotency_records` ADD COLUMN `operation` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
CREATE TABLE `command_cancellations` (
  `actor_id` text NOT NULL REFERENCES staff_accounts(id),
  `key` text NOT NULL CONSTRAINT `command_cancellations_key_check` CHECK(length(key) BETWEEN 8 AND 128),
  `operation` text NOT NULL,
  `generation` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`actor_id`, `key`)
);
--> statement-breakpoint
CREATE TRIGGER `command_cancellations_block_update` BEFORE UPDATE ON `command_cancellations`
BEGIN SELECT RAISE(ABORT, 'command cancellations are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER `command_cancellations_block_delete` BEFORE DELETE ON `command_cancellations`
BEGIN SELECT RAISE(ABORT, 'command cancellations are permanent'); END;
--> statement-breakpoint
INSERT INTO platform_metadata (key, value) VALUES ('recovery_generation', lower(hex(randomblob(16)))), ('recovery_mode', 'normal');

--> statement-breakpoint
CREATE TRIGGER `command_cancellations_protected_insert_conflict_guard` BEFORE INSERT ON `command_cancellations`
WHEN EXISTS (SELECT 1 FROM `command_cancellations` existing WHERE existing.`actor_id` = NEW.`actor_id` AND existing.`key` = NEW.`key`)
BEGIN SELECT RAISE(ABORT, 'command_cancellations insert conflicts with protected evidence'); END;
