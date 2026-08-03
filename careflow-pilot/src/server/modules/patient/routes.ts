import type { FastifyInstance } from "fastify";
import {
  createSyntheticPatientBodySchema,
  patientSearchQuerySchema,
} from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { requireActor } from "../../auth/hooks.js";
import { executeIdempotent } from "../platform/index.js";
import type { PatientService } from "./service.js";

export function registerPatientRoutes(input: {
  app: FastifyInstance;
  database: DatabaseHandle;
  patients: PatientService;
}): void {
  input.app.post("/api/patients/synthetic", async (request, reply) => {
    const actor = requireActor(request, "patient:create-synthetic");
    const body = createSyntheticPatientBodySchema.parse(request.body);
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : "";
    const result = executeIdempotent({
      db: input.database.db,
      actor,
      key,
      operation: "patient.create-synthetic.v1",
      requestBody: body,
      work: (tx) => ({
        statusCode: 201,
        data: input.patients.createSyntheticPatient(tx, actor),
      }),
    });
    return reply.code(result.statusCode).send(result.body);
  });

  input.app.get("/api/patients/search", async (request) => {
    requireActor(request, "patient:read");
    const query = patientSearchQuerySchema.parse(request.query);
    return { data: input.patients.searchPatients(query.q) };
  });
}
