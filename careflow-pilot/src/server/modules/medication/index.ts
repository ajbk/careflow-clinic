export {
  medicationDecisionDrafts,
  medicationDecisions,
  medicationOrderDraftItems,
  medicationOrderItems,
  medications,
} from "./schema.js";
export {
  createMedicationService,
  type MedicationService,
  type MedicationServiceOptions,
} from "./service.js";
export { registerMedicationRoutes } from "./routes.js";
