import type { FastifyInstance } from "fastify";
import { requireActor } from "../../auth/hooks.js";
import { medicationSearchQuerySchema } from "../../../shared/contracts.js";
import type { MedicationService } from "./service.js";

export function registerMedicationRoutes(input: {
  app: FastifyInstance;
  medications: MedicationService;
}): void {
  input.app.get("/api/medications", async (request) => {
    requireActor(request, "medication:read-catalog");
    const query = medicationSearchQuerySchema.parse(request.query);
    return { data: input.medications.searchMedications(query.q) };
  });
}
