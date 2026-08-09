CREATE TRIGGER `inventory_reservations_closed_id_conflict_guard`
BEFORE INSERT ON `inventory_reservations`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_reservations` AS existing_reservation
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = existing_reservation.visit_id
  WHERE existing_reservation.id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'reservation ID is closed after Visit Closure');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_reservation_allocations_closed_id_conflict_guard`
BEFORE INSERT ON `inventory_reservation_allocations`
WHEN EXISTS (
  SELECT 1
  FROM `inventory_reservation_allocations` AS existing_allocation
  INNER JOIN `inventory_reservations` AS existing_reservation
    ON existing_reservation.id = existing_allocation.reservation_id
  INNER JOIN `visit_closures` AS closure ON closure.visit_id = existing_reservation.visit_id
  WHERE existing_allocation.id = NEW.id
)
BEGIN
  SELECT RAISE(ABORT, 'reservation allocation ID is closed after Visit Closure');
END;
