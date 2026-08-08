CREATE TRIGGER `inventory_reservations_release_reason_insert_guard`
BEFORE INSERT ON `inventory_reservations`
WHEN NEW.status = 'RELEASED'
  AND (
    NEW.released_at IS NULL
    OR NEW.released_by IS NULL
    OR NEW.release_reason IS NULL
    OR length(trim(NEW.release_reason)) NOT BETWEEN 1 AND 500
  )
BEGIN
	SELECT RAISE(ABORT, 'released reservation requires a non-empty reason');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_release_reason_update_guard`
BEFORE UPDATE ON `inventory_reservations`
WHEN NEW.status = 'RELEASED'
  AND (
    NEW.released_at IS NULL
    OR NEW.released_by IS NULL
    OR NEW.release_reason IS NULL
    OR length(trim(NEW.release_reason)) NOT BETWEEN 1 AND 500
  )
BEGIN
	SELECT RAISE(ABORT, 'released reservation requires a non-empty reason');
END;
