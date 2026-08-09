import { afterEach, describe, expect, it } from "vitest";
import {
  auditEvents,
  executeIdempotent,
} from "../../src/server/modules/platform/index.js";
import { createPatientService } from "../../src/server/modules/patient/index.js";
import { intakeObservations, createVisitService, visits } from "../../src/server/modules/visit/index.js";
import type { IntakePayload, SubmitIntakeBody } from "../../src/shared/contracts.js";
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
  vitals: IntakePayload["vitals"] = {
    weightKg: 60,
    heightCm: 165,
    temperatureC: 37.5,
    systolicMmhg: 120,
    diastolicMmhg: 80,
    heartRateBpm: 80,
    spo2Percent: 98,
  },
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
        vitals,
      },
    },
  });
}

async function closeNoMedicationVisit(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  key: string,
): Promise<void> {
  const started = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/start-consultation`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${key}-start` },
    payload: { expectedRevisions: { visit: 1 }, payload: {} },
  });
  expect(started.statusCode).toBe(200);

  const draft = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/consultation-draft`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${key}-draft` },
    payload: {
      expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
      payload: {
        note: {
          subjective: "ปิด Visit เพื่อทดสอบ",
          objective: "ผลตรวจเพื่อทดสอบ",
          assessment: "ประเมินเพื่อทดสอบ",
          plan: "แผนเพื่อทดสอบ",
          diagnoses: ["การวินิจฉัยเพื่อทดสอบ"],
        },
        medicationDecision: { kind: "NO_MEDICATION", noMedicationReason: "ไม่มีข้อบ่งใช้ยา" },
      },
    },
  });
  expect(draft.statusCode).toBe(200);

  const finalized = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/finalize-consultation`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${key}-finalize` },
    payload: { expectedRevisions: { visit: 2, patient: 1, noteDraft: 1, medicationDraft: 1 }, payload: {} },
  });
  expect(finalized.statusCode).toBe(200);

  const charge = await test.app.inject({
    method: "POST",
    url: `/api/checkout/${visitId}/charge-finalizations`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${key}-charge` },
    payload: {
      expectedRevisions: { visit: 3, clinicPricing: 1 },
      payload: { settlementIntent: "FULL_WAIVER", waiverReason: "ปิด Visit เพื่อทดสอบ" },
    },
  });
  expect(charge.statusCode).toBe(201);
  if (charge.statusCode !== 201) return;
  const checkout = charge.json().data as {
    charge: { id: string } | null;
    resolution?: { kind: string; adjustmentId?: string };
    visit: { revision: number };
  };
  if (!checkout.charge || checkout.resolution?.kind !== "COLLECTION_NOT_REQUIRED" || !checkout.resolution.adjustmentId) {
    throw new Error("Unable to obtain a Closure-valid waiver fixture");
  }
  const closed = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/close`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${key}-close` },
    payload: {
      expectedRevisions: { visit: checkout.visit.revision },
      payload: {
        chargeId: checkout.charge.id,
        resolution: { kind: "COLLECTION_NOT_REQUIRED", waiverAdjustmentId: checkout.resolution.adjustmentId },
      },
    },
  });
  expect(closed.statusCode).toBe(201);
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
      allergy: { state: "UNKNOWN", id: null, revision: 0 },
      allowedActions: ["REVIEW_ALLERGY"],
    });
    expect(doctorQueue.json().data[0]).toMatchObject({
      visit: { id: visitId, status: "WAITING", revision: 1 },
      allergy: { state: "UNKNOWN", id: null, revision: 0 },
      allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"],
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
    expect(started.json()).toMatchObject({
      replayed: false,
      data: {
        visit: {
          status: "CONSULTING",
          revision: 2,
          startedAt: "2026-08-03T00:00:00.000Z",
        },
      },
    });
    expect(started.json().data.allowedActions).toEqual(["OPEN_CONSULTATION"]);

    const replay = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "start-visit-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ data: started.json().data, replayed: true });

    const assistantAfterStart = await test.app.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: test.assistantCookie },
    });
    expect(assistantAfterStart.json().data[0]).toMatchObject({
      visit: { id: visitId, status: "CONSULTING", revision: 2 },
      allowedActions: [],
    });
    const assistantDirectAfterStart = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "assistant-start-after-001" },
      payload: { expectedRevisions: { visit: 2 }, payload: {} },
    });
    expect(assistantDirectAfterStart.statusCode).toBe(403);

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

  it("does not replay a Start Consultation key for a different Visit target", async () => {
    const test = await fixture();
    const firstPatient = await createPatient(test.app, test.assistantCookie, "patient-for-visit-a");
    const secondPatient = await createPatient(test.app, test.assistantCookie, "patient-for-visit-b");
    const first = await submitIntake(
      test.app,
      test.assistantCookie,
      firstPatient.json().data.id,
      "visit-intake-a",
    );
    const second = await submitIntake(
      test.app,
      test.assistantCookie,
      secondPatient.json().data.id,
      "visit-intake-b",
    );
    const firstVisitId = first.json().data.visit.id as string;
    const secondVisitId = second.json().data.visit.id as string;

    const firstStart = await test.app.inject({
      method: "POST",
      url: `/api/visits/${firstVisitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "start-same-key-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    const secondStart = await test.app.inject({
      method: "POST",
      url: `/api/visits/${secondVisitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "start-same-key-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });

    expect(firstStart.statusCode).toBe(200);
    expect(secondStart.statusCode).toBe(409);
    expect(secondStart.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      test.database.sqlite
        .prepare("SELECT status, revision FROM visits WHERE id = ?")
        .get(secondVisitId),
    ).toEqual({ status: "WAITING", revision: 1 });
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

  it("returns field-specific validation errors for every vital bound and oversized complaint", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const patientId = patient.json().data.id as string;
    const validVitals: IntakePayload["vitals"] = {
      weightKg: 60,
      heightCm: 165,
      temperatureC: 37.5,
      systolicMmhg: 120,
      diastolicMmhg: 80,
      heartRateBpm: 80,
      spo2Percent: 98,
    };
    const invalidVitals = [
      ["weightKg", 0],
      ["weightKg", 351],
      ["heightCm", 29],
      ["heightCm", 251],
      ["temperatureC", 29],
      ["temperatureC", 46],
      ["systolicMmhg", 49],
      ["systolicMmhg", 261],
      ["diastolicMmhg", 29],
      ["diastolicMmhg", 181],
      ["heartRateBpm", 19],
      ["heartRateBpm", 251],
      ["spo2Percent", 49],
      ["spo2Percent", 101],
    ] as const;

    for (const [field, value] of invalidVitals) {
      const vitals = { ...validVitals, [field]: value } as IntakePayload["vitals"];
      const response = await submitIntake(
        test.app,
        test.assistantCookie,
        patientId,
        `invalid-vital-${field}-${value}`,
        "ไอ",
        vitals,
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().error.fieldErrors).toHaveProperty(`payload.vitals.${field}`);
    }

    const relationError = await submitIntake(
      test.app,
      test.assistantCookie,
      patientId,
      "invalid-vital-relation",
      "ไอ",
      { ...validVitals, systolicMmhg: 70, diastolicMmhg: 80 },
    );
    expect(relationError.statusCode).toBe(422);
    expect(relationError.json().error.fieldErrors).toHaveProperty("payload.vitals.systolicMmhg");

    const oversized = await submitIntake(
      test.app,
      test.assistantCookie,
      patientId,
      "invalid-complaint-001",
      "😀".repeat(501),
      validVitals,
    );
    expect(oversized.statusCode).toBe(422);
    expect(oversized.json().error.fieldErrors).toHaveProperty("payload.chiefComplaint");
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

  it("enforces the partial active-Visit index while allowing a closed Visit to be replaced", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const patientId = patient.json().data.id as string;
    const first = await submitIntake(test.app, test.assistantCookie, patientId, "active-index-first");
    const duplicate = await submitIntake(test.app, test.assistantCookie, patientId, "active-index-duplicate");
    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACTIVE_VISIT_EXISTS");

    const firstVisitId = first.json().data.visit.id as string;
    await closeNoMedicationVisit(test, firstVisitId, "active-index-close");
    const replacement = await submitIntake(test.app, test.assistantCookie, patientId, "active-index-replacement");
    expect(replacement.statusCode).toBe(201);
    expect(test.database.db.select().from(visits).all()).toHaveLength(2);
  });

  it("serializes concurrent Intake attempts to one active Visit", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const patientId = patient.json().data.id as string;
    const responses = await Promise.all([
      submitIntake(test.app, test.assistantCookie, patientId, "concurrent-intake-a"),
      submitIntake(test.app, test.assistantCookie, patientId, "concurrent-intake-b"),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.statusCode === 409)?.json().error.code).toBe(
      "ACTIVE_VISIT_EXISTS",
    );
    expect(test.database.db.select().from(visits).all()).toHaveLength(1);
    expect(test.database.db.select().from(intakeObservations).all()).toHaveLength(1);
  });

  it("orders Queue by state first and arrival time second", async () => {
    const test = await fixture();
    const created: string[] = [];
    for (const suffix of ["old", "new", "consulting", "order-revision", "preparation", "charge"]) {
      const patient = await createPatient(test.app, test.assistantCookie, `queue-patient-${suffix}`);
      const visit = await submitIntake(
        test.app,
        test.assistantCookie,
        patient.json().data.id,
        `queue-visit-${suffix}`,
      );
      created.push(visit.json().data.visit.id as string);
    }
    test.database.sqlite
      .prepare("UPDATE visits SET arrived_at = ? WHERE id = ?")
      .run("2026-08-03T00:03:00.000Z", created[0]);
    test.database.sqlite
      .prepare("UPDATE visits SET arrived_at = ? WHERE id = ?")
      .run("2026-08-03T00:02:00.000Z", created[1]);
    test.database.sqlite
      .prepare("UPDATE visits SET status = 'CONSULTING', started_at = ?, arrived_at = ? WHERE id = ?")
      .run("2026-08-03T00:01:00.000Z", "2026-08-03T00:01:00.000Z", created[2]);
    for (const [index, status] of ["AWAITING_ORDER_REVISION", "AWAITING_PREPARATION", "AWAITING_CHARGE"].entries()) {
      test.database.sqlite
        .prepare("UPDATE visits SET status = ?, arrived_at = ? WHERE id = ?")
        .run(status, `2026-08-03T00:0${index}:30.000Z`, created[index + 3]);
    }

    const queue = await test.app.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: test.assistantCookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.map((item: { visit: { id: string } }) => item.visit.id)).toEqual([
      created[1],
      created[0],
      created[2],
      created[3],
      created[4],
      created[5],
    ]);
  });

  it("counts only the current Bangkok clinic day in Dashboard", async () => {
    const test = await fixture();
    const created: string[] = [];
    for (const suffix of ["before", "start", "inside", "end"]) {
      const patient = await createPatient(test.app, test.assistantCookie, `dashboard-patient-${suffix}`);
      const visit = await submitIntake(
        test.app,
        test.assistantCookie,
        patient.json().data.id,
        `dashboard-visit-${suffix}`,
      );
      created.push(visit.json().data.visit.id as string);
    }
    const arrivalTimes = [
      "2026-08-02T16:59:59.999Z",
      "2026-08-02T17:00:00.000Z",
      "2026-08-03T16:59:59.999Z",
      "2026-08-03T17:00:00.000Z",
    ];
    for (const [index, id] of created.entries()) {
      test.database.sqlite
        .prepare("UPDATE visits SET arrived_at = ? WHERE id = ?")
        .run(arrivalTimes[index], id);
    }
    test.database.sqlite
      .prepare("UPDATE visits SET status = 'CONSULTING', started_at = ? WHERE id = ?")
      .run("2026-08-03T00:00:00.000Z", created[2]);

    const dashboard = await test.app.inject({
      method: "GET",
      url: "/api/dashboard/today",
      headers: { cookie: test.assistantCookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toEqual({
      data: {
        waiting: 1,
        consulting: 1,
        awaitingOrderRevision: 0,
        awaitingPreparation: 0,
        preparing: 0,
        awaitingRelease: 0,
        awaitingHandoff: 0,
        awaitingCharge: 0,
        awaitingPayment: 0,
        readyToClose: 0,
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
    });
  });

  it("counts each committed pending state and excludes closed Visits from Dashboard", async () => {
    const test = await fixture();
    const statuses = ["WAITING", "CONSULTING", "AWAITING_ORDER_REVISION", "AWAITING_PREPARATION", "PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF", "AWAITING_CHARGE", "AWAITING_PAYMENT", "READY_TO_CLOSE"];
    for (const [index, status] of statuses.entries()) {
      const patient = await createPatient(test.app, test.assistantCookie, `dashboard-state-patient-${status}`);
      const created = await submitIntake(
        test.app, test.assistantCookie, patient.json().data.id, `dashboard-state-visit-${status}`,
      );
      test.database.sqlite.prepare("UPDATE visits SET status = ?, arrived_at = ? WHERE id = ?").run(
        status, `2026-08-03T0${index}:00:00.000Z`, created.json().data.visit.id,
      );
    }
    const closedPatient = await createPatient(test.app, test.assistantCookie, "dashboard-state-patient-CLOSED");
    const closed = await submitIntake(
      test.app, test.assistantCookie, closedPatient.json().data.id, "dashboard-state-visit-CLOSED",
    );
    await closeNoMedicationVisit(test, closed.json().data.visit.id, "dashboard-state-close");
    const dashboard = await test.app.inject({
      method: "GET", url: "/api/dashboard/today", headers: { cookie: test.assistantCookie },
    });
    expect(dashboard.json().data).toMatchObject({
      waiting: 1, consulting: 1, awaitingOrderRevision: 1, awaitingPreparation: 1, preparing: 1, awaitingRelease: 1, awaitingHandoff: 1, awaitingCharge: 1, awaitingPayment: 1, readyToClose: 1,
    });
  });

  it("keeps finance states in the active queue without granting a clinical-open action", async () => {
    const test = await fixture();
    const paymentPatient = await createPatient(test.app, test.assistantCookie, "finance-queue-payment-patient");
    const readyPatient = await createPatient(test.app, test.assistantCookie, "finance-queue-ready-patient");
    const closedPatient = await createPatient(test.app, test.assistantCookie, "finance-queue-closed-patient");
    const paymentVisit = await submitIntake(test.app, test.assistantCookie, paymentPatient.json().data.id, "finance-queue-payment-visit");
    const readyVisit = await submitIntake(test.app, test.assistantCookie, readyPatient.json().data.id, "finance-queue-ready-visit");
    const closedVisit = await submitIntake(test.app, test.assistantCookie, closedPatient.json().data.id, "finance-queue-closed-visit");
    const paymentVisitId = paymentVisit.json().data.visit.id as string;
    const readyVisitId = readyVisit.json().data.visit.id as string;
    const closedVisitId = closedVisit.json().data.visit.id as string;
    test.database.sqlite.prepare("UPDATE visits SET status = 'AWAITING_PAYMENT', revision = 8 WHERE id = ?").run(paymentVisitId);
    test.database.sqlite.prepare("UPDATE visits SET status = 'READY_TO_CLOSE', revision = 9 WHERE id = ?").run(readyVisitId);
    await closeNoMedicationVisit(test, closedVisitId, "finance-queue-close");

    const doctorQueue = await test.app.inject({ method: "GET", url: "/api/queue", headers: { cookie: test.doctorCookie } });
    expect(doctorQueue.statusCode).toBe(200);
    const rows = doctorQueue.json().data as Array<{ visit: { id: string; status: string }; allowedActions: string[] }>;
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ visit: expect.objectContaining({ id: paymentVisitId, status: "AWAITING_PAYMENT" }), allowedActions: [] }),
      expect.objectContaining({ visit: expect.objectContaining({ id: readyVisitId, status: "READY_TO_CLOSE" }), allowedActions: [] }),
    ]));
    expect(rows.map((row) => row.visit.id)).not.toContain(closedVisitId);
    expect(rows.some((row) => row.allowedActions.includes("OPEN_CONSULTATION"))).toBe(false);
  });

  it("returns a committed Workspace aggregate and a stable 404 for unknown Visits", async () => {
    const test = await fixture();
    const patient = await createPatient(test.app, test.assistantCookie);
    const created = await submitIntake(test.app, test.assistantCookie, patient.json().data.id);
    const visitId = created.json().data.visit.id as string;

    const workspace = await test.app.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: test.doctorCookie },
    });
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json().data).toMatchObject({
      visit: { id: visitId, status: "WAITING", revision: 1 },
      patient: { id: patient.json().data.id, hn: patient.json().data.hn },
      intake: {
        chiefComplaint: "ไอและมีไข้",
        recordedBy: { id: test.assistant.actor.id, displayName: test.assistant.actor.displayName },
      },
      patientSnapshot: {
        allergy: { state: "UNKNOWN", id: null, revision: 0 },
        activeProblems: { state: "UNKNOWN", value: null, source: null },
        currentMedicationContext: { state: "UNKNOWN", value: null, source: null },
        latestRelevantPlan: { state: "UNKNOWN", value: null, source: null },
        pendingFollowUp: { state: "UNKNOWN", value: null, source: null },
        recentVisits: [],
      },
      consultationDraft: { note: null, medicationDecision: null },
      signedClinicalNote: null,
      amendments: [],
      medicationDecision: null,
      allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"],
    });
    const assistantWorkspace = await test.app.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: test.assistantCookie },
    });
    expect(assistantWorkspace.statusCode).toBe(403);
    expect(assistantWorkspace.json().error.code).toBe("FORBIDDEN");
    const unknown = await test.app.inject({
      method: "GET",
      url: "/api/visits/unknown-visit/workspace",
      headers: { cookie: test.doctorCookie },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("NOT_FOUND");
  });
});
