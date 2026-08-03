import { afterEach, describe, expect, it } from "vitest";
import {
  auditEvents,
  executeIdempotent,
} from "../../src/server/modules/platform/index.js";
import { createPatientService } from "../../src/server/modules/patient/index.js";
import { intakeObservations, createVisitService, visits } from "../../src/server/modules/visit/index.js";
import type { SubmitIntakeBody } from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const app = await createTestApp();
  cleanups.push(app.cleanup);
  const assistant = await seedAccount(app.database, {
    id: "assistant-001",
    username: "assistant",
    role: "assistant",
    displayName: "ผู้ช่วยทดสอบ",
    mustChangePassword: false,
  });
  const doctor = await seedAccount(app.database, {
    id: "doctor-001",
    username: "doctor",
    role: "doctor",
    displayName: "พญ. ทดสอบ",
    mustChangePassword: false,
  });
  return {
    ...app,
    assistant,
    doctor,
    assistantCookie: cookieFrom(await login(app.app, assistant.username, assistant.password)),
    doctorCookie: cookieFrom(await login(app.app, doctor.username, doctor.password)),
  };
}

async function createPatient(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  cookie: string,
  key = "patient-for-visit-001",
) {
  return app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie, "idempotency-key": key },
    payload: { expectedRevisions: {}, payload: {} },
  });
}

async function submitIntake(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  cookie: string,
  patientId: string,
  key = "visit-intake-001",
  complaint = "ไอและมีไข้",
) {
  return app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie, "idempotency-key": key },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId,
        chiefComplaint: complaint,
        vitals: {
          weightKg: 60,
          heightCm: 165,
          temperatureC: 37.5,
          systolicMmhg: 120,
          diastolicMmhg: 80,
          heartRateBpm: 80,
          spo2Percent: 98,
        },
      },
    },
  });
}

describe("shared Intake, Queue, and consultation workflow", () => {
  it("creates one Visit, Observation, and Audit atomically", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const response = await submitIntake(test.app, test.assistantCookie, patient.json().data.id);

    expect(response.statusCode).toBe(201);
    expect(response.json().data.visit).toMatchObject({ status: "WAITING", revision: 1 });
    expect(test.database.db.select().from(visits).all()).toHaveLength(1);
    expect(test.database.db.select().from(intakeObservations).all()).toHaveLength(1);
    expect(
      test.database.db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.action === "visit.intake-submitted"),
    ).toHaveLength(1);
  });

  it("rolls back the Visit and Observation when Audit fails after the observation write", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const body: SubmitIntakeBody = {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId: patient.json().data.id,
        chiefComplaint: "ไอ",
        vitals: {
          weightKg: 60,
          heightCm: 165,
          temperatureC: 37,
          systolicMmhg: 120,
          diastolicMmhg: 80,
          heartRateBpm: 80,
          spo2Percent: 98,
        },
      },
    };
    const service = createVisitService({
      database: test.database,
      patients: createPatientService({ database: test.database }),
      appendAudit: () => {
        throw new Error("injected audit failure");
      },
    });

    expect(() =>
      executeIdempotent({
        db: test.database.db,
        actor: test.assistant.actor,
        key: "visit-audit-failure-001",
        operation: "visit.submit-intake.v1",
        requestBody: body,
        work: (tx) => ({
          statusCode: 201,
          data: service.submitIntake(tx, test.assistant.actor, body),
        }),
      }),
    ).toThrow("injected audit failure");
    expect(test.database.db.select().from(visits).all()).toHaveLength(0);
    expect(test.database.db.select().from(intakeObservations).all()).toHaveLength(0);
    expect(
      test.database.db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.action === "visit.intake-submitted"),
    ).toHaveLength(0);
  });

  it("replays the same Intake and rejects a changed body", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const first = await submitIntake(test.app, test.assistantCookie, patient.json().data.id);
    const replay = await submitIntake(test.app, test.assistantCookie, patient.json().data.id);
    const collision = await submitIntake(
      test.app,
      test.assistantCookie,
      patient.json().data.id,
      "visit-intake-001",
      "ปวดศีรษะ",
    );

    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(test.database.db.select().from(visits).all()).toHaveLength(1);
  });

  it("shares Queue state, gates Start Consultation to Doctor, and checks revisions", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const created = await submitIntake(test.app, test.assistantCookie, patient.json().data.id);
    const visitId = created.json().data.visit.id as string;

    const assistantQueue = await test.app.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: test.assistantCookie },
    });
    const doctorQueue = await test.app.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: test.doctorCookie },
    });
    expect(assistantQueue.json().data[0]).toMatchObject({
      visit: { id: visitId, status: "WAITING", revision: 1 },
      allowedActions: [],
    });
    expect(doctorQueue.json().data[0]).toMatchObject({
      visit: { id: visitId, status: "WAITING", revision: 1 },
      allowedActions: ["START_CONSULTATION"],
    });

    const forbidden = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "start-visit-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(forbidden.statusCode).toBe(403);

    const started = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "start-visit-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().data.visit).toMatchObject({ status: "CONSULTING", revision: 2 });
    expect(started.json().data.allowedActions).toEqual([]);

    const stale = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "start-visit-002" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toMatch(/REVISION_CONFLICT|INVALID_STATE/);
    expect(test.database.db.select().from(visits).get()?.revision).toBe(2);
    expect(
      test.database.db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.action === "visit.consultation-started"),
    ).toHaveLength(1);
  });

  it("rejects a second active visit and invalid intake fields before writing", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const patientId = patient.json().data.id as string;
    expect((await submitIntake(test.app, test.assistantCookie, patientId)).statusCode).toBe(201);
    const duplicate = await submitIntake(test.app, test.assistantCookie, patientId, "visit-intake-002");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACTIVE_VISIT_EXISTS");

    const invalid = await submitIntake(
      test.app,
      test.assistantCookie,
      "not-a-patient",
      "visit-invalid-001",
      " ",
    );
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("VALIDATION_FAILED");
    expect(test.database.db.select().from(visits).all()).toHaveLength(1);
  });
});
