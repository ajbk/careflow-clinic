CREATE TABLE `finance_charge_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_baht` integer NOT NULL,
	`reason` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_by_display_name` text NOT NULL,
	`approved_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `finance_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_charge_adjustments_kind_check" CHECK("finance_charge_adjustments"."kind" = 'FULL_WAIVER'),
	CONSTRAINT "finance_charge_adjustments_amount_baht_check" CHECK(typeof("finance_charge_adjustments"."amount_baht") = 'integer' AND "finance_charge_adjustments"."amount_baht" BETWEEN -100000000 AND -1),
	CONSTRAINT "finance_charge_adjustments_reason_check" CHECK(length(trim("finance_charge_adjustments"."reason")) BETWEEN 1 AND 500),
	CONSTRAINT "finance_charge_adjustments_approved_by_display_name_check" CHECK(length(trim("finance_charge_adjustments"."approved_by_display_name")) BETWEEN 1 AND 200),
	CONSTRAINT "finance_charge_adjustments_content_hash_check" CHECK(length("finance_charge_adjustments"."content_hash") = 64 AND "finance_charge_adjustments"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_charge_adjustments_charge_unique` ON `finance_charge_adjustments` (`charge_id`);--> statement-breakpoint
CREATE TABLE `finance_charge_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`position` integer NOT NULL,
	`line_type` text NOT NULL,
	`description_snapshot` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_baht` integer NOT NULL,
	`line_total_baht` integer NOT NULL,
	`medication_order_item_id` text,
	`fulfillment_dispense_line_id` text,
	FOREIGN KEY (`charge_id`) REFERENCES `finance_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fulfillment_dispense_line_id`) REFERENCES `fulfillment_dispense_lines`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_charge_lines_position_check" CHECK("finance_charge_lines"."position" BETWEEN 0 AND 20),
	CONSTRAINT "finance_charge_lines_line_type_check" CHECK("finance_charge_lines"."line_type" IN ('CONSULTATION', 'MEDICATION')),
	CONSTRAINT "finance_charge_lines_description_snapshot_check" CHECK(length(trim("finance_charge_lines"."description_snapshot")) BETWEEN 1 AND 200),
	CONSTRAINT "finance_charge_lines_quantity_check" CHECK(typeof("finance_charge_lines"."quantity") = 'integer' AND "finance_charge_lines"."quantity" BETWEEN 1 AND 999999),
	CONSTRAINT "finance_charge_lines_unit_price_baht_check" CHECK(typeof("finance_charge_lines"."unit_price_baht") = 'integer' AND "finance_charge_lines"."unit_price_baht" BETWEEN 0 AND 1000000),
	CONSTRAINT "finance_charge_lines_line_total_baht_check" CHECK(typeof("finance_charge_lines"."line_total_baht") = 'integer' AND "finance_charge_lines"."line_total_baht" BETWEEN 0 AND 100000000 AND "finance_charge_lines"."line_total_baht" = "finance_charge_lines"."quantity" * "finance_charge_lines"."unit_price_baht"),
	CONSTRAINT "finance_charge_lines_source_shape_check" CHECK(("finance_charge_lines"."line_type" = 'CONSULTATION' AND "finance_charge_lines"."position" = 0 AND "finance_charge_lines"."quantity" = 1 AND "finance_charge_lines"."medication_order_item_id" IS NULL AND "finance_charge_lines"."fulfillment_dispense_line_id" IS NULL) OR ("finance_charge_lines"."line_type" = 'MEDICATION' AND "finance_charge_lines"."position" BETWEEN 1 AND 20 AND "finance_charge_lines"."medication_order_item_id" IS NOT NULL AND "finance_charge_lines"."fulfillment_dispense_line_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_charge_lines_one_consultation_per_charge` ON `finance_charge_lines` (`charge_id`) WHERE "finance_charge_lines"."line_type" = 'CONSULTATION';--> statement-breakpoint
CREATE UNIQUE INDEX `finance_charge_lines_charge_position_unique` ON `finance_charge_lines` (`charge_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_charge_lines_dispense_line_unique` ON `finance_charge_lines` (`fulfillment_dispense_line_id`);--> statement-breakpoint
CREATE TABLE `finance_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`clinic_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`medication_decision_id` text NOT NULL,
	`medication_decision_version` integer NOT NULL,
	`fulfillment_dispense_id` text,
	`clinic_pricing_revision` integer NOT NULL,
	`consultation_fee_baht_snapshot` integer NOT NULL,
	`currency` text NOT NULL,
	`line_count` integer NOT NULL,
	`finalized_by` text NOT NULL,
	`finalized_by_display_name` text NOT NULL,
	`finalized_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinic_config`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`medication_decision_id`) REFERENCES `medication_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fulfillment_dispense_id`) REFERENCES `fulfillment_dispenses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finalized_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_charges_source_kind_check" CHECK("finance_charges"."source_kind" IN ('ORDER', 'NO_MEDICATION')),
	CONSTRAINT "finance_charges_medication_decision_version_check" CHECK("finance_charges"."medication_decision_version" >= 1),
	CONSTRAINT "finance_charges_clinic_pricing_revision_check" CHECK("finance_charges"."clinic_pricing_revision" >= 1),
	CONSTRAINT "finance_charges_consultation_fee_baht_snapshot_check" CHECK(typeof("finance_charges"."consultation_fee_baht_snapshot") = 'integer' AND "finance_charges"."consultation_fee_baht_snapshot" BETWEEN 1 AND 1000000),
	CONSTRAINT "finance_charges_currency_check" CHECK("finance_charges"."currency" = 'THB'),
	CONSTRAINT "finance_charges_line_count_check" CHECK("finance_charges"."line_count" BETWEEN 1 AND 21),
	CONSTRAINT "finance_charges_finalized_by_display_name_check" CHECK(length(trim("finance_charges"."finalized_by_display_name")) BETWEEN 1 AND 200),
	CONSTRAINT "finance_charges_content_hash_check" CHECK(length("finance_charges"."content_hash") = 64 AND "finance_charges"."content_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "finance_charges_source_shape_check" CHECK(("finance_charges"."source_kind" = 'ORDER' AND "finance_charges"."fulfillment_dispense_id" IS NOT NULL) OR ("finance_charges"."source_kind" = 'NO_MEDICATION' AND "finance_charges"."fulfillment_dispense_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_charges_visit_unique` ON `finance_charges` (`visit_id`);--> statement-breakpoint
CREATE TABLE `finance_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_baht` integer NOT NULL,
	`manual_reference` text,
	`confirmed_by` text NOT NULL,
	`confirmed_by_display_name` text NOT NULL,
	`confirmed_at` text NOT NULL,
	`content_hash` text NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `finance_charges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `staff_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finance_payments_method_check" CHECK("finance_payments"."method" IN ('CASH', 'PROMPTPAY')),
	CONSTRAINT "finance_payments_amount_baht_check" CHECK(typeof("finance_payments"."amount_baht") = 'integer' AND "finance_payments"."amount_baht" BETWEEN 1 AND 100000000),
	CONSTRAINT "finance_payments_manual_reference_check" CHECK(("finance_payments"."method" = 'CASH' AND "finance_payments"."manual_reference" IS NULL) OR ("finance_payments"."method" = 'PROMPTPAY' AND length(trim("finance_payments"."manual_reference")) BETWEEN 1 AND 100)),
	CONSTRAINT "finance_payments_confirmed_by_display_name_check" CHECK(length(trim("finance_payments"."confirmed_by_display_name")) BETWEEN 1 AND 200),
	CONSTRAINT "finance_payments_content_hash_check" CHECK(length("finance_payments"."content_hash") = 64 AND "finance_payments"."content_hash" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payments_charge_unique` ON `finance_payments` (`charge_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_payments_visit_unique` ON `finance_payments` (`visit_id`);--> statement-breakpoint
CREATE TRIGGER `finance_charges_source_guard`
BEFORE INSERT ON `finance_charges`
WHEN NOT EXISTS (
  SELECT 1
  FROM `visits` AS visit
  INNER JOIN `clinic_config` AS clinic ON clinic.id = visit.clinic_id
  INNER JOIN `medication_decisions` AS decision ON decision.id = NEW.medication_decision_id
  INNER JOIN `staff_accounts` AS finalizer ON finalizer.id = NEW.finalized_by
  WHERE visit.id = NEW.visit_id
    AND visit.clinic_id = NEW.clinic_id
    AND visit.status = 'AWAITING_CHARGE'
    AND clinic.pricing_revision = NEW.clinic_pricing_revision
    AND clinic.consultation_fee_baht = NEW.consultation_fee_baht_snapshot
    AND decision.visit_id = visit.id
    AND decision.version = NEW.medication_decision_version
    AND decision.kind = NEW.source_kind
    AND NOT EXISTS (
      SELECT 1
      FROM `medication_decisions` AS newer_decision
      WHERE newer_decision.visit_id = decision.visit_id
        AND newer_decision.version > decision.version
    )
    AND EXISTS (SELECT 1 FROM `clinical_notes` AS note WHERE note.visit_id = visit.id)
    AND finalizer.clinic_id = visit.clinic_id
    AND finalizer.role = 'doctor'
    AND finalizer.display_name = NEW.finalized_by_display_name
) OR (NEW.source_kind = 'ORDER' AND NOT EXISTS (
  SELECT 1
  FROM `fulfillment_dispenses` AS dispense
  WHERE dispense.id = NEW.fulfillment_dispense_id
    AND dispense.clinic_id = NEW.clinic_id
    AND dispense.visit_id = NEW.visit_id
    AND dispense.medication_decision_id = NEW.medication_decision_id
    AND dispense.medication_decision_version = NEW.medication_decision_version
)) OR (NEW.source_kind = 'NO_MEDICATION' AND EXISTS (
  SELECT 1 FROM `fulfillment_dispenses` AS dispense WHERE dispense.visit_id = NEW.visit_id
))
BEGIN
  SELECT RAISE(ABORT, 'finance charge source is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_lines_source_guard`
BEFORE INSERT ON `finance_charge_lines`
WHEN (NEW.line_type = 'CONSULTATION' AND NOT EXISTS (
  SELECT 1
  FROM `finance_charges` AS charge
  WHERE charge.id = NEW.charge_id
    AND NEW.unit_price_baht = charge.consultation_fee_baht_snapshot
    AND NEW.line_total_baht = charge.consultation_fee_baht_snapshot
)) OR (NEW.line_type = 'MEDICATION' AND NOT EXISTS (
  SELECT 1
  FROM `finance_charges` AS charge
  INNER JOIN `fulfillment_dispenses` AS dispense ON dispense.id = charge.fulfillment_dispense_id
  INNER JOIN `fulfillment_dispense_lines` AS dispense_line
    ON dispense_line.id = NEW.fulfillment_dispense_line_id
  INNER JOIN `fulfillment_dispense_price_snapshots` AS price_snapshot
    ON price_snapshot.fulfillment_dispense_line_id = dispense_line.id
  WHERE charge.id = NEW.charge_id
    AND charge.source_kind = 'ORDER'
    AND dispense_line.dispense_id = dispense.id
    AND dispense_line.medication_order_item_id = NEW.medication_order_item_id
    AND dispense_line.quantity = NEW.quantity
    AND dispense_line.display_name_snapshot = NEW.description_snapshot
    AND price_snapshot.medication_id = dispense_line.medication_id
    AND price_snapshot.unit_price_baht_snapshot = NEW.unit_price_baht
    AND price_snapshot.currency = charge.currency
))
BEGIN
  SELECT RAISE(ABORT, 'finance charge line source is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_adjustments_source_guard`
BEFORE INSERT ON `finance_charge_adjustments`
WHEN NOT EXISTS (
  SELECT 1
  FROM `finance_charges` AS charge
  INNER JOIN `staff_accounts` AS approver ON approver.id = NEW.approved_by
  WHERE charge.id = NEW.charge_id
    AND approver.clinic_id = charge.clinic_id
    AND approver.role = 'doctor'
    AND approver.display_name = NEW.approved_by_display_name
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id) = charge.line_count
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id AND line.line_type = 'CONSULTATION') = 1
    AND NEW.amount_baht = -(
      SELECT sum(line.line_total_baht) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id
    )
    AND NOT EXISTS (SELECT 1 FROM `finance_payments` AS payment WHERE payment.charge_id = charge.id)
)
BEGIN
  SELECT RAISE(ABORT, 'finance charge adjustment source is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `finance_payments_source_guard`
BEFORE INSERT ON `finance_payments`
WHEN NOT EXISTS (
  SELECT 1
  FROM `finance_charges` AS charge
  INNER JOIN `staff_accounts` AS confirmer ON confirmer.id = NEW.confirmed_by
  WHERE charge.id = NEW.charge_id
    AND charge.visit_id = NEW.visit_id
    AND confirmer.clinic_id = charge.clinic_id
    AND confirmer.display_name = NEW.confirmed_by_display_name
    AND (NEW.method = 'CASH' OR confirmer.role = 'doctor')
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id) = charge.line_count
    AND (SELECT count(*) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id AND line.line_type = 'CONSULTATION') = 1
    AND NEW.amount_baht = (
      SELECT sum(line.line_total_baht) FROM `finance_charge_lines` AS line WHERE line.charge_id = charge.id
    )
    AND NOT EXISTS (SELECT 1 FROM `finance_charge_adjustments` AS adjustment WHERE adjustment.charge_id = charge.id)
)
BEGIN
  SELECT RAISE(ABORT, 'finance payment source is invalid');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charges_block_update`
BEFORE UPDATE ON `finance_charges`
BEGIN
  SELECT RAISE(ABORT, 'finance_charges are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charges_block_delete`
BEFORE DELETE ON `finance_charges`
BEGIN
  SELECT RAISE(ABORT, 'finance_charges are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_lines_block_update`
BEFORE UPDATE ON `finance_charge_lines`
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_lines are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_lines_block_delete`
BEFORE DELETE ON `finance_charge_lines`
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_lines are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_adjustments_block_update`
BEFORE UPDATE ON `finance_charge_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_adjustments are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_charge_adjustments_block_delete`
BEFORE DELETE ON `finance_charge_adjustments`
BEGIN
  SELECT RAISE(ABORT, 'finance_charge_adjustments are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_payments_block_update`
BEFORE UPDATE ON `finance_payments`
BEGIN
  SELECT RAISE(ABORT, 'finance_payments are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `finance_payments_block_delete`
BEFORE DELETE ON `finance_payments`
BEGIN
  SELECT RAISE(ABORT, 'finance_payments are append-only');
END;
