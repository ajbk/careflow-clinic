CREATE UNIQUE INDEX `inventory_stock_movements_source_lot_unique` ON `inventory_stock_movements` (`source_type`,`source_id`,`lot_id`);
