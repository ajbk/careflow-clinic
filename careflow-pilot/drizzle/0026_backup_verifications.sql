CREATE TABLE `backup_verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `receipt_json` text NOT NULL CONSTRAINT `backup_verifications_receipt_json_check` CHECK(json_valid(receipt_json)),
  `verified_at` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `backup_verifications_block_update` BEFORE UPDATE ON `backup_verifications`
BEGIN SELECT RAISE(ABORT, 'backup verifications are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `backup_verifications_block_delete` BEFORE DELETE ON `backup_verifications`
BEGIN SELECT RAISE(ABORT, 'backup verifications are append-only'); END;

--> statement-breakpoint
CREATE TRIGGER `backup_verifications_protected_insert_conflict_guard` BEFORE INSERT ON `backup_verifications`
WHEN EXISTS (SELECT 1 FROM `backup_verifications` existing WHERE existing.`id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'backup_verifications insert conflicts with protected evidence'); END;
