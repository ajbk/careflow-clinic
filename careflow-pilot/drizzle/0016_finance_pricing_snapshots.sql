ALTER TABLE `clinic_config` ADD COLUMN `consultation_fee_baht` integer NOT NULL DEFAULT 100
  CHECK(typeof(`consultation_fee_baht`) = 'integer' AND `consultation_fee_baht` BETWEEN 1 AND 1000000);
--> statement-breakpoint
ALTER TABLE `clinic_config` ADD COLUMN `pricing_revision` integer NOT NULL DEFAULT 1
  CHECK(typeof(`pricing_revision`) = 'integer' AND `pricing_revision` >= 1);
--> statement-breakpoint
ALTER TABLE `medications` ADD COLUMN `unit_price_baht` integer NOT NULL DEFAULT 0
  CHECK(typeof(`unit_price_baht`) = 'integer' AND `unit_price_baht` BETWEEN 0 AND 1000000);
--> statement-breakpoint
UPDATE `medications`
SET `unit_price_baht` = CASE `id`
  WHEN 'DEMO-MED-001' THEN 5
  WHEN 'DEMO-MED-002' THEN 10
  WHEN 'DEMO-MED-003' THEN 50
  WHEN 'DEMO-MED-004' THEN 15
  ELSE `unit_price_baht`
END
WHERE `id` IN ('DEMO-MED-001', 'DEMO-MED-002', 'DEMO-MED-003', 'DEMO-MED-004');
--> statement-breakpoint
CREATE TABLE `medication_order_price_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `medication_order_item_id` text NOT NULL,
  `medication_id` text NOT NULL,
  `medication_revision` integer NOT NULL,
  `unit_price_baht_snapshot` integer NOT NULL,
  `currency` text NOT NULL,
  `captured_at` text NOT NULL,
  FOREIGN KEY (`medication_order_item_id`) REFERENCES `medication_order_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `medication_order_price_snapshots_medication_revision_check` CHECK(`medication_revision` >= 1),
  CONSTRAINT `medication_order_price_snapshots_unit_price_baht_check` CHECK(typeof(`unit_price_baht_snapshot`) = 'integer' AND `unit_price_baht_snapshot` BETWEEN 0 AND 1000000),
  CONSTRAINT `medication_order_price_snapshots_currency_check` CHECK(`currency` = 'THB')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `medication_order_price_snapshots_order_item_unique`
  ON `medication_order_price_snapshots` (`medication_order_item_id`);
--> statement-breakpoint
CREATE TABLE `fulfillment_dispense_price_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `fulfillment_dispense_line_id` text NOT NULL,
  `order_price_snapshot_id` text NOT NULL,
  `medication_id` text NOT NULL,
  `unit_price_baht_snapshot` integer NOT NULL,
  `currency` text NOT NULL,
  `captured_at` text NOT NULL,
  FOREIGN KEY (`fulfillment_dispense_line_id`) REFERENCES `fulfillment_dispense_lines`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`order_price_snapshot_id`) REFERENCES `medication_order_price_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`medication_id`) REFERENCES `medications`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `fulfillment_dispense_price_snapshots_unit_price_baht_check` CHECK(typeof(`unit_price_baht_snapshot`) = 'integer' AND `unit_price_baht_snapshot` BETWEEN 0 AND 1000000),
  CONSTRAINT `fulfillment_dispense_price_snapshots_currency_check` CHECK(`currency` = 'THB')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fulfillment_dispense_price_snapshots_dispense_line_unique`
  ON `fulfillment_dispense_price_snapshots` (`fulfillment_dispense_line_id`);
--> statement-breakpoint
CREATE TRIGGER `medication_order_price_snapshots_source_guard`
BEFORE INSERT ON `medication_order_price_snapshots`
WHEN NOT EXISTS (
  SELECT 1
  FROM `medication_order_items` AS item
  INNER JOIN `medications` AS medication ON medication.id = item.medication_id
  WHERE item.id = NEW.medication_order_item_id
    AND item.medication_id = NEW.medication_id
    AND item.medication_revision = NEW.medication_revision
    AND medication.revision = NEW.medication_revision
    AND medication.unit_price_baht = NEW.unit_price_baht_snapshot
)
BEGIN
  SELECT RAISE(ABORT, 'medication order price snapshot source is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_price_snapshots_source_guard`
BEFORE INSERT ON `fulfillment_dispense_price_snapshots`
WHEN NOT EXISTS (
  SELECT 1
  FROM `fulfillment_dispense_lines` AS line
  INNER JOIN `medication_order_price_snapshots` AS order_snapshot
    ON order_snapshot.medication_order_item_id = line.medication_order_item_id
  WHERE line.id = NEW.fulfillment_dispense_line_id
    AND order_snapshot.id = NEW.order_price_snapshot_id
    AND line.medication_id = NEW.medication_id
    AND order_snapshot.medication_id = NEW.medication_id
    AND order_snapshot.unit_price_baht_snapshot = NEW.unit_price_baht_snapshot
    AND order_snapshot.currency = NEW.currency
)
BEGIN
  SELECT RAISE(ABORT, 'fulfillment dispense price snapshot source is invalid');
END;
--> statement-breakpoint
INSERT INTO `medication_order_price_snapshots` (
  `id`, `medication_order_item_id`, `medication_id`, `medication_revision`,
  `unit_price_baht_snapshot`, `currency`, `captured_at`
)
SELECT
  'price-order-' || item.id,
  item.id,
  item.medication_id,
  item.medication_revision,
  medication.unit_price_baht,
  'THB',
  decision.signed_at
FROM `medication_order_items` AS item
INNER JOIN `medication_decisions` AS decision ON decision.id = item.medication_decision_id
INNER JOIN `medications` AS medication ON medication.id = item.medication_id;
--> statement-breakpoint
INSERT INTO `fulfillment_dispense_price_snapshots` (
  `id`, `fulfillment_dispense_line_id`, `order_price_snapshot_id`, `medication_id`,
  `unit_price_baht_snapshot`, `currency`, `captured_at`
)
SELECT
  'price-dispense-' || line.id,
  line.id,
  order_snapshot.id,
  line.medication_id,
  order_snapshot.unit_price_baht_snapshot,
  order_snapshot.currency,
  dispense.handed_off_at
FROM `fulfillment_dispense_lines` AS line
INNER JOIN `fulfillment_dispenses` AS dispense ON dispense.id = line.dispense_id
INNER JOIN `medication_order_price_snapshots` AS order_snapshot
  ON order_snapshot.medication_order_item_id = line.medication_order_item_id;
--> statement-breakpoint
CREATE TRIGGER `clinic_config_pricing_revision_guard`
BEFORE UPDATE OF `consultation_fee_baht`, `pricing_revision` ON `clinic_config`
WHEN NEW.consultation_fee_baht <> OLD.consultation_fee_baht
  AND NEW.pricing_revision <> OLD.pricing_revision + 1
BEGIN
  SELECT RAISE(ABORT, 'clinic pricing changes require a revision increment');
END;
--> statement-breakpoint
CREATE TRIGGER `medications_unit_price_baht_revision_guard`
BEFORE UPDATE OF `unit_price_baht`, `revision` ON `medications`
WHEN NEW.unit_price_baht <> OLD.unit_price_baht
  AND NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'medication price changes require a revision increment');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_price_snapshots_block_update`
BEFORE UPDATE ON `medication_order_price_snapshots`
BEGIN
	SELECT RAISE(ABORT, 'medication_order_price_snapshots are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `medication_order_price_snapshots_block_delete`
BEFORE DELETE ON `medication_order_price_snapshots`
BEGIN
	SELECT RAISE(ABORT, 'medication_order_price_snapshots are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_price_snapshots_block_update`
BEFORE UPDATE ON `fulfillment_dispense_price_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_price_snapshots are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `fulfillment_dispense_price_snapshots_block_delete`
BEFORE DELETE ON `fulfillment_dispense_price_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_dispense_price_snapshots are append-only');
END;
