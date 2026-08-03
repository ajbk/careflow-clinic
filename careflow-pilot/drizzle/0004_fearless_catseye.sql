ALTER TABLE `clinical_notes` ADD `signed_by_display_name` text DEFAULT 'legacy signer snapshot unavailable' NOT NULL;--> statement-breakpoint
ALTER TABLE `medication_decisions` ADD `signed_by_display_name` text DEFAULT 'legacy signer snapshot unavailable' NOT NULL;--> statement-breakpoint
DROP TRIGGER `clinical_notes_block_update`;--> statement-breakpoint
DROP TRIGGER `clinical_notes_block_delete`;--> statement-breakpoint
DROP TRIGGER `medication_decisions_block_update`;--> statement-breakpoint
DROP TRIGGER `medication_decisions_block_delete`;--> statement-breakpoint
UPDATE `clinical_notes`
SET `signed_by_display_name` = (
  SELECT `display_name` FROM `staff_accounts` WHERE `staff_accounts`.`id` = `clinical_notes`.`signed_by`
);--> statement-breakpoint
UPDATE `medication_decisions`
SET `signed_by_display_name` = (
  SELECT `display_name` FROM `staff_accounts` WHERE `staff_accounts`.`id` = `medication_decisions`.`signed_by`
);--> statement-breakpoint
CREATE TRIGGER `clinical_notes_block_update`
BEFORE UPDATE ON `clinical_notes`
BEGIN
	SELECT RAISE(ABORT, 'clinical_notes are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_notes_block_delete`
BEFORE DELETE ON `clinical_notes`
BEGIN
	SELECT RAISE(ABORT, 'clinical_notes are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decisions_block_update`
BEFORE UPDATE ON `medication_decisions`
BEGIN
	SELECT RAISE(ABORT, 'medication_decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decisions_block_delete`
BEFORE DELETE ON `medication_decisions`
BEGIN
	SELECT RAISE(ABORT, 'medication_decisions are append-only');
END;
