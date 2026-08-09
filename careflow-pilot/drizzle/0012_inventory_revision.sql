-- Revision is additive on an inventory parent table.  Keeping foreign_keys ON
-- preserves all existing receipt/reservation/dispense references while the
-- new optimistic-concurrency value is introduced.
ALTER TABLE `inventory_lots` ADD COLUMN `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `inventory_lots_revision_insert_guard`
BEFORE INSERT ON `inventory_lots`
WHEN NEW.revision < 1
BEGIN
  SELECT RAISE(ABORT, 'inventory_lots revision must be positive');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_lots_revision_update_guard`
BEFORE UPDATE OF revision ON `inventory_lots`
WHEN NEW.revision < 1
BEGIN
  SELECT RAISE(ABORT, 'inventory_lots revision must be positive');
END;
