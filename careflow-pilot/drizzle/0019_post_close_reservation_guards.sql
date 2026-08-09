CREATE TRIGGER `inventory_reservations_after_closure_block_insert`
BEFORE INSERT ON `inventory_reservations`
WHEN EXISTS (
  SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = NEW.visit_id
)
BEGIN
  SELECT RAISE(ABORT, 'reservation is closed after Visit Closure');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservations_after_closure_block_delete`
BEFORE DELETE ON `inventory_reservations`
WHEN EXISTS (
  SELECT 1 FROM `visit_closures` AS closure WHERE closure.visit_id = OLD.visit_id
)
BEGIN
  SELECT RAISE(ABORT, 'reservation is closed after Visit Closure');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_allocations_after_closure_block_insert`
BEFORE INSERT ON `inventory_reservation_allocations`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_reservations` AS reservation
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = reservation.visit_id
  WHERE reservation.id = NEW.reservation_id
)
BEGIN
  SELECT RAISE(ABORT, 'reservation allocation is closed after Visit Closure');
END;
