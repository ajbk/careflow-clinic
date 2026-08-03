CREATE TABLE `patient_allergy_items` (
	`id` text PRIMARY KEY NOT NULL,
	`allergy_revision_id` text NOT NULL,
	`position` integer NOT NULL,
	`substance` text NOT NULL,
	`reaction` text NOT NULL,
	`severity` text NOT NULL,
	`note` text,
	FOREIGN KEY (`allergy_revision_id`) REFERENCES `patient_allergy_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_allergy_items_position_check" CHECK("patient_allergy_items"."position" >= 0),
	CONSTRAINT "patient_allergy_items_substance_check" CHECK(length("patient_allergy_items"."substance") BETWEEN 1 AND 200),
	CONSTRAINT "patient_allergy_items_reaction_check" CHECK(length("patient_allergy_items"."reaction") BETWEEN 1 AND 300),
	CONSTRAINT "patient_allergy_items_severity_check" CHECK("patient_allergy_items"."severity" IN ('UNKNOWN', 'MILD', 'MODERATE', 'SEVERE')),
	CONSTRAINT "patient_allergy_items_note_check" CHECK("patient_allergy_items"."note" IS NULL OR length("patient_allergy_items"."note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_allergy_items_revision_position_unique` ON `patient_allergy_items` (`allergy_revision_id`,`position`);--> statement-breakpoint
CREATE TABLE `patient_allergy_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`source_text` text NOT NULL,
	`reason` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_allergy_revisions_revision_check" CHECK("patient_allergy_revisions"."revision" >= 1),
	CONSTRAINT "patient_allergy_revisions_state_check" CHECK("patient_allergy_revisions"."state" IN ('UNKNOWN', 'NONE_KNOWN', 'PRESENT')),
	CONSTRAINT "patient_allergy_revisions_source_text_check" CHECK(length("patient_allergy_revisions"."source_text") BETWEEN 1 AND 500),
	CONSTRAINT "patient_allergy_revisions_reason_check" CHECK(length("patient_allergy_revisions"."reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_allergy_revisions_patient_revision_unique` ON `patient_allergy_revisions` (`patient_id`,`revision`);--> statement-breakpoint
CREATE TABLE `clinical_note_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`clinical_note_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`reason` text NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`clinical_note_id`) REFERENCES `clinical_notes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_note_amendments_version_check" CHECK("clinical_note_amendments"."version" >= 1),
	CONSTRAINT "clinical_note_amendments_content_check" CHECK(length("clinical_note_amendments"."content") BETWEEN 1 AND 4000),
	CONSTRAINT "clinical_note_amendments_reason_check" CHECK(length("clinical_note_amendments"."reason") BETWEEN 1 AND 500),
	CONSTRAINT "clinical_note_amendments_content_hash_check" CHECK(length("clinical_note_amendments"."content_hash") = 64 AND "clinical_note_amendments"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_note_amendments_note_version_unique` ON `clinical_note_amendments` (`clinical_note_id`,`version`);--> statement-breakpoint
CREATE TABLE `clinical_note_diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`clinical_note_id` text NOT NULL,
	`position` integer NOT NULL,
	`diagnosis_text` text NOT NULL,
	FOREIGN KEY (`clinical_note_id`) REFERENCES `clinical_notes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_note_diagnoses_position_check" CHECK("clinical_note_diagnoses"."position" >= 0),
	CONSTRAINT "clinical_note_diagnoses_text_check" CHECK(length("clinical_note_diagnoses"."diagnosis_text") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_note_diagnoses_note_position_unique` ON `clinical_note_diagnoses` (`clinical_note_id`,`position`);--> statement-breakpoint
CREATE TABLE `clinical_note_draft_diagnoses` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`diagnosis_text` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `clinical_note_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "clinical_note_draft_diagnoses_position_check" CHECK("clinical_note_draft_diagnoses"."position" >= 0),
	CONSTRAINT "clinical_note_draft_diagnoses_text_check" CHECK(length("clinical_note_draft_diagnoses"."diagnosis_text") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_note_draft_diagnoses_draft_position_unique` ON `clinical_note_draft_diagnoses` (`draft_id`,`position`);--> statement-breakpoint
CREATE TABLE `clinical_note_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`subjective` text DEFAULT '' NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`assessment` text DEFAULT '' NOT NULL,
	`plan` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_note_drafts_revision_check" CHECK("clinical_note_drafts"."revision" >= 1),
	CONSTRAINT "clinical_note_drafts_subjective_check" CHECK(length("clinical_note_drafts"."subjective") BETWEEN 0 AND 4000),
	CONSTRAINT "clinical_note_drafts_objective_check" CHECK(length("clinical_note_drafts"."objective") BETWEEN 0 AND 4000),
	CONSTRAINT "clinical_note_drafts_assessment_check" CHECK(length("clinical_note_drafts"."assessment") BETWEEN 0 AND 4000),
	CONSTRAINT "clinical_note_drafts_plan_check" CHECK(length("clinical_note_drafts"."plan") BETWEEN 0 AND 4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_note_drafts_visit_id_unique` ON `clinical_note_drafts` (`visit_id`);--> statement-breakpoint
CREATE TABLE `clinical_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`version` integer NOT NULL,
	`subjective` text NOT NULL,
	`objective` text NOT NULL,
	`assessment` text NOT NULL,
	`plan` text NOT NULL,
	`source_draft_revision` integer NOT NULL,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_notes_version_check" CHECK("clinical_notes"."version" >= 1),
	CONSTRAINT "clinical_notes_subjective_check" CHECK(length("clinical_notes"."subjective") BETWEEN 1 AND 4000),
	CONSTRAINT "clinical_notes_objective_check" CHECK(length("clinical_notes"."objective") BETWEEN 1 AND 4000),
	CONSTRAINT "clinical_notes_assessment_check" CHECK(length("clinical_notes"."assessment") BETWEEN 1 AND 4000),
	CONSTRAINT "clinical_notes_plan_check" CHECK(length("clinical_notes"."plan") BETWEEN 1 AND 4000),
	CONSTRAINT "clinical_notes_source_draft_revision_check" CHECK("clinical_notes"."source_draft_revision" >= 1),
	CONSTRAINT "clinical_notes_content_hash_check" CHECK(length("clinical_notes"."content_hash") = 64 AND "clinical_notes"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_notes_visit_version_unique` ON `clinical_notes` (`visit_id`,`version`);--> statement-breakpoint
CREATE TABLE `medication_decision_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'UNDECIDED' NOT NULL,
	`no_medication_reason` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medication_decision_drafts_revision_check" CHECK("medication_decision_drafts"."revision" >= 1),
	CONSTRAINT "medication_decision_drafts_kind_check" CHECK("medication_decision_drafts"."kind" IN ('UNDECIDED', 'ORDER', 'NO_MEDICATION')),
	CONSTRAINT "medication_decision_drafts_no_medication_reason_check" CHECK("medication_decision_drafts"."no_medication_reason" IS NULL OR length("medication_decision_drafts"."no_medication_reason") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_decision_drafts_visit_id_unique` ON `medication_decision_drafts` (`visit_id`);--> statement-breakpoint
CREATE TABLE `medication_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`visit_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`no_medication_reason` text,
	`revision_reason` text,
	`supersedes_id` text,
	`signed_by` text NOT NULL,
	`signed_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medication_decisions_version_check" CHECK("medication_decisions"."version" >= 1),
	CONSTRAINT "medication_decisions_kind_check" CHECK("medication_decisions"."kind" IN ('ORDER', 'NO_MEDICATION')),
	CONSTRAINT "medication_decisions_no_medication_reason_check" CHECK("medication_decisions"."no_medication_reason" IS NULL OR length("medication_decisions"."no_medication_reason") BETWEEN 1 AND 500),
	CONSTRAINT "medication_decisions_revision_reason_check" CHECK("medication_decisions"."revision_reason" IS NULL OR length("medication_decisions"."revision_reason") BETWEEN 1 AND 500),
	CONSTRAINT "medication_decisions_content_hash_check" CHECK(length("medication_decisions"."content_hash") = 64 AND "medication_decisions"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_decisions_visit_version_unique` ON `medication_decisions` (`visit_id`,`version`);--> statement-breakpoint
CREATE TABLE `medication_order_draft_items` (
	`id` text PRIMARY KEY NOT NULL,
	`decision_draft_id` text NOT NULL,
	`position` integer NOT NULL,
	`medication_id` text NOT NULL,
	`medication_revision` integer NOT NULL,
	`quantity` integer NOT NULL,
	`directions_th` text NOT NULL,
	FOREIGN KEY (`decision_draft_id`) REFERENCES `medication_decision_drafts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medication_order_draft_items_position_check" CHECK("medication_order_draft_items"."position" >= 0),
	CONSTRAINT "medication_order_draft_items_medication_revision_check" CHECK("medication_order_draft_items"."medication_revision" >= 1),
	CONSTRAINT "medication_order_draft_items_quantity_check" CHECK("medication_order_draft_items"."quantity" BETWEEN 1 AND 9999),
	CONSTRAINT "medication_order_draft_items_directions_th_check" CHECK(length("medication_order_draft_items"."directions_th") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_order_draft_items_draft_position_unique` ON `medication_order_draft_items` (`decision_draft_id`,`position`);--> statement-breakpoint
CREATE TABLE `medication_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_decision_id` text NOT NULL,
	`position` integer NOT NULL,
	`medication_id` text NOT NULL,
	`medication_revision` integer NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`strength_snapshot` text NOT NULL,
	`dosage_form_snapshot` text NOT NULL,
	`unit_snapshot` text NOT NULL,
	`quantity` integer NOT NULL,
	`directions_th` text NOT NULL,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "medication_order_items_position_check" CHECK("medication_order_items"."position" >= 0),
	CONSTRAINT "medication_order_items_medication_revision_check" CHECK("medication_order_items"."medication_revision" >= 1),
	CONSTRAINT "medication_order_items_display_name_snapshot_check" CHECK(length("medication_order_items"."display_name_snapshot") BETWEEN 1 AND 200),
	CONSTRAINT "medication_order_items_strength_snapshot_check" CHECK(length("medication_order_items"."strength_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "medication_order_items_dosage_form_snapshot_check" CHECK(length("medication_order_items"."dosage_form_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "medication_order_items_unit_snapshot_check" CHECK(length("medication_order_items"."unit_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "medication_order_items_quantity_check" CHECK("medication_order_items"."quantity" BETWEEN 1 AND 9999),
	CONSTRAINT "medication_order_items_directions_th_check" CHECK(length("medication_order_items"."directions_th") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_order_items_decision_position_unique` ON `medication_order_items` (`medication_decision_id`,`position`);--> statement-breakpoint
CREATE TABLE `medications` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`strength_text` text NOT NULL,
	`dosage_form_text` text NOT NULL,
	`canonical_unit` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "medications_id_check" CHECK(length("medications"."id") = 12 AND "medications"."id" GLOB 'DEMO-MED-[0-9][0-9][0-9]'),
	CONSTRAINT "medications_display_name_check" CHECK(length("medications"."display_name") BETWEEN 1 AND 200),
	CONSTRAINT "medications_strength_text_check" CHECK(length("medications"."strength_text") BETWEEN 1 AND 100),
	CONSTRAINT "medications_dosage_form_text_check" CHECK(length("medications"."dosage_form_text") BETWEEN 1 AND 100),
	CONSTRAINT "medications_canonical_unit_check" CHECK(length("medications"."canonical_unit") BETWEEN 1 AND 100),
	CONSTRAINT "medications_active_check" CHECK("medications"."active" IN (0, 1)),
	CONSTRAINT "medications_revision_check" CHECK("medications"."revision" >= 1)
);
--> statement-breakpoint
INSERT INTO `medications` (
	`id`, `display_name`, `strength_text`, `dosage_form_text`, `canonical_unit`,
	`active`, `revision`, `created_at`, `updated_at`
) VALUES
	('DEMO-MED-001', '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
	('DEMO-MED-002', '[DEMO] ยาทดสอบชนิด B', '10 หน่วยทดสอบ', 'แคปซูลทดสอบ', 'แคปซูล', 1, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
	('DEMO-MED-003', '[DEMO] ยาทดสอบชนิด C', '5 หน่วยทดสอบ/มล.', 'ยาน้ำทดสอบ', 'ขวด', 1, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z'),
	('DEMO-MED-004', '[DEMO] ยาทดสอบชนิด D', '1 หน่วยทดสอบ', 'ซองทดสอบ', 'ซอง', 1, 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
--> statement-breakpoint
CREATE TRIGGER `clinical_notes_block_update`
BEFORE UPDATE ON `clinical_notes`
BEGIN
	SELECT RAISE(ABORT, 'clinical_notes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_notes_block_delete`
BEFORE DELETE ON `clinical_notes`
BEGIN
	SELECT RAISE(ABORT, 'clinical_notes are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_diagnoses_block_update`
BEFORE UPDATE ON `clinical_note_diagnoses`
BEGIN
	SELECT RAISE(ABORT, 'clinical_note_diagnoses are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_diagnoses_block_delete`
BEFORE DELETE ON `clinical_note_diagnoses`
BEGIN
	SELECT RAISE(ABORT, 'clinical_note_diagnoses are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_amendments_block_update`
BEFORE UPDATE ON `clinical_note_amendments`
BEGIN
	SELECT RAISE(ABORT, 'clinical_note_amendments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_amendments_block_delete`
BEFORE DELETE ON `clinical_note_amendments`
BEGIN
	SELECT RAISE(ABORT, 'clinical_note_amendments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_decisions_block_update`
BEFORE UPDATE ON `medication_decisions`
BEGIN
	SELECT RAISE(ABORT, 'medication_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_decisions_block_delete`
BEFORE DELETE ON `medication_decisions`
BEGIN
	SELECT RAISE(ABORT, 'medication_decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_items_block_update`
BEFORE UPDATE ON `medication_order_items`
BEGIN
	SELECT RAISE(ABORT, 'medication_order_items are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_items_block_delete`
BEFORE DELETE ON `medication_order_items`
BEGIN
	SELECT RAISE(ABORT, 'medication_order_items are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_revisions_block_update`
BEFORE UPDATE ON `patient_allergy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'patient_allergy_revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_revisions_block_delete`
BEFORE DELETE ON `patient_allergy_revisions`
BEGIN
	SELECT RAISE(ABORT, 'patient_allergy_revisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_items_block_update`
BEFORE UPDATE ON `patient_allergy_items`
BEGIN
	SELECT RAISE(ABORT, 'patient_allergy_items are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_items_block_delete`
BEFORE DELETE ON `patient_allergy_items`
BEGIN
	SELECT RAISE(ABORT, 'patient_allergy_items are append-only');
END;
