import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createPatientService, patientAllergyItems, patientAllergyRevisions } from "../../src/server/modules/patient/index.js";
import { createMedicationService } from "../../src/server/modules/medication/index.js";
import { createNoteService } from "../../src/server/modules/note/index.js";
import { auditEvents, executeIdempotent, idempotencyRecords } from "../../src/server/modules/platform/index.js";
import { createVisitService, visits } from "../../src/server/modules/visit/index.js";
import { createClinicalWorkflow } from "../../src/server/workflows/clinical.js";
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
    id: "allergy-assistant-001",
    username: "allergy-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยทดสอบ",
    mustChangePassword: false,
  });
  const doctor = await seedAccount(app.database, {
    id: "allergy-doctor-001",
    username: "allergy-doctor",
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

async function createPatientAndVisit(test: Awaited<ReturnType<typeof fixture>>) {
  const patientResponse = await test.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie: test.assistantCookie, "idempotency-key": "allergy-patient-001" },
    payload: { expectedRevisions: {}, payload: {} },
  });
  const patientId = patientResponse.json().data.id as string;
  const intakeResponse = await test.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie: test.assistantCookie, "idempotency-key": "allergy-intake-001" },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId,
        chiefComplaint: "อาการทดสอบ",
        vitals: {
          weightKg: null,
          heightCm: null,
          temperatureC: null,
          systolicMmhg: null,
          diastolicMmhg: null,
          heartRateBpm: null,
          spo2Percent: null,
        },
      },
    },
  });
  return { patientId, visitId: intakeResponse.json().data.visit.id as string };
}

function review(
  test: Awaited<ReturnType<typeof fixture>>,
  input: {
    patientId: string;
    visitId: string;
    patientRevision?: number;
    visitRevision?: number;
    state?: "UNKNOWN" | "NONE_KNOWN" | "PRESENT";
    items?: Array<{ substance: string; reaction: string; severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE"; note: string | null }>;
    sourceText?: string;
    reason?: string;
    cookie?: string;
    key?: string;
  },
) {
  return test.app.inject({
    method: "POST",
    url: `/api/patients/${input.patientId}/allergy-revisions`,
    headers: {
      cookie: input.cookie ?? test.assistantCookie,
      "idempotency-key": input.key ?? "allergy-review-001",
    },
    payload: {
      expectedRevisions: { patient: input.patientRevision ?? 1, visit: input.visitRevision ?? 1 },
      payload: {
        visitId: input.visitId,
        state: input.state ?? "NONE_KNOWN",
        items: input.items ?? [],
        sourceText: input.sourceText ?? "คำให้การผู้ป่วยทดสอบ",
        reason: input.reason ?? "ทบทวนก่อนตรวจ",
      },
    },
  });
}

function prepareAwaitingPreparationOrder(test: Awaited<ReturnType<typeof fixture>>, visitId: string) {
  test.database.sqlite.prepare("UPDATE visits SET status='AWAITING_PREPARATION' WHERE id=?").run(visitId);
  test.database.sqlite.prepare(
    "INSERT INTO medication_decisions (id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id, signed_by, signed_by_display_name, signed_at, content_hash) VALUES (?, ?, 1, 'ORDER', NULL, NULL, NULL, ?, ?, ?, ?)",
  ).run("allergy-safety-order-001", visitId, test.doctor.actor.id, test.doctor.actor.displayName, "2026-08-03T00:00:00.000Z", "a".repeat(64));
}

describe("versioned allergy review", () => {
  it("appends NONE_KNOWN without coercing the initial UNKNOWN", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const patients = createPatientService({ database: test.database });

    expect(patients.getAllergyAssessment(patientId)).toMatchObject({
      id: null,
      revision: 0,
      state: "UNKNOWN",
      items: [],
      sourceText: null,
      reason: null,
      reviewedBy: null,
      reviewedAt: null,
    });

    const response = await review(test, { patientId, visitId });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      patient: { revision: 2 },
      allergy: { revision: 1, state: "NONE_KNOWN", items: [] },
      visit: { id: visitId, status: "WAITING", revision: 1 },
    });
    expect(patients.getAllergyAssessment(patientId)).toMatchObject({
      revision: 1,
      state: "NONE_KNOWN",
      reviewedBy: { id: test.assistant.actor.id, displayName: "ผู้ช่วยทดสอบ" },
    });

    const reviewedUnknown = await review(test, {
      patientId,
      visitId,
      patientRevision: 2,
      state: "UNKNOWN",
      items: [],
      sourceText: "ยังไม่สามารถยืนยันข้อมูลได้",
      reason: "ทบทวนข้อมูลไม่ครบ",
      key: "allergy-review-unknown-001",
    });
    expect(reviewedUnknown.statusCode).toBe(201);
    expect(reviewedUnknown.json().data).toMatchObject({
      patient: { revision: 3 },
      allergy: { revision: 2, state: "UNKNOWN", items: [] },
    });
  });

  it("appends PRESENT items while preserving the byte-stable earlier revision", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const first = await review(test, { patientId, visitId });
    expect(first.statusCode).toBe(201);
    const before = test.database.sqlite
      .prepare("SELECT id, patient_id, revision, state, source_text, reason, reviewed_by, reviewed_at FROM patient_allergy_revisions WHERE patient_id = ?")
      .get(patientId);

    const second = await review(test, {
      patientId,
      visitId,
      patientRevision: 2,
      state: "PRESENT",
      items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: "ติดตามอาการ" }],
      sourceText: "ทบทวนข้อมูลยาแพ้",
      reason: "แก้ไขข้อมูลก่อนตรวจ",
      key: "allergy-review-002",
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().data).toMatchObject({
      patient: { revision: 3 },
      allergy: {
        revision: 2,
        state: "PRESENT",
        items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: "ติดตามอาการ" }],
      },
    });
    expect(test.database.sqlite
      .prepare("SELECT id, patient_id, revision, state, source_text, reason, reviewed_by, reviewed_at FROM patient_allergy_revisions WHERE patient_id = ? AND revision = 1")
      .get(patientId)).toEqual(before);
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(2);
    expect(test.database.db.select().from(patientAllergyItems).all()).toHaveLength(1);
  });

  it("rejects state-item mismatches before a write", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const response = await review(test, {
      patientId,
      visitId,
      state: "NONE_KNOWN",
      items: [{ substance: "ยา", reaction: "ผื่น", severity: "MILD", note: null }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toEqual([]);
  });

  it("replays identical commands and rejects an idempotency collision", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const input = {
      patientId,
      visitId,
      state: "PRESENT" as const,
      items: [{ substance: "ยาทดสอบสำหรับรีเพลย์", reaction: "ผื่นสำหรับรีเพลย์", severity: "MILD" as const, note: "ติดตามสำหรับรีเพลย์" }],
      sourceText: "ข้อมูลต้นทางสำหรับรีเพลย์",
      reason: "เหตุผลสำหรับรีเพลย์",
    };
    const first = await review(test, input);
    const replay = await review(test, input);
    const collision = await review(test, {
      patientId,
      visitId,
      sourceText: "ข้อความอื่น",
    });

    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(1);
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.actorId === test.assistant.actor.id && record.key === "allergy-review-001");
    expect(stored?.responseJson).not.toContain(input.sourceText);
    expect(stored?.responseJson).not.toContain(input.reason);
    expect(stored?.responseJson).not.toContain(input.items[0].substance);
    expect(stored?.responseJson).not.toContain(input.items[0].reaction);
    expect(stored?.responseJson).not.toContain(input.items[0].note ?? "");
  });

  it("redacts a matching legacy allergy envelope before rebuilding its replay", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const key = "allergy-legacy-replay-001";
    const input = {
      patientId,
      visitId,
      state: "PRESENT" as const,
      items: [{ substance: "ยาเก่าสำหรับรีเพลย์", reaction: "ผื่นเก่าสำหรับรีเพลย์", severity: "MILD" as const, note: "บันทึกเก่าสำหรับรีเพลย์" }],
      sourceText: "ข้อมูลเก่าสำหรับรีเพลย์",
      reason: "เหตุผลเก่าสำหรับรีเพลย์",
      key,
    };
    const first = await review(test, input);
    test.database.sqlite.prepare(
      "UPDATE idempotency_records SET response_json=? WHERE actor_id=? AND key=?",
    ).run(JSON.stringify({ data: first.json().data, replayed: false }), test.assistant.actor.id, key);

    const replay = await review(test, input);
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.actorId === test.assistant.actor.id && record.key === key);

    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(stored?.responseJson).not.toContain(input.sourceText);
    expect(stored?.responseJson).not.toContain(input.reason);
    expect(stored?.responseJson).not.toContain(input.items[0].substance);
    expect(JSON.parse(stored?.responseJson ?? "{}")).toMatchObject({ type: "safe-replay-reference" });
  });

  it("rejects stale patient and visit revisions with no appended revision", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    expect((await review(test, { patientId, visitId })).statusCode).toBe(201);

    const stalePatient = await review(test, {
      patientId,
      visitId,
      patientRevision: 1,
      key: "allergy-stale-patient",
    });
    const staleVisit = await review(test, {
      patientId,
      visitId,
      patientRevision: 2,
      visitRevision: 99,
      key: "allergy-stale-visit-001",
    });

    expect(stalePatient.statusCode).toBe(409);
    expect(stalePatient.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { patient: 2 } });
    expect(staleVisit.statusCode).toBe(409);
    expect(staleVisit.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { visit: 1 } });
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(1);
  });

  it("stores a required reason without clinical prose in allergy audit metadata", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const sourceText = "คำให้การข้อมูลยาแพ้เฉพาะราย";
    const reason = "ทบทวนก่อนตรวจเฉพาะราย";
    const response = await review(test, { patientId, visitId, sourceText, reason });

    expect(response.statusCode).toBe(201);
    const event = test.database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "allergy.updated"))
      .get();
    expect(event).toMatchObject({
      action: "allergy.updated",
      entityType: "patient",
      entityId: patientId,
      entityRevision: 2,
      reason,
    });
    const metadata = JSON.parse(event?.metadataJson ?? "{}");
    expect(metadata).toMatchObject({
      visitId,
      allergyRevisionId: expect.any(String),
      allergyRevision: 1,
      state: "NONE_KNOWN",
      itemCount: 0,
    });
    expect(event?.metadataJson).not.toContain(sourceText);
    expect(event?.metadataJson).not.toContain(reason);
  });

  it("permits Assistant only in WAITING and Doctor in WAITING or CONSULTING", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    expect((await review(test, {
      patientId,
      visitId,
      cookie: test.doctorCookie,
      key: "allergy-doctor-waiting",
    })).statusCode).toBe(201);

    const start = await test.app.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "allergy-role-start-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(start.statusCode).toBe(200);

    const assistantConsulting = await review(test, {
      patientId,
      visitId,
      patientRevision: 2,
      visitRevision: 2,
      key: "allergy-assistant-consulting",
    });
    const doctorConsulting = await review(test, {
      patientId,
      visitId,
      patientRevision: 2,
      visitRevision: 2,
      cookie: test.doctorCookie,
      key: "allergy-doctor-consulting",
    });

    expect(assistantConsulting.statusCode).toBe(409);
    expect(assistantConsulting.json().error.code).toBe("INVALID_STATE");
    expect(doctorConsulting.statusCode).toBe(201);
  });

  it("does not append an allergy revision when Start wins the WAITING race", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    const [started, staleReview] = await Promise.all([
      test.app.inject({
        method: "POST",
        url: `/api/visits/${visitId}/start-consultation`,
        headers: { cookie: test.doctorCookie, "idempotency-key": "allergy-race-start-001" },
        payload: { expectedRevisions: { visit: 1 }, payload: {} },
      }),
      review(test, {
        patientId,
        visitId,
        cookie: test.assistantCookie,
        key: "allergy-race-review-001",
      }),
    ]);

    expect(started.statusCode).toBe(200);
    expect(staleReview.statusCode).toBe(409);
    expect(staleReview.json().error.code).toMatch(/REVISION_CONFLICT|INVALID_STATE/);
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toEqual([]);
    expect(test.database.db.select().from(visits).get()).toMatchObject({ status: "CONSULTING", revision: 2 });
  });

  it("uses Doctor allergy review to atomically send a prepared ORDER to order revision", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    prepareAwaitingPreparationOrder(test, visitId);

    const response = await review(test, {
      patientId,
      visitId,
      cookie: test.doctorCookie,
      state: "PRESENT",
      items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }],
      sourceText: "พบประวัติแพ้ระหว่างเตรียมยา",
      reason: "หยุดทบทวนคำสั่งยา",
      key: "allergy-safety-transition-001",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ patient: { revision: 2 }, allergy: { revision: 1 }, visit: {
      status: "AWAITING_ORDER_REVISION", revision: 2,
    } });
    expect(test.database.db.select().from(auditEvents).all().find((event) => event.action === "visit.allergy-safety-changed"))
      .toMatchObject({ reason: "หยุดทบทวนคำสั่งยา" });
  });

  it("denies Assistant and AWAITING_CHARGE allergy safety transitions without an append", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    prepareAwaitingPreparationOrder(test, visitId);
    const assistant = await review(test, { patientId, visitId, cookie: test.assistantCookie, key: "allergy-safety-assistant" });
    test.database.sqlite.prepare("UPDATE visits SET status='AWAITING_CHARGE' WHERE id=?").run(visitId);
    const charge = await review(test, { patientId, visitId, cookie: test.doctorCookie, key: "allergy-safety-charge" });

    expect(assistant.json().error.code).toBe("INVALID_STATE");
    expect(charge.json().error.code).toBe("INVALID_STATE");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toEqual([]);
  });

  it("rolls back the allergy append and audits when the safety transition fails", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createPatientAndVisit(test);
    prepareAwaitingPreparationOrder(test, visitId);
    const patients = createPatientService({ database: test.database });
    const workflow = createClinicalWorkflow({
      patients,
      visits: createVisitService({ database: test.database, patients }),
      notes: createNoteService({ database: test.database }),
      medications: createMedicationService({ database: test.database }),
      beforeAllergySafetyTransition: () => { throw new Error("injected allergy safety failure"); },
    });
    const body = {
      expectedRevisions: { patient: 1, visit: 1 },
      payload: { visitId, state: "NONE_KNOWN" as const, items: [], sourceText: "ทบทวน", reason: "ความปลอดภัย" },
    };

    expect(() => executeIdempotent({
      db: test.database.db,
      actor: test.doctor.actor,
      key: "allergy-safety-rollback",
      operation: "patient.review-allergy.v1",
      scope: patientId,
      requestBody: body,
      work: (tx) => ({ statusCode: 201, data: workflow.reviewAllergy(tx, test.doctor.actor, patientId, body) }),
    })).toThrow("injected allergy safety failure");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toEqual([]);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => (
      event.action === "allergy.updated" || event.action === "visit.allergy-safety-changed"
    ))).toEqual([]);
    expect(test.database.db.select().from(visits).where(eq(visits.id, visitId)).get())
      .toMatchObject({ status: "AWAITING_PREPARATION", revision: 1 });
  });
});
