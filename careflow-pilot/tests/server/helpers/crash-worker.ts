import { writeSync } from "node:fs";
import { openDatabase } from "../../../src/server/db/client.js";
import { executeIdempotent } from "../../../src/server/modules/platform/idempotency.js";
import { createPatientService } from "../../../src/server/modules/patient/service.js";

const [path, phase] = process.argv.slice(2);
const database = openDatabase(path, { environmentId: "synthetic-crash" });
const actor = { id: "doctor-001", role: "doctor" as const, displayName: "พญ. ทดสอบ" };
function barrier(): void {
  writeSync(1, "READY\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
  throw new Error("Parent did not terminate synthetic crash worker");
}
const patients = createPatientService({ database });
executeIdempotent({ db: database.db, actor, key: "synthetic-crash-command", operation: "patient.create-synthetic.v1",
  requestBody: { expectedRevisions: {}, payload: {} },
  work: (tx) => ({ statusCode: 201, data: patients.createSyntheticPatient(tx, actor) }),
  afterStore: phase === "before-commit" ? barrier : undefined });
barrier();
