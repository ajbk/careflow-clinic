import type { FastifyInstance } from "fastify";
import { requireActor } from "../auth/hooks.js";
import type { JourneyService } from "./journey.js";

/** Read-only Journey route. Authentication deliberately precedes every Journey evidence reader. */
export function registerJourneyRoutes(input: {
  app: FastifyInstance;
  journey: JourneyService;
}): void {
  input.app.get("/api/visits/:visitId/journey", async (request) => {
    const actor = requireActor(request, "visit:read-queue");
    const params = request.params as { visitId?: string };
    return { data: input.journey.getJourney(actor, params.visitId ?? "") };
  });
}
