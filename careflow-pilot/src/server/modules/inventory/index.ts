export {
  inventoryLots,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryReservationAllocations,
  inventoryReservations,
  inventoryStockMovements,
} from "./schema.js";
export {
  createInventoryService,
  SYNTHETIC_PILOT_LOW_STOCK_THRESHOLD,
  type InventoryService,
  type InventoryServiceOptions,
} from "./service.js";
export { registerInventoryRoutes } from "./routes.js";
