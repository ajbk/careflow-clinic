CREATE TRIGGER `inventory_adjustments_correction_source_guard`
BEFORE INSERT ON `inventory_adjustments`
WHEN NOT EXISTS (
  SELECT 1
  FROM `inventory_stock_movements` AS movement
  WHERE movement.id = NEW.corrects_movement_id
    AND movement.clinic_id = NEW.clinic_id
    AND movement.lot_id = NEW.lot_id
    AND (
      (movement.movement_type = 'RECEIPT' AND movement.source_type = 'RECEIPT' AND movement.quantity_delta > 0)
      OR (movement.movement_type = 'DISPENSE' AND movement.source_type = 'DISPENSE' AND movement.quantity_delta < 0)
      OR (movement.movement_type = 'ADJUSTMENT' AND movement.source_type = 'ADJUSTMENT' AND movement.quantity_delta <> 0)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'inventory adjustment correction source is invalid');
END;
