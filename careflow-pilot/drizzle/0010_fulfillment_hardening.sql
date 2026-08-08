CREATE TRIGGER `inventory_reservations_insert_state_guard`
BEFORE INSERT ON `inventory_reservations`
WHEN NEW.status <> 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'new inventory reservations must start ACTIVE');
END;--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_consumed_insert_guard`
BEFORE INSERT ON `inventory_reservations`
WHEN (
  (NEW.status <> 'CONSUMED' AND (NEW.consumed_at IS NOT NULL OR NEW.consumed_by IS NOT NULL OR NEW.consumed_dispense_id IS NOT NULL))
  OR (NEW.status = 'CONSUMED' AND (
    NEW.consumed_at IS NULL OR NEW.consumed_by IS NULL OR NEW.consumed_dispense_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `fulfillment_dispenses` AS dispense
      WHERE dispense.id = NEW.consumed_dispense_id
        AND dispense.reservation_id = NEW.id
        AND dispense.handed_off_at = NEW.consumed_at
        AND dispense.handed_off_by = NEW.consumed_by
    )
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'reservation consumption evidence is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_consumed_update_guard`
BEFORE UPDATE ON `inventory_reservations`
WHEN (
  (NEW.status <> 'CONSUMED' AND (NEW.consumed_at IS NOT NULL OR NEW.consumed_by IS NOT NULL OR NEW.consumed_dispense_id IS NOT NULL))
  OR (NEW.status = 'CONSUMED' AND (
    NEW.consumed_at IS NULL OR NEW.consumed_by IS NULL OR NEW.consumed_dispense_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `fulfillment_dispenses` AS dispense
      WHERE dispense.id = NEW.consumed_dispense_id
        AND dispense.reservation_id = NEW.id
        AND dispense.handed_off_at = NEW.consumed_at
        AND dispense.handed_off_by = NEW.consumed_by
    )
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'reservation consumption evidence is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_identity_update_guard`
BEFORE UPDATE ON `inventory_reservations`
WHEN NEW.id IS NOT OLD.id
  OR NEW.clinic_id IS NOT OLD.clinic_id
  OR NEW.visit_id IS NOT OLD.visit_id
  OR NEW.medication_decision_id IS NOT OLD.medication_decision_id
  OR NEW.medication_decision_version IS NOT OLD.medication_decision_version
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by IS NOT OLD.created_by
BEGIN
  SELECT RAISE(ABORT, 'inventory reservation identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_insert_guard`
BEFORE INSERT ON `fulfillment_preparations`
WHEN NEW.status <> 'ACTIVE'
  OR NEW.revision <> 1
  OR NEW.completed_at IS NOT NULL
  OR NEW.completed_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'preparation must start ACTIVE at revision 1');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_identity_update_guard`
BEFORE UPDATE ON `fulfillment_preparations`
WHEN NEW.id IS NOT OLD.id
  OR NEW.clinic_id IS NOT OLD.clinic_id
  OR NEW.visit_id IS NOT OLD.visit_id
  OR NEW.reservation_id IS NOT OLD.reservation_id
  OR NEW.medication_decision_id IS NOT OLD.medication_decision_id
  OR NEW.medication_decision_version IS NOT OLD.medication_decision_version
  OR NEW.label_version_id IS NOT OLD.label_version_id
  OR NEW.minimum_print_sequence IS NOT OLD.minimum_print_sequence
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by IS NOT OLD.created_by
BEGIN
  SELECT RAISE(ABORT, 'preparation identity is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_lifecycle_update_guard`
BEFORE UPDATE ON `fulfillment_preparations`
WHEN NOT (
  OLD.status = 'ACTIVE'
  AND NEW.status = 'COMPLETED'
  AND NEW.revision = OLD.revision + 1
  AND NEW.completed_at IS NOT NULL
  AND NEW.completed_by IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'preparation lifecycle requires ACTIVE to COMPLETED revision increment');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_preparations_block_delete`
BEFORE DELETE ON `fulfillment_preparations`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparations are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_versions_block_update`
BEFORE UPDATE ON `fulfillment_label_versions`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_versions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `fulfillment_label_versions_block_delete`
BEFORE DELETE ON `fulfillment_label_versions`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_label_versions are append-only');
END;
