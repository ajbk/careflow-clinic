CREATE TRIGGER `__drizzle_migrations_protected_insert_conflict_guard`
BEFORE INSERT ON `__drizzle_migrations`
WHEN EXISTS (
  SELECT 1
  FROM `__drizzle_migrations` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, '__drizzle_migrations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_protected_insert_conflict_guard`
BEFORE INSERT ON `audit_events`
WHEN EXISTS (
  SELECT 1
  FROM `audit_events` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'audit_events insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinic_config_protected_insert_conflict_guard`
BEFORE INSERT ON `clinic_config`
WHEN EXISTS (
  SELECT 1
  FROM `clinic_config` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'clinic_config insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_amendments_protected_insert_conflict_guard`
BEFORE INSERT ON `clinical_note_amendments`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_note_amendments` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinical_note_id` = NEW.`clinical_note_id` AND existing.`version` = NEW.`version`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'clinical_note_amendments insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_diagnoses_protected_insert_conflict_guard`
BEFORE INSERT ON `clinical_note_diagnoses`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_note_diagnoses` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinical_note_id` = NEW.`clinical_note_id` AND existing.`position` = NEW.`position`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'clinical_note_diagnoses insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_notes_protected_insert_conflict_guard`
BEFORE INSERT ON `clinical_notes`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_notes` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id` AND existing.`version` = NEW.`version`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'clinical_notes insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_charge_adjustments_protected_insert_conflict_guard`
BEFORE INSERT ON `finance_charge_adjustments`
WHEN EXISTS (
  SELECT 1
  FROM `finance_charge_adjustments` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`charge_id` = NEW.`charge_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_adjustments insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_charge_lines_protected_insert_conflict_guard`
BEFORE INSERT ON `finance_charge_lines`
WHEN EXISTS (
  SELECT 1
  FROM `finance_charge_lines` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`charge_id` = NEW.`charge_id` AND existing.`position` = NEW.`position`)
    OR     (existing.`fulfillment_dispense_line_id` = NEW.`fulfillment_dispense_line_id`)
    OR     (existing.`charge_id` = NEW.`charge_id` AND existing.`line_type` = 'CONSULTATION' AND NEW.`line_type` = 'CONSULTATION')
  )
)
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_lines insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_charges_protected_insert_conflict_guard`
BEFORE INSERT ON `finance_charges`
WHEN EXISTS (
  SELECT 1
  FROM `finance_charges` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'finance_charges insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `finance_payments_protected_insert_conflict_guard`
BEFORE INSERT ON `finance_payments`
WHEN EXISTS (
  SELECT 1
  FROM `finance_payments` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`charge_id` = NEW.`charge_id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'finance_payments insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_artifact_invalidations_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_artifact_invalidations`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_artifact_invalidations` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`artifact_type` = NEW.`artifact_type` AND existing.`artifact_id` = NEW.`artifact_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_artifact_invalidations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_lines_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_dispense_lines`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_dispense_lines` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`reservation_allocation_id` = NEW.`reservation_allocation_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_lines insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_price_snapshots_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_dispense_price_snapshots`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_dispense_price_snapshots` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`fulfillment_dispense_line_id` = NEW.`fulfillment_dispense_line_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_price_snapshots insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispenses_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_dispenses`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_dispenses` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`release_id` = NEW.`release_id`)
    OR     (existing.`reservation_id` = NEW.`reservation_id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispenses insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_items_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_label_items`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_label_items` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`label_version_id` = NEW.`label_version_id` AND existing.`position` = NEW.`position`)
    OR     (existing.`medication_order_item_id` = NEW.`medication_order_item_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_items insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_print_events_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_label_print_events`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_label_print_events` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`label_version_id` = NEW.`label_version_id` AND existing.`sequence` = NEW.`sequence`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_print_events insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_versions_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_label_versions`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_label_versions` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`medication_decision_id` = NEW.`medication_decision_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_versions insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparation_confirmations_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_preparation_confirmations`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_preparation_confirmations` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`preparation_id` = NEW.`preparation_id` AND existing.`reservation_allocation_id` = NEW.`reservation_allocation_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparation_confirmations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_rejections_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_rejections`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_rejections` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`preparation_id` = NEW.`preparation_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_rejections insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_releases_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_releases`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_releases` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`reservation_id` = NEW.`reservation_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_releases insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `idempotency_records_protected_insert_conflict_guard`
BEFORE INSERT ON `idempotency_records`
WHEN EXISTS (
  SELECT 1
  FROM `idempotency_records` AS existing
  WHERE (
    (existing.`actor_id` = NEW.`actor_id` AND existing.`key` = NEW.`key`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'idempotency_records insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_adjustments_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_adjustments`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_adjustments` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_adjustments insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lot_status_events_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_lot_status_events`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_lot_status_events` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_lot_status_events insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lots_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_lots`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_lots` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinic_id` = NEW.`clinic_id` AND existing.`medication_id` = NEW.`medication_id` AND existing.`lot_number` = NEW.`lot_number`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_lots insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipt_lines_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_receipt_lines`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_receipt_lines` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_receipt_lines insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_receipts_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_receipts`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_receipts` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_receipts insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_allocations_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_reservation_allocations`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_reservation_allocations` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`reservation_id` = NEW.`reservation_id` AND existing.`medication_order_item_id` = NEW.`medication_order_item_id` AND existing.`lot_id` = NEW.`lot_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_reservation_allocations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_stock_movements_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_stock_movements`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_stock_movements` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`source_type` = NEW.`source_type` AND existing.`source_id` = NEW.`source_id` AND existing.`lot_id` = NEW.`lot_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_stock_movements insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_decisions_protected_insert_conflict_guard`
BEFORE INSERT ON `medication_decisions`
WHEN EXISTS (
  SELECT 1
  FROM `medication_decisions` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id` AND existing.`version` = NEW.`version`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'medication_decisions insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_items_protected_insert_conflict_guard`
BEFORE INSERT ON `medication_order_items`
WHEN EXISTS (
  SELECT 1
  FROM `medication_order_items` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`medication_decision_id` = NEW.`medication_decision_id` AND existing.`position` = NEW.`position`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'medication_order_items insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_price_snapshots_protected_insert_conflict_guard`
BEFORE INSERT ON `medication_order_price_snapshots`
WHEN EXISTS (
  SELECT 1
  FROM `medication_order_price_snapshots` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`medication_order_item_id` = NEW.`medication_order_item_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'medication_order_price_snapshots insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medications_protected_insert_conflict_guard`
BEFORE INSERT ON `medications`
WHEN EXISTS (
  SELECT 1
  FROM `medications` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`internal_barcode` = NEW.`internal_barcode` AND existing.`active` = 1 AND NEW.`active` = 1)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'medications insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_items_protected_insert_conflict_guard`
BEFORE INSERT ON `patient_allergy_items`
WHEN EXISTS (
  SELECT 1
  FROM `patient_allergy_items` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`allergy_revision_id` = NEW.`allergy_revision_id` AND existing.`position` = NEW.`position`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'patient_allergy_items insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_allergy_revisions_protected_insert_conflict_guard`
BEFORE INSERT ON `patient_allergy_revisions`
WHEN EXISTS (
  SELECT 1
  FROM `patient_allergy_revisions` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`patient_id` = NEW.`patient_id` AND existing.`revision` = NEW.`revision`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'patient_allergy_revisions insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `patients_protected_insert_conflict_guard`
BEFORE INSERT ON `patients`
WHEN EXISTS (
  SELECT 1
  FROM `patients` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinic_id` = NEW.`clinic_id` AND existing.`hn` = NEW.`hn`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'patients insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `platform_metadata_protected_insert_conflict_guard`
BEFORE INSERT ON `platform_metadata`
WHEN EXISTS (
  SELECT 1
  FROM `platform_metadata` AS existing
  WHERE (
    (existing.`key` = NEW.`key`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'platform_metadata insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `staff_accounts_protected_insert_conflict_guard`
BEFORE INSERT ON `staff_accounts`
WHEN EXISTS (
  SELECT 1
  FROM `staff_accounts` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinic_id` = NEW.`clinic_id` AND existing.`username` = NEW.`username`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'staff_accounts insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `visit_closures_protected_insert_conflict_guard`
BEFORE INSERT ON `visit_closures`
WHEN EXISTS (
  SELECT 1
  FROM `visit_closures` AS existing
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`charge_id` = NEW.`charge_id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'visit_closures insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `visits_protected_insert_conflict_guard`
BEFORE INSERT ON `visits`
WHEN EXISTS (
  SELECT 1
  FROM `visits` AS existing LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinic_id` = NEW.`clinic_id` AND existing.`patient_id` = NEW.`patient_id` AND existing.`status` <> 'CLOSED' AND NEW.`status` <> 'CLOSED')
  )
    AND (existing.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'visits insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `intake_observations_protected_insert_conflict_guard`
BEFORE INSERT ON `intake_observations`
WHEN EXISTS (
  SELECT 1
  FROM `intake_observations` AS existing INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'intake_observations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_drafts_protected_insert_conflict_guard`
BEFORE INSERT ON `clinical_note_drafts`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_note_drafts` AS existing INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'clinical_note_drafts insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_note_draft_diagnoses_protected_insert_conflict_guard`
BEFORE INSERT ON `clinical_note_draft_diagnoses`
WHEN EXISTS (
  SELECT 1
  FROM `clinical_note_draft_diagnoses` AS existing INNER JOIN `clinical_note_drafts` AS existing_draft ON existing_draft.`id` = existing.`draft_id` INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing_draft.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`draft_id` = NEW.`draft_id` AND existing.`position` = NEW.`position`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'clinical_note_draft_diagnoses insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_decision_drafts_protected_insert_conflict_guard`
BEFORE INSERT ON `medication_decision_drafts`
WHEN EXISTS (
  SELECT 1
  FROM `medication_decision_drafts` AS existing INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`visit_id` = NEW.`visit_id`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'medication_decision_drafts insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_draft_items_protected_insert_conflict_guard`
BEFORE INSERT ON `medication_order_draft_items`
WHEN EXISTS (
  SELECT 1
  FROM `medication_order_draft_items` AS existing INNER JOIN `medication_decision_drafts` AS existing_draft ON existing_draft.`id` = existing.`decision_draft_id` INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing_draft.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`decision_draft_id` = NEW.`decision_draft_id` AND existing.`position` = NEW.`position`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'medication_order_draft_items insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_protected_insert_conflict_guard`
BEFORE INSERT ON `inventory_reservations`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_reservations` AS existing INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`clinic_id` = NEW.`clinic_id` AND existing.`visit_id` = NEW.`visit_id` AND existing.`medication_decision_id` = NEW.`medication_decision_id` AND existing.`medication_decision_version` = NEW.`medication_decision_version` AND existing.`status` = 'ACTIVE' AND NEW.`status` = 'ACTIVE')
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'inventory_reservations insert conflicts with protected evidence');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_protected_insert_conflict_guard`
BEFORE INSERT ON `fulfillment_preparations`
WHEN EXISTS (
  SELECT 1
  FROM `fulfillment_preparations` AS existing INNER JOIN `inventory_reservations` AS existing_reservation ON existing_reservation.`id` = existing.`reservation_id` INNER JOIN `visits` AS existing_visit ON existing_visit.`id` = existing_reservation.`visit_id` LEFT JOIN `visit_closures` AS closure ON closure.`visit_id` = existing_visit.`id`
  WHERE (
    (existing.`id` = NEW.`id`)
    OR     (existing.`reservation_id` = NEW.`reservation_id`)
  )
    AND (existing_visit.`status` = 'CLOSED' OR closure.`id` IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparations insert conflicts with protected evidence');
END;
