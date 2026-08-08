ALTER TABLE `medications` ADD `internal_barcode` text;--> statement-breakpoint
ALTER TABLE `inventory_reservations` ADD `consumed_at` text;--> statement-breakpoint
ALTER TABLE `inventory_reservations` ADD `consumed_by` text REFERENCES staff_accounts(id);--> statement-breakpoint
ALTER TABLE `inventory_reservations` ADD `consumed_dispense_id` text;--> statement-breakpoint
UPDATE `medications`
SET `internal_barcode` = 'CF-DEMO-' || substr(`id`, 10, 3)
WHERE `active` = 1 AND `internal_barcode` IS NULL AND `id` GLOB 'DEMO-MED-[0-9][0-9][0-9]';--> statement-breakpoint
UPDATE `medications`
SET `internal_barcode` = upper(trim(`internal_barcode`))
WHERE `active` = 1 AND `internal_barcode` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `medications_active_internal_barcode_unique`
ON `medications` (`internal_barcode`) WHERE `active` = 1;--> statement-breakpoint
CREATE TRIGGER `medications_active_barcode_insert_guard`
BEFORE INSERT ON `medications`
WHEN NEW.active = 1 AND (
  NEW.internal_barcode IS NULL
  OR NEW.internal_barcode <> upper(trim(NEW.internal_barcode))
  OR length(NEW.internal_barcode) NOT BETWEEN 1 AND 64
  OR NEW.internal_barcode GLOB '*[^!-~]*'
)
BEGIN
  SELECT RAISE(ABORT, 'active medications require a normalized internal barcode');
END;--> statement-breakpoint
CREATE TRIGGER `medications_active_barcode_update_guard`
BEFORE UPDATE ON `medications`
WHEN NEW.active = 1 AND (
  NEW.internal_barcode IS NULL
  OR NEW.internal_barcode <> upper(trim(NEW.internal_barcode))
  OR length(NEW.internal_barcode) NOT BETWEEN 1 AND 64
  OR NEW.internal_barcode GLOB '*[^!-~]*'
)
BEGIN
  SELECT RAISE(ABORT, 'active medications require a normalized internal barcode');
END;--> statement-breakpoint
CREATE TABLE `fulfillment_artifact_invalidations` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`artifact_type` text NOT NULL,
	`artifact_id` text NOT NULL,
	`trigger` text NOT NULL,
	`reason` text NOT NULL,
	`invalidated_at` text NOT NULL,
	`invalidated_by` text NOT NULL,
	`replacement_decision_id` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invalidated_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`replacement_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_artifact_invalidations_type_check" CHECK("fulfillment_artifact_invalidations"."artifact_type" IN ('LABEL', 'PREPARATION', 'RELEASE')),
	CONSTRAINT "fulfillment_artifact_invalidations_trigger_check" CHECK("fulfillment_artifact_invalidations"."trigger" IN ('ABANDON', 'REJECT', 'ALLERGY_REVISION', 'ORDER_REVISION')),
	CONSTRAINT "fulfillment_artifact_invalidations_reason_check" CHECK(length(trim("fulfillment_artifact_invalidations"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "fulfillment_artifact_invalidations_replacement_check" CHECK(("fulfillment_artifact_invalidations"."trigger" = 'ORDER_REVISION' AND "fulfillment_artifact_invalidations"."replacement_decision_id" IS NOT NULL) OR ("fulfillment_artifact_invalidations"."trigger" <> 'ORDER_REVISION' AND "fulfillment_artifact_invalidations"."replacement_decision_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_artifact_invalidations_artifact_unique` ON `fulfillment_artifact_invalidations` (`artifact_type`,`artifact_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_dispense_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`dispense_id` text NOT NULL,
	`reservation_allocation_id` text NOT NULL,
	`medication_order_item_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`strength_snapshot` text NOT NULL,
	`dosage_form_snapshot` text NOT NULL,
	`unit_snapshot` text NOT NULL,
	`lot_number_snapshot` text NOT NULL,
	`expiry_date_snapshot` text NOT NULL,
	`directions_th_snapshot` text NOT NULL,
	FOREIGN KEY (`dispense_id`) REFERENCES `fulfillment_dispenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_allocation_id`) REFERENCES `inventory_reservation_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_dispense_lines_quantity_check" CHECK("fulfillment_dispense_lines"."quantity" BETWEEN 1 AND 999999),
	CONSTRAINT "fulfillment_dispense_lines_display_name_snapshot_check" CHECK(length("fulfillment_dispense_lines"."display_name_snapshot") BETWEEN 1 AND 200),
	CONSTRAINT "fulfillment_dispense_lines_strength_snapshot_check" CHECK(length("fulfillment_dispense_lines"."strength_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_dispense_lines_dosage_form_snapshot_check" CHECK(length("fulfillment_dispense_lines"."dosage_form_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_dispense_lines_unit_snapshot_check" CHECK(length("fulfillment_dispense_lines"."unit_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_dispense_lines_lot_number_snapshot_check" CHECK(length(trim("fulfillment_dispense_lines"."lot_number_snapshot")) BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_dispense_lines_expiry_date_snapshot_check" CHECK("fulfillment_dispense_lines"."expiry_date_snapshot" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fulfillment_dispense_lines_directions_snapshot_check" CHECK(length("fulfillment_dispense_lines"."directions_th_snapshot") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_dispense_lines_reservation_allocation_id_unique` ON `fulfillment_dispense_lines` (`reservation_allocation_id`);--> statement-breakpoint
CREATE INDEX `fulfillment_dispense_lines_dispense_index` ON `fulfillment_dispense_lines` (`dispense_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_dispenses` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`label_version_id` text NOT NULL,
	`preparation_id` text NOT NULL,
	`release_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`handed_off_at` text NOT NULL,
	`handed_off_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparation_id`) REFERENCES `fulfillment_preparations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `fulfillment_releases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handed_off_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_dispenses_decision_version_check" CHECK("fulfillment_dispenses"."medication_decision_version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_dispenses_visit_id_unique` ON `fulfillment_dispenses` (`visit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_dispenses_release_id_unique` ON `fulfillment_dispenses` (`release_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_dispenses_reservation_id_unique` ON `fulfillment_dispenses` (`reservation_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_label_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label_version_id` text NOT NULL,
	`medication_order_item_id` text NOT NULL,
	`position` integer NOT NULL,
	`medication_id` text NOT NULL,
	`medication_revision` integer NOT NULL,
	`display_name_snapshot` text NOT NULL,
	`strength_snapshot` text NOT NULL,
	`dosage_form_snapshot` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_snapshot` text NOT NULL,
	`directions_th_snapshot` text NOT NULL,
	`internal_barcode_snapshot` text NOT NULL,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_label_items_position_check" CHECK("fulfillment_label_items"."position" >= 0),
	CONSTRAINT "fulfillment_label_items_medication_revision_check" CHECK("fulfillment_label_items"."medication_revision" >= 1),
	CONSTRAINT "fulfillment_label_items_quantity_check" CHECK("fulfillment_label_items"."quantity" BETWEEN 1 AND 9999),
	CONSTRAINT "fulfillment_label_items_display_name_snapshot_check" CHECK(length("fulfillment_label_items"."display_name_snapshot") BETWEEN 1 AND 200),
	CONSTRAINT "fulfillment_label_items_strength_snapshot_check" CHECK(length("fulfillment_label_items"."strength_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_label_items_dosage_form_snapshot_check" CHECK(length("fulfillment_label_items"."dosage_form_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_label_items_unit_snapshot_check" CHECK(length("fulfillment_label_items"."unit_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_label_items_directions_snapshot_check" CHECK(length("fulfillment_label_items"."directions_th_snapshot") BETWEEN 1 AND 500),
	CONSTRAINT "fulfillment_label_items_barcode_snapshot_check" CHECK(length("fulfillment_label_items"."internal_barcode_snapshot") BETWEEN 1 AND 64 AND "fulfillment_label_items"."internal_barcode_snapshot" NOT GLOB '*[^!-~]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_label_items_label_position_unique` ON `fulfillment_label_items` (`label_version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_label_items_order_item_unique` ON `fulfillment_label_items` (`medication_order_item_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_label_print_events` (
	`id` text PRIMARY KEY NOT NULL,
	`label_version_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`requested_at` text NOT NULL,
	`requested_by` text NOT NULL,
	`renderer_version` text NOT NULL,
	`media_size_snapshot` text NOT NULL,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_label_print_events_sequence_check" CHECK("fulfillment_label_print_events"."sequence" >= 1),
	CONSTRAINT "fulfillment_label_print_events_renderer_version_check" CHECK(length("fulfillment_label_print_events"."renderer_version") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_label_print_events_media_size_check" CHECK("fulfillment_label_print_events"."media_size_snapshot" = '80x100mm')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_label_print_events_label_sequence_unique` ON `fulfillment_label_print_events` (`label_version_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `fulfillment_label_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`patient_hn_snapshot` text NOT NULL,
	`patient_display_name_snapshot` text NOT NULL,
	`clinic_name_snapshot` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_label_versions_decision_version_check" CHECK("fulfillment_label_versions"."medication_decision_version" >= 1),
	CONSTRAINT "fulfillment_label_versions_version_check" CHECK("fulfillment_label_versions"."version" >= 1),
	CONSTRAINT "fulfillment_label_versions_patient_hn_snapshot_check" CHECK(length("fulfillment_label_versions"."patient_hn_snapshot") BETWEEN 1 AND 100),
	CONSTRAINT "fulfillment_label_versions_patient_display_name_snapshot_check" CHECK(length("fulfillment_label_versions"."patient_display_name_snapshot") BETWEEN 1 AND 200),
	CONSTRAINT "fulfillment_label_versions_clinic_name_snapshot_check" CHECK(length("fulfillment_label_versions"."clinic_name_snapshot") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_label_versions_decision_unique` ON `fulfillment_label_versions` (`medication_decision_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_preparation_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`preparation_id` text NOT NULL,
	`reservation_allocation_id` text NOT NULL,
	`medication_order_item_id` text NOT NULL,
	`medication_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`method` text NOT NULL,
	`barcode_snapshot` text,
	`manual_reason` text,
	`confirmed_at` text NOT NULL,
	`confirmed_by` text NOT NULL,
	FOREIGN KEY (`preparation_id`) REFERENCES `fulfillment_preparations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_allocation_id`) REFERENCES `inventory_reservation_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_preparation_confirmations_quantity_check" CHECK("fulfillment_preparation_confirmations"."quantity" BETWEEN 1 AND 999999),
	CONSTRAINT "fulfillment_preparation_confirmations_method_check" CHECK("fulfillment_preparation_confirmations"."method" IN ('BARCODE', 'MANUAL')),
	CONSTRAINT "fulfillment_preparation_confirmations_evidence_check" CHECK(("fulfillment_preparation_confirmations"."method" = 'BARCODE' AND "fulfillment_preparation_confirmations"."barcode_snapshot" IS NOT NULL AND length("fulfillment_preparation_confirmations"."barcode_snapshot") BETWEEN 1 AND 64 AND "fulfillment_preparation_confirmations"."barcode_snapshot" NOT GLOB '*[^!-~]*' AND "fulfillment_preparation_confirmations"."manual_reason" IS NULL) OR ("fulfillment_preparation_confirmations"."method" = 'MANUAL' AND "fulfillment_preparation_confirmations"."barcode_snapshot" IS NULL AND "fulfillment_preparation_confirmations"."manual_reason" IS NOT NULL AND length(trim("fulfillment_preparation_confirmations"."manual_reason")) BETWEEN 1 AND 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_preparation_confirmations_preparation_allocation_unique` ON `fulfillment_preparation_confirmations` (`preparation_id`,`reservation_allocation_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_preparations` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`label_version_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`minimum_print_sequence` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	`completed_at` text,
	`completed_by` text,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_preparations_decision_version_check" CHECK("fulfillment_preparations"."medication_decision_version" >= 1),
	CONSTRAINT "fulfillment_preparations_revision_check" CHECK("fulfillment_preparations"."revision" >= 1),
	CONSTRAINT "fulfillment_preparations_minimum_print_sequence_check" CHECK("fulfillment_preparations"."minimum_print_sequence" >= 1),
	CONSTRAINT "fulfillment_preparations_status_check" CHECK("fulfillment_preparations"."status" IN ('ACTIVE', 'COMPLETED')),
	CONSTRAINT "fulfillment_preparations_completion_fields_check" CHECK(("fulfillment_preparations"."status" = 'ACTIVE' AND "fulfillment_preparations"."completed_at" IS NULL AND "fulfillment_preparations"."completed_by" IS NULL) OR ("fulfillment_preparations"."status" = 'COMPLETED' AND "fulfillment_preparations"."completed_at" IS NOT NULL AND "fulfillment_preparations"."completed_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_preparations_reservation_id_unique` ON `fulfillment_preparations` (`reservation_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`preparation_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`label_version_id` text NOT NULL,
	`print_sequence_at_rejection` integer NOT NULL,
	`reason` text NOT NULL,
	`rejected_at` text NOT NULL,
	`rejected_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparation_id`) REFERENCES `fulfillment_preparations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rejected_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_rejections_print_sequence_check" CHECK("fulfillment_rejections"."print_sequence_at_rejection" >= 1),
	CONSTRAINT "fulfillment_rejections_reason_check" CHECK(length(trim("fulfillment_rejections"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_rejections_preparation_id_unique` ON `fulfillment_rejections` (`preparation_id`);--> statement-breakpoint
CREATE TABLE `fulfillment_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`label_version_id` text NOT NULL,
	`label_print_event_id` text NOT NULL,
	`preparation_id` text NOT NULL,
	`preparation_revision` integer NOT NULL,
	`reservation_id` text NOT NULL,
	`released_at` text NOT NULL,
	`released_by` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_version_id`) REFERENCES `fulfillment_label_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`label_print_event_id`) REFERENCES `fulfillment_label_print_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparation_id`) REFERENCES `fulfillment_preparations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reservation_id`) REFERENCES `inventory_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`released_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fulfillment_releases_decision_version_check" CHECK("fulfillment_releases"."medication_decision_version" >= 1),
	CONSTRAINT "fulfillment_releases_preparation_revision_check" CHECK("fulfillment_releases"."preparation_revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_releases_reservation_id_unique` ON `fulfillment_releases` (`reservation_id`);--> statement-breakpoint
INSERT INTO `fulfillment_label_versions` (
  `id`, `clinic_id`, `visit_id`, `medication_decision_id`, `medication_decision_version`, `version`,
  `created_at`, `created_by`, `patient_hn_snapshot`, `patient_display_name_snapshot`, `clinic_name_snapshot`
)
SELECT
  'migration-label-' || decision.id, visit.clinic_id, decision.visit_id, decision.id, decision.version, decision.version,
  decision.signed_at, decision.signed_by, patient.hn, patient.display_name, clinic.name
FROM `medication_decisions` AS decision
INNER JOIN `visits` AS visit ON visit.id = decision.visit_id
INNER JOIN `patients` AS patient ON patient.id = visit.patient_id
INNER JOIN `clinic_config` AS clinic ON clinic.id = visit.clinic_id
WHERE decision.kind = 'ORDER'
  AND decision.version = (
    SELECT MAX(current_decision.version)
    FROM `medication_decisions` AS current_decision
    WHERE current_decision.visit_id = decision.visit_id
  );--> statement-breakpoint
INSERT INTO `fulfillment_label_items` (
  `id`, `label_version_id`, `medication_order_item_id`, `position`, `medication_id`, `medication_revision`,
  `display_name_snapshot`, `strength_snapshot`, `dosage_form_snapshot`, `quantity`, `unit_snapshot`,
  `directions_th_snapshot`, `internal_barcode_snapshot`
)
SELECT
  'migration-label-item-' || item.id, 'migration-label-' || item.medication_decision_id, item.id, item.position,
  item.medication_id, item.medication_revision, item.display_name_snapshot, item.strength_snapshot,
  item.dosage_form_snapshot, item.quantity, item.unit_snapshot, item.directions_th, medication.internal_barcode
FROM `medication_order_items` AS item
INNER JOIN `fulfillment_label_versions` AS label ON label.medication_decision_id = item.medication_decision_id
INNER JOIN `medications` AS medication ON medication.id = item.medication_id;--> statement-breakpoint
INSERT INTO `fulfillment_preparations` (
  `id`, `clinic_id`, `visit_id`, `reservation_id`, `medication_decision_id`, `medication_decision_version`,
  `label_version_id`, `revision`, `status`, `minimum_print_sequence`, `created_at`, `created_by`
)
SELECT
  'migration-preparation-' || reservation.id, reservation.clinic_id, reservation.visit_id, reservation.id,
  reservation.medication_decision_id, reservation.medication_decision_version,
  label.id, 1, 'ACTIVE', 1, reservation.created_at, reservation.created_by
FROM `inventory_reservations` AS reservation
INNER JOIN `fulfillment_label_versions` AS label ON label.medication_decision_id = reservation.medication_decision_id
WHERE reservation.status = 'ACTIVE';--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_transition_guard`
BEFORE UPDATE ON `inventory_reservations`
WHEN NOT (OLD.status = 'ACTIVE' AND NEW.status IN ('RELEASED', 'CONSUMED'))
BEGIN
  SELECT RAISE(ABORT, 'inventory reservations have terminal status transitions');
END;--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_consumption_guard`
BEFORE UPDATE ON `inventory_reservations`
WHEN NEW.status = 'CONSUMED' AND (
  NEW.consumed_at IS NULL OR NEW.consumed_by IS NULL OR NEW.consumed_dispense_id IS NULL
  OR NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL OR NEW.release_reason IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'consumed reservation requires dispense evidence');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_artifact_invalidations_reference_guard`
BEFORE INSERT ON `fulfillment_artifact_invalidations`
WHEN (NEW.artifact_type = 'LABEL' AND NOT EXISTS (
  SELECT 1 FROM `fulfillment_label_versions` WHERE id = NEW.artifact_id AND clinic_id = NEW.clinic_id AND visit_id = NEW.visit_id
)) OR (NEW.artifact_type = 'PREPARATION' AND NOT EXISTS (
  SELECT 1 FROM `fulfillment_preparations` WHERE id = NEW.artifact_id AND clinic_id = NEW.clinic_id AND visit_id = NEW.visit_id
)) OR (NEW.artifact_type = 'RELEASE' AND NOT EXISTS (
  SELECT 1 FROM `fulfillment_releases` WHERE id = NEW.artifact_id AND clinic_id = NEW.clinic_id AND visit_id = NEW.visit_id
))
BEGIN
  SELECT RAISE(ABORT, 'artifact invalidation must reference its clinic visit artifact');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_items_block_update`
BEFORE UPDATE ON `fulfillment_label_items`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_items are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_items_block_delete`
BEFORE DELETE ON `fulfillment_label_items`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_items are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_print_events_block_update`
BEFORE UPDATE ON `fulfillment_label_print_events`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_print_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_print_events_block_delete`
BEFORE DELETE ON `fulfillment_label_print_events`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_print_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparation_confirmations_block_update`
BEFORE UPDATE ON `fulfillment_preparation_confirmations`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparation_confirmations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparation_confirmations_block_delete`
BEFORE DELETE ON `fulfillment_preparation_confirmations`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparation_confirmations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_artifact_invalidations_block_update`
BEFORE UPDATE ON `fulfillment_artifact_invalidations`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_artifact_invalidations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_artifact_invalidations_block_delete`
BEFORE DELETE ON `fulfillment_artifact_invalidations`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_artifact_invalidations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_releases_block_update`
BEFORE UPDATE ON `fulfillment_releases`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_releases are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_releases_block_delete`
BEFORE DELETE ON `fulfillment_releases`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_releases are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_rejections_block_update`
BEFORE UPDATE ON `fulfillment_rejections`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_rejections are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_rejections_block_delete`
BEFORE DELETE ON `fulfillment_rejections`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_rejections are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispenses_block_update`
BEFORE UPDATE ON `fulfillment_dispenses`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispenses are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispenses_block_delete`
BEFORE DELETE ON `fulfillment_dispenses`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispenses are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_lines_block_update`
BEFORE UPDATE ON `fulfillment_dispense_lines`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_lines are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_lines_block_delete`
BEFORE DELETE ON `fulfillment_dispense_lines`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_lines are append-only');
END;
