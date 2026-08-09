CREATE TABLE `visit_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`visit_revision` integer NOT NULL,
	`charge_id` text NOT NULL,
	`payment_id` text,
	`waiver_adjustment_id` text,
	`clinic_name_snapshot` text NOT NULL,
	`patient_id_snapshot` text NOT NULL,
	`patient_hn_snapshot` text NOT NULL,
	`patient_display_name_snapshot` text NOT NULL,
	`patient_birth_date_snapshot` text NOT NULL,
	`patient_sex_snapshot` text NOT NULL,
	`doctor_id_snapshot` text NOT NULL,
	`doctor_display_name_snapshot` text NOT NULL,
	`closed_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`charge_id`) REFERENCES `finance_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `finance_payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waiver_adjustment_id`) REFERENCES `finance_charge_adjustments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doctor_id_snapshot`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "visit_closures_visit_revision_check" CHECK("visit_closures"."visit_revision" >= 1),
	CONSTRAINT "visit_closures_resolution_shape_check" CHECK(("visit_closures"."payment_id" IS NOT NULL AND "visit_closures"."waiver_adjustment_id" IS NULL) OR ("visit_closures"."payment_id" IS NULL AND "visit_closures"."waiver_adjustment_id" IS NOT NULL)),
	CONSTRAINT "visit_closures_clinic_name_snapshot_check" CHECK(length(trim("visit_closures"."clinic_name_snapshot")) BETWEEN 1 AND 120),
	CONSTRAINT "visit_closures_patient_id_snapshot_check" CHECK(length(trim("visit_closures"."patient_id_snapshot")) BETWEEN 1 AND 120),
	CONSTRAINT "visit_closures_patient_hn_snapshot_check" CHECK("visit_closures"."patient_hn_snapshot" GLOB 'DEMO-[0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "visit_closures_patient_name_snapshot_check" CHECK(length(trim("visit_closures"."patient_display_name_snapshot")) BETWEEN 1 AND 200),
	CONSTRAINT "visit_closures_patient_birth_date_snapshot_check" CHECK("visit_closures"."patient_birth_date_snapshot" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "visit_closures_patient_sex_snapshot_check" CHECK("visit_closures"."patient_sex_snapshot" IN ('female', 'male', 'unknown')),
	CONSTRAINT "visit_closures_doctor_display_name_snapshot_check" CHECK(length(trim("visit_closures"."doctor_display_name_snapshot")) BETWEEN 1 AND 200),
	CONSTRAINT "visit_closures_content_hash_check" CHECK(length("visit_closures"."content_hash") = 64 AND "visit_closures"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_closures_visit_id_unique` ON `visit_closures` (`visit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `visit_closures_charge_id_unique` ON `visit_closures` (`charge_id`);--> statement-breakpoint
CREATE INDEX `visit_closures_clinic_closed_at_index` ON `visit_closures` (`clinic_id`,`closed_at`);--> statement-breakpoint
CREATE TRIGGER `visit_closures_source_guard`
BEFORE INSERT ON `visit_closures`
WHEN NOT EXISTS (
  SELECT 1
  FROM `visits` AS visit
  INNER JOIN `clinic_config` AS clinic ON clinic.id = visit.clinic_id
  INNER JOIN `patients` AS patient ON patient.id = visit.patient_id
  INNER JOIN `finance_charges` AS charge ON charge.id = NEW.charge_id
  INNER JOIN `medication_decisions` AS decision ON decision.id = charge.medication_decision_id
  INNER JOIN `staff_accounts` AS doctor ON doctor.id = NEW.doctor_id_snapshot
  WHERE visit.id = NEW.visit_id
    AND visit.clinic_id = NEW.clinic_id
    AND visit.status = 'READY_TO_CLOSE'
    AND visit.revision = NEW.visit_revision
    AND charge.clinic_id = visit.clinic_id
    AND charge.visit_id = visit.id
    AND decision.visit_id = visit.id
    AND decision.version = charge.medication_decision_version
    AND decision.kind = charge.source_kind
    AND NOT EXISTS (
      SELECT 1 FROM `medication_decisions` AS newer_decision
      WHERE newer_decision.visit_id = decision.visit_id
        AND newer_decision.version > decision.version
    )
    AND EXISTS (
      SELECT 1
      FROM `clinical_notes` AS note
      INNER JOIN `clinical_note_diagnoses` AS diagnosis ON diagnosis.clinical_note_id = note.id
      WHERE note.visit_id = visit.id
    )
    AND clinic.name = NEW.clinic_name_snapshot
    AND patient.id = NEW.patient_id_snapshot
    AND patient.hn = NEW.patient_hn_snapshot
    AND patient.display_name = NEW.patient_display_name_snapshot
    AND patient.birth_date = NEW.patient_birth_date_snapshot
    AND patient.sex = NEW.patient_sex_snapshot
    AND doctor.clinic_id = visit.clinic_id
    AND doctor.role = 'doctor'
    AND doctor.display_name = NEW.doctor_display_name_snapshot
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id) = charge.line_count
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id AND line.line_type = 'CONSULTATION') = 1
    AND NOT EXISTS (
      SELECT 1 FROM `fulfillment_preparations` AS preparation
      WHERE preparation.visit_id = visit.id AND preparation.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM `inventory_reservations` AS reservation
      WHERE reservation.visit_id = visit.id AND reservation.status = 'ACTIVE'
    )
    AND (
      (charge.source_kind = 'ORDER' AND EXISTS (
        SELECT 1 FROM `fulfillment_dispenses` AS dispense
        WHERE dispense.id = charge.fulfillment_dispense_id
          AND dispense.visit_id = visit.id
          AND dispense.medication_decision_id = decision.id
          AND dispense.medication_decision_version = decision.version
      ))
      OR
      (charge.source_kind = 'NO_MEDICATION'
        AND charge.fulfillment_dispense_id IS NULL
        AND length(trim(decision.no_medication_reason)) BETWEEN 1 AND 500
        AND NOT EXISTS (
          SELECT 1 FROM `fulfillment_dispenses` AS dispense WHERE dispense.visit_id = visit.id
        )
      )
    )
    AND (
      (NEW.payment_id IS NOT NULL
        AND NEW.waiver_adjustment_id IS NULL
        AND EXISTS (
          SELECT 1 FROM `finance_payments` AS payment
          WHERE payment.id = NEW.payment_id
            AND payment.charge_id = charge.id
            AND payment.visit_id = visit.id
            AND payment.amount_baht = (
              SELECT sum(line.line_total_baht) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM `finance_charge_adjustments` AS adjustment WHERE adjustment.charge_id = charge.id
        )
      )
      OR
      (NEW.payment_id IS NULL
        AND NEW.waiver_adjustment_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM `finance_charge_adjustments` AS adjustment
          WHERE adjustment.id = NEW.waiver_adjustment_id
            AND adjustment.charge_id = charge.id
            AND adjustment.kind = 'FULL_WAIVER'
            AND adjustment.amount_baht = -(
              SELECT sum(line.line_total_baht) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM `finance_payments` AS payment WHERE payment.charge_id = charge.id
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'visit closure source is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `visit_closures_block_update`
BEFORE UPDATE ON `visit_closures`
BEGIN
  SELECT RAISE(ABORT, 'visit_closures are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `visit_closures_block_delete`
BEFORE DELETE ON `visit_closures`
BEGIN
  SELECT RAISE(ABORT, 'visit_closures are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `visits_closed_transition_guard`
BEFORE UPDATE OF `status`, `revision`, `closed_at` ON `visits`
WHEN NEW.status = 'CLOSED' AND (
  OLD.status <> 'READY_TO_CLOSE'
  OR NEW.revision <> OLD.revision + 1
  OR NEW.closed_at IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `visit_closures` AS closure
    WHERE closure.visit_id = OLD.id
      AND closure.visit_revision = OLD.revision
      AND closure.closed_at = NEW.closed_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'visit closure is required before CLOSED');
END;--> statement-breakpoint
CREATE TRIGGER `visits_closed_reopen_guard`
BEFORE UPDATE OF `status`, `revision`, `closed_at` ON `visits`
WHEN OLD.status = 'CLOSED' AND (
  NEW.status <> 'CLOSED'
  OR NEW.revision <> OLD.revision
  OR NEW.closed_at IS NOT OLD.closed_at
)
BEGIN
  SELECT RAISE(ABORT, 'CLOSED visits cannot reopen');
END;--> statement-breakpoint
CREATE TRIGGER `visits_closure_transition_only_guard`
BEFORE UPDATE OF `status`, `revision`, `closed_at` ON `visits`
WHEN OLD.status <> 'CLOSED'
  AND EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.id)
  AND NOT (
    NEW.status = 'CLOSED'
    AND NEW.revision = OLD.revision + 1
    AND NEW.closed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM `visit_closures` AS closure
      WHERE closure.visit_id = OLD.id
        AND closure.visit_revision = OLD.revision
        AND closure.closed_at = NEW.closed_at
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'Visit with Closure can only transition to CLOSED');
END;--> statement-breakpoint
CREATE TRIGGER `visits_after_closure_block_update`
BEFORE UPDATE ON `visits`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.id)
AND NOT (
  OLD.status = 'READY_TO_CLOSE'
  AND OLD.closed_at IS NULL
  AND NEW.id IS OLD.id
  AND NEW.clinic_id IS OLD.clinic_id
  AND NEW.patient_id IS OLD.patient_id
  AND NEW.chief_complaint IS OLD.chief_complaint
  AND NEW.arrived_at IS OLD.arrived_at
  AND NEW.started_at IS OLD.started_at
  AND NEW.created_by IS OLD.created_by
  AND NEW.status = 'CLOSED'
  AND NEW.revision = OLD.revision + 1
  AND NEW.closed_at IS NOT NULL
  AND NEW.closed_at = (
    SELECT closure.closed_at FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Visit is immutable after Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_notes_after_closure_block_insert`
BEFORE INSERT ON `clinical_notes`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'clinical notes are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_drafts_after_closure_block_insert`
BEFORE INSERT ON `clinical_note_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_drafts_after_closure_block_update`
BEFORE UPDATE ON `clinical_note_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_drafts_after_closure_block_delete`
BEFORE DELETE ON `clinical_note_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_diagnoses_after_closure_block_insert`
BEFORE INSERT ON `clinical_note_diagnoses`
WHEN EXISTS (
  SELECT 1 FROM `clinical_notes` AS note
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = note.visit_id
  WHERE note.id = NEW.clinical_note_id
)
BEGIN
  SELECT RAISE(ABORT, 'clinical diagnoses are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decisions_after_closure_block_insert`
BEFORE INSERT ON `medication_decisions`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'medication decisions are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decision_drafts_after_closure_block_insert`
BEFORE INSERT ON `medication_decision_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decision_drafts_after_closure_block_update`
BEFORE UPDATE ON `medication_decision_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_order_items_after_closure_block_insert`
BEFORE INSERT ON `medication_order_items`
WHEN EXISTS (
  SELECT 1 FROM `medication_decisions` AS decision
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = decision.visit_id
  WHERE decision.id = NEW.medication_decision_id
)
BEGIN
  SELECT RAISE(ABORT, 'medication evidence is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_versions_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_label_versions`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_lines_after_closure_block_insert`
BEFORE INSERT ON `finance_charge_lines`
WHEN EXISTS (
  SELECT 1 FROM `visit_closures` AS closure WHERE closure.charge_id = NEW.charge_id
)
BEGIN
  SELECT RAISE(ABORT, 'finance is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_preparations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_releases_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_releases`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispenses_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_dispenses`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charges_after_closure_block_insert`
BEFORE INSERT ON `finance_charges`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'finance is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_adjustments_after_closure_block_insert`
BEFORE INSERT ON `finance_charge_adjustments`
WHEN EXISTS (
  SELECT 1 FROM `visit_closures` AS closure WHERE closure.charge_id = NEW.charge_id
)
BEGIN
  SELECT RAISE(ABORT, 'finance is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `finance_payments_after_closure_block_insert`
BEFORE INSERT ON `finance_payments`
WHEN EXISTS (
  SELECT 1 FROM `visit_closures` AS closure WHERE closure.charge_id = NEW.charge_id
)
BEGIN
  SELECT RAISE(ABORT, 'finance is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_amendments_closed_visit_doctor_guard`
BEFORE INSERT ON `clinical_note_amendments`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_notes` AS note
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = note.visit_id
  WHERE note.id = NEW.clinical_note_id
)
AND NOT EXISTS (
  SELECT 1 FROM `staff_accounts` AS doctor
  WHERE doctor.id = NEW.signed_by
    AND doctor.role = 'doctor'
    AND doctor.display_name = NEW.signed_by_display_name
)
BEGIN
  SELECT RAISE(ABORT, 'closed Visit amendments require a Doctor signer');
END;--> statement-breakpoint
CREATE TRIGGER `intake_observations_after_closure_block_update`
BEFORE UPDATE ON `intake_observations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'Visit evidence is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `intake_observations_after_closure_block_delete`
BEFORE DELETE ON `intake_observations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'Visit evidence is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_draft_diagnoses_after_closure_block_insert`
BEFORE INSERT ON `clinical_note_draft_diagnoses`
WHEN EXISTS (
  SELECT 1 FROM `clinical_note_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = NEW.draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_draft_diagnoses_after_closure_block_update`
BEFORE UPDATE ON `clinical_note_draft_diagnoses`
WHEN EXISTS (
  SELECT 1 FROM `clinical_note_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = OLD.draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `clinical_note_draft_diagnoses_after_closure_block_delete`
BEFORE DELETE ON `clinical_note_draft_diagnoses`
WHEN EXISTS (
  SELECT 1 FROM `clinical_note_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = OLD.draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'clinical drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_decision_drafts_after_closure_block_delete`
BEFORE DELETE ON `medication_decision_drafts`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_order_draft_items_after_closure_block_insert`
BEFORE INSERT ON `medication_order_draft_items`
WHEN EXISTS (
  SELECT 1 FROM `medication_decision_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = NEW.decision_draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_order_draft_items_after_closure_block_update`
BEFORE UPDATE ON `medication_order_draft_items`
WHEN EXISTS (
  SELECT 1 FROM `medication_decision_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = OLD.decision_draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_order_draft_items_after_closure_block_delete`
BEFORE DELETE ON `medication_order_draft_items`
WHEN EXISTS (
  SELECT 1 FROM `medication_decision_drafts` AS draft
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = draft.visit_id
  WHERE draft.id = OLD.decision_draft_id
)
BEGIN
  SELECT RAISE(ABORT, 'medication drafts are closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `medication_order_price_snapshots_after_closure_block_insert`
BEFORE INSERT ON `medication_order_price_snapshots`
WHEN EXISTS (
  SELECT 1 FROM `medication_order_items` AS item
  INNER JOIN `medication_decisions` AS decision ON decision.id = item.medication_decision_id
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = decision.visit_id
  WHERE item.id = NEW.medication_order_item_id
)
BEGIN
  SELECT RAISE(ABORT, 'medication pricing evidence is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_price_snapshots_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_dispense_price_snapshots`
WHEN EXISTS (
  SELECT 1 FROM `fulfillment_dispense_lines` AS line
  INNER JOIN `fulfillment_dispenses` AS dispense ON dispense.id = line.dispense_id
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = dispense.visit_id
  WHERE line.id = NEW.fulfillment_dispense_line_id
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment pricing evidence is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_after_closure_block_update`
BEFORE UPDATE ON `fulfillment_preparations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_items_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_label_items`
WHEN EXISTS (
  SELECT 1 FROM `fulfillment_label_versions` AS label
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = label.visit_id
  WHERE label.id = NEW.label_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_print_events_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_label_print_events`
WHEN EXISTS (
  SELECT 1 FROM `fulfillment_label_versions` AS label
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = label.visit_id
  WHERE label.id = NEW.label_version_id
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparation_confirmations_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_preparation_confirmations`
WHEN EXISTS (
  SELECT 1 FROM `fulfillment_preparations` AS preparation
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = preparation.visit_id
  WHERE preparation.id = NEW.preparation_id
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_artifact_invalidations_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_artifact_invalidations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_rejections_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_rejections`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_lines_after_closure_block_insert`
BEFORE INSERT ON `fulfillment_dispense_lines`
WHEN EXISTS (
  SELECT 1 FROM `fulfillment_dispenses` AS dispense
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = dispense.visit_id
  WHERE dispense.id = NEW.dispense_id
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment is closed after Visit Closure');
END;--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_after_closure_block_update`
BEFORE UPDATE ON `inventory_reservations`
WHEN EXISTS (SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id)
BEGIN
  SELECT RAISE(ABORT, 'reservation is closed after Visit Closure');
END;
