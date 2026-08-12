import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createMedicationService,
  medicationDecisions,
  medicationDecisionDrafts,
  medicationOrderDraftItems,
  medicationOrderItems,
  type MedicationService,
} from "../../src/server/modules/medication/index.js";
import { clinicalNoteAmendments, clinicalNoteDiagnoses, clinicalNoteDrafts, clinicalNotes, createNoteService } from "../../src/server/modules/note/index.js";
import { createPatientService } from "../../src/server/modules/patient/index.js";
import { createFulfillmentService, fulfillmentLabelVersions } from "../../src/server/modules/fulfillment/index.js";
import { createInventoryService, inventoryReservationAllocations, inventoryReservations } from "../../src/server/modules/inventory/index.js";
import { auditEvents, executeIdempotent, hashEvidence, idempotencyRecords } from "../../src/server/modules/platform/index.js";
import { visits } from "../../src/server/modules/visit/index.js";
import { createVisitService } from "../../src/server/modules/visit/index.js";
import { createClinicalWorkflow } from "../../src/server/workflows/clinical.js";
import type { SaveConsultationDraftBody } from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const test = await createTestApp();
  cleanups.push(test.cleanup);
  const assistant = await seedAccount(test.database, {
    id: "assistant-001",
    username: "assistant",
    role: "assistant",
    displayName: "ผู้ช่วยทดสอบ",
    mustChangePassword: false,
  });
  const doctor = await seedAccount(test.database, {
    id: "doctor-001",
    username: "doctor",
    role: "doctor",
    displayName: "พญ. ทดสอบ",
    mustChangePassword: false,
  });
  return {
    ...test,
    assistant,
    doctor,
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
  };
}

function fulfillmentDependencies(test: Awaited<ReturnType<typeof fixture>>, medications: MedicationService) {
  const inventory = createInventoryService({ database: test.database, medicationService: medications });
  return { inventory, fulfillment: createFulfillmentService({ database: test.database, inventory }) };
}

async function createConsultingVisit(test: Awaited<ReturnType<typeof fixture>>) {
  const patient = await test.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-patient-001" },
    payload: { expectedRevisions: {}, payload: {} },
  });
  const intake = await test.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-intake-001" },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId: patient.json().data.id,
        chiefComplaint: "ไอและมีไข้",
        vitals: {
          weightKg: 60, heightCm: 165, temperatureC: 37.5, systolicMmhg: 120,
          diastolicMmhg: 80, heartRateBpm: 80, spo2Percent: 98,
        },
        allergy: { answer: "NO", items: [], changeReason: null },
      },
    },
  });
  const visitId = intake.json().data.visit.id as string;
  const started = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/start-consultation`,
    headers: { cookie: test.doctorCookie, "idempotency-key": "clinical-start-001" },
    payload: { expectedRevisions: { visit: 1 }, payload: {} },
  });
  expect(started.statusCode).toBe(200);
  return visitId;
}

async function createLegacyUnknownConsultingVisit(test: Awaited<ReturnType<typeof fixture>>) {
  const patient = await test.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-legacy-unknown-patient" },
    payload: { expectedRevisions: {}, payload: {} },
  });
  expect(patient.statusCode).toBe(201);
  const patientId = patient.json().data.id as string;
  const visitId = "clinical-legacy-unknown-visit";
  const observationId = "clinical-legacy-unknown-observation";
  const now = "2026-08-03T00:00:00.000Z";
  test.database.sqlite.prepare(
    "INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, closed_at, created_by) VALUES (?, 'clinic', ?, 'WAITING', 'อาการเดิม', 1, ?, NULL, NULL, ?)",
  ).run(visitId, patientId, now, test.assistant.actor.id);
  test.database.sqlite.prepare(
    "INSERT INTO intake_observations (id, visit_id, weight_kg, height_cm, temperature_c, systolic_mmhg, diastolic_mmhg, heart_rate_bpm, spo2_percent, recorded_by, recorded_at) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)",
  ).run(observationId, visitId, test.assistant.actor.id, now);
  const started = await test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/start-consultation`,
    headers: { cookie: test.doctorCookie, "idempotency-key": "clinical-legacy-unknown-start" },
    payload: { expectedRevisions: { visit: 1 }, payload: {} },
  });
  expect(started.statusCode).toBe(200);
  return { patientId, visitId };
}

function draftBody(): SaveConsultationDraftBody {
  return {
    expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
    payload: {
      note: {
        subjective: "อาการทดสอบ", objective: "ผลตรวจทดสอบ", assessment: "ประเมินทดสอบ",
        plan: "แผนทดสอบ", diagnoses: ["การวินิจฉัยทดสอบ"],
      },
      medicationDecision: {
        kind: "ORDER",
        items: [{
          medicationId: "DEMO-MED-001", medicationRevision: 1, quantity: 10,
          directionsTh: "คำแนะนำทดสอบ",
        }],
      },
    },
  };
}

async function saveDraft(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  body: unknown = draftBody(),
  key = "clinical-draft-001",
  cookie = test.doctorCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/consultation-draft`,
    headers: { cookie, "idempotency-key": key },
    payload: body as Record<string, unknown>,
  });
}

describe("consultation draft workflow", () => {
  it("saves Note and ORDER draft without changing Visit", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const response = await saveDraft(test, visitId);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      note: { revision: 1, updatedBy: { id: "doctor-001", displayName: "พญ. ทดสอบ" } },
      medicationDecision: {
        revision: 1,
        kind: "ORDER",
        updatedBy: { id: "doctor-001", displayName: "พญ. ทดสอบ" },
        items: [{ medication: { id: "DEMO-MED-001", revision: 1 }, quantity: 10, directionsTh: "คำแนะนำทดสอบ" }],
      },
    });
    expect(test.database.db.select().from(visits).where(eq(visits.id, visitId)).get())
      .toMatchObject({ status: "CONSULTING", revision: 2 });
    const draftAudits = test.database.db.select().from(auditEvents).all()
      .filter((event) => event.action === "note.draft-saved");
    expect(draftAudits).toHaveLength(1);
    expect(JSON.parse(draftAudits[0]?.metadataJson ?? "{}")).toEqual({});
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
  });

  it("replaces both draft children and accepts incomplete draft updates", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveDraft(test, visitId);
    const response = await saveDraft(test, visitId, {
      expectedRevisions: { visit: 2, noteDraft: 1, medicationDraft: 1 },
      payload: {
        note: { subjective: "", objective: "", assessment: "", plan: "", diagnoses: [] },
        medicationDecision: { kind: "NO_MEDICATION", noMedicationReason: "" },
      },
    }, "clinical-draft-002");

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      note: { revision: 2, diagnoses: [] },
      medicationDecision: { revision: 2, kind: "NO_MEDICATION", noMedicationReason: "", items: [] },
    });
    expect(test.database.db.select().from(medicationOrderDraftItems).all()).toHaveLength(0);
  });

  it.each([
    ["Visit", { visit: 1, noteDraft: 1, medicationDraft: 1 }, "visit", 2],
    ["Note", { visit: 2, noteDraft: 0, medicationDraft: 1 }, "noteDraft", 1],
    ["Medication", { visit: 2, noteDraft: 1, medicationDraft: 0 }, "medicationDraft", 1],
  ])("rejects a stale %s revision before persisting a partial draft", async (_name, revisions, key, current) => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveDraft(test, visitId);
    const body = draftBody();
    body.expectedRevisions = revisions;
    const response = await saveDraft(test, visitId, body, `clinical-stale-${key}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { [key]: current } });
    expect(test.database.db.select().from(clinicalNoteDrafts).all()).toMatchObject([{ revision: 1 }]);
    expect(test.database.db.select().from(medicationDecisionDrafts).all()).toMatchObject([{ revision: 1 }]);
  });

  it("rejects stale and inactive catalog revisions without persisting a Note draft", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    test.database.sqlite.prepare("UPDATE medications SET revision=2 WHERE id='DEMO-MED-001'").run();
    const stale = await saveDraft(test, visitId, draftBody(), "clinical-catalog-stale");
    test.database.sqlite.prepare("UPDATE medications SET revision=1, active=0 WHERE id='DEMO-MED-001'").run();
    const inactive = await saveDraft(test, visitId, draftBody(), "clinical-catalog-inactive");

    expect(stale.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { "medication.DEMO-MED-001": 2 } });
    expect(inactive.json().error.code).toBe("NOT_FOUND");
    expect(test.database.db.select().from(clinicalNoteDrafts).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisionDrafts).all()).toHaveLength(0);
  });

  it("replays a completed draft command and rejects its changed-body collision", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const first = await saveDraft(test, visitId);
    const replay = await saveDraft(test, visitId);
    const collisionBody = draftBody();
    collisionBody.payload.note.subjective = "เปลี่ยนข้อความ";
    const collision = await saveDraft(test, visitId, collisionBody);

    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.actorId === test.doctor.actor.id && record.key === "clinical-draft-001");
    expect(stored?.responseJson).not.toContain("อาการทดสอบ");
    expect(stored?.responseJson).not.toContain("ผลตรวจทดสอบ");
    expect(stored?.responseJson).not.toContain("ประเมินทดสอบ");
    expect(stored?.responseJson).not.toContain("แผนทดสอบ");
    expect(stored?.responseJson).not.toContain("การวินิจฉัยทดสอบ");
    expect(stored?.responseJson).not.toContain("คำแนะนำทดสอบ");
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "note.draft-saved"))
      .toHaveLength(1);
  });

  it("fails closed when a replayed draft revision was replaced after the first response", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const first = await saveDraft(test, visitId);
    expect(first.statusCode).toBe(200);

    const replacement = draftBody();
    replacement.expectedRevisions = { visit: 2, noteDraft: 1, medicationDraft: 1 };
    replacement.payload.note.subjective = "ฉบับใหม่หลังบันทึกแรก";
    replacement.payload.medicationDecision = { kind: "NO_MEDICATION", noMedicationReason: "เปลี่ยนการตัดสินใจ" };
    expect((await saveDraft(test, visitId, replacement, "clinical-draft-replacement-001")).statusCode).toBe(200);

    const replay = await saveDraft(test, visitId);

    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevisions: { noteDraft: 2, medicationDraft: 2 },
    });
    expect(replay.json().error.messageTh).not.toContain("ฉบับใหม่หลังบันทึกแรก");
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.actorId === test.doctor.actor.id && record.key === "clinical-draft-001");
    expect(stored?.responseJson).not.toContain("อาการทดสอบ");
    expect(stored?.responseJson).toContain("safe-replay-reference");
  });

  it("redacts a matching legacy draft envelope before rebuilding its replay", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const key = "clinical-legacy-replay-001";
    const first = await saveDraft(test, visitId, draftBody(), key);
    const legacyResponseJson = JSON.stringify({ data: first.json().data, replayed: false });
    test.database.sqlite.prepare(
      "UPDATE idempotency_records SET response_json=? WHERE actor_id=? AND key=?",
    ).run(legacyResponseJson, test.doctor.actor.id, key);

    const replay = await saveDraft(test, visitId, draftBody(), key);
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.actorId === test.doctor.actor.id && record.key === key);

    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(stored?.responseJson).not.toContain("อาการทดสอบ");
    expect(stored?.responseJson).not.toContain("การวินิจฉัยทดสอบ");
    expect(stored?.responseJson).not.toContain("คำแนะนำทดสอบ");
    expect(JSON.parse(stored?.responseJson ?? "{}")).toMatchObject({ type: "safe-replay-reference" });
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "note.draft-saved"))
      .toHaveLength(1);
  });

  it("requires a Doctor in CONSULTING state and a strict command body", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const assistant = await saveDraft(test, visitId, draftBody(), "clinical-assistant-001", test.assistantCookie);
    test.database.sqlite.prepare("UPDATE visits SET status='WAITING' WHERE id=?").run(visitId);
    const wrongState = await saveDraft(test, visitId, draftBody(), "clinical-waiting-001");
    const extraField = await saveDraft(test, visitId, {
      ...draftBody(), payload: { ...draftBody().payload, note: { ...draftBody().payload.note, unexpected: true } },
    }, "clinical-extra-field");

    expect(assistant.statusCode).toBe(403);
    expect(wrongState.json().error.code).toBe("INVALID_STATE");
    expect(extraField.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("rolls back Note and Audit when the Medication draft service fails", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    const patients = createPatientService({ database: test.database });
    const visitService = createVisitService({ database: test.database, patients });
    const notes = createNoteService({ database: test.database });
    const realMedications = createMedicationService({ database: test.database });
    const failingMedications: MedicationService = {
      ...realMedications,
      saveDecisionDraft() {
        throw new Error("injected medication failure");
      },
    };
    const workflow = createClinicalWorkflow({
      patients,
      visits: visitService,
      notes,
      medications: failingMedications,
      ...fulfillmentDependencies(test, failingMedications),
    });

    expect(() => executeIdempotent({
      db: test.database.db,
      actor: test.doctor.actor,
      key: "clinical-medication-failure-001",
      operation: "clinical.save-draft.v1",
      scope: visitId,
      requestBody: draftBody(),
      work: (tx) => ({ statusCode: 200, data: workflow.saveConsultationDraft(tx, test.doctor.actor, visitId, draftBody()) }),
    })).toThrow("injected medication failure");
    expect(test.database.db.select().from(clinicalNoteDrafts).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisionDrafts).all()).toHaveLength(0);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "note.draft-saved"))
      .toHaveLength(0);
  });
});

function completeFinalizationBody() {
  return {
    expectedRevisions: { visit: 2, patient: 2, noteDraft: 1, medicationDraft: 1 },
    payload: {},
  };
}

async function finalize(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  body: unknown = completeFinalizationBody(),
  key = "clinical-finalize-001",
  cookie = test.doctorCookie,
) {
  return test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/finalize-consultation`,
    headers: { cookie, "idempotency-key": key },
    payload: body as Record<string, unknown>,
  });
}

async function closeNoMedicationVisit(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  key: string,
): Promise<void> {
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
  expect(checkout.resolution).toMatchObject({ kind: "COLLECTION_NOT_REQUIRED" });
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

async function saveCompleteDraft(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  kind: "ORDER" | "NO_MEDICATION" = "ORDER",
) {
  const body = draftBody();
  body.payload.medicationDecision = kind === "ORDER"
    ? body.payload.medicationDecision
    : { kind: "NO_MEDICATION", noMedicationReason: "ไม่มีข้อบ่งชี้ในการจ่ายยา" };
  const response = await saveDraft(test, visitId, body, `clinical-finalize-draft-${kind}`);
  expect(response.statusCode).toBe(200);
}

describe("consultation finalization", () => {
  it.each([
    ["ORDER", "AWAITING_PREPARATION"],
    ["NO_MEDICATION", "AWAITING_CHARGE"],
  ] as const)("finalizes %s atomically to %s", async (kind, status) => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId, kind);

    const response = await finalize(test, visitId, completeFinalizationBody());

    expect(response.statusCode).toBe(200);
    expect(response.json().data.visit).toMatchObject({ status, revision: 3 });
    expect(response.json().data.clinicalNote).toMatchObject({
      visitId, version: 1, sourceDraftRevision: 1,
      signedBy: { id: "doctor-001", displayName: "พญ. ทดสอบ" },
      revisionReason: null, supersedesId: null,
    });
    expect(response.json().data.clinicalNote.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.json().data.medicationDecision).toMatchObject({
      visitId, version: 1, kind, revisionReason: null, supersedesId: null,
    });
    if (kind === "ORDER") {
      expect(response.json().data.medicationDecision.items).toEqual([expect.objectContaining({
        id: "DEMO-MED-001", revision: 1, displayName: expect.any(String), strengthText: expect.any(String),
        dosageFormText: expect.any(String), canonicalUnit: expect.any(String), quantity: 10, directionsTh: "คำแนะนำทดสอบ",
      })]);
    }
    expect(response.json().data.medicationDecision.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(1);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(1);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "note.signed"))
      .toHaveLength(1);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "medication.decision-signed"))
      .toHaveLength(1);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "visit.consultation-finalized"))
      .toHaveLength(1);
  });

  it("blocks finalization for a legacy UNKNOWN allergy before any signed write, then permits the same drafts after review", async () => {
    const test = await fixture();
    const { patientId, visitId } = await createLegacyUnknownConsultingVisit(test);
    const draft = await saveDraft(test, visitId, {
      expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
      payload: {
        note: {
          subjective: "อาการเดิม",
          objective: "ผลตรวจเดิม",
          assessment: "ประเมินเดิม",
          plan: "แผนเดิม",
          diagnoses: ["การวินิจฉัยเดิม"],
        },
        medicationDecision: { kind: "NO_MEDICATION", noMedicationReason: "ยังไม่มีข้อบ่งใช้ยา" },
      },
    }, "clinical-legacy-unknown-draft");
    expect(draft.statusCode).toBe(200);
    const workspace = await test.app.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: test.doctorCookie },
    });
    expect(workspace.statusCode).toBe(200);

    const before = {
      notes: test.database.db.select().from(clinicalNotes).all(),
      diagnoses: test.database.db.select().from(clinicalNoteDiagnoses).all(),
      decisions: test.database.db.select().from(medicationDecisions).all(),
      labels: test.database.db.select().from(fulfillmentLabelVersions).all(),
      visits: test.database.db.select().from(visits).all(),
      audits: test.database.db.select().from(auditEvents).all(),
      idempotency: test.database.db.select().from(idempotencyRecords).all(),
    };
    const blocked = await finalize(test, visitId, {
      expectedRevisions: { visit: 2, patient: 1, noteDraft: 1, medicationDraft: 1 },
      payload: {},
    }, "clinical-legacy-unknown-finalize");

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({
      code: "INVALID_STATE",
      messageTh: "ยังลงนามไม่ได้ กรุณาทบทวนประวัติแพ้ยาก่อน",
    });
    expect({
      notes: test.database.db.select().from(clinicalNotes).all(),
      diagnoses: test.database.db.select().from(clinicalNoteDiagnoses).all(),
      decisions: test.database.db.select().from(medicationDecisions).all(),
      labels: test.database.db.select().from(fulfillmentLabelVersions).all(),
      visits: test.database.db.select().from(visits).all(),
      audits: test.database.db.select().from(auditEvents).all(),
      idempotency: test.database.db.select().from(idempotencyRecords).all(),
    }).toEqual(before);

    const reviewed = await test.app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/allergy-revisions`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "clinical-legacy-unknown-review" },
      payload: {
        expectedRevisions: { patient: 1, visit: 2 },
        payload: {
          visitId,
          state: "NONE_KNOWN",
          items: [],
          sourceText: "ทบทวนประวัติเดิม",
          reason: "ยืนยันก่อนลงนาม",
        },
      },
    });
    expect(reviewed.statusCode).toBe(201);
    const committed = await finalize(test, visitId, {
      expectedRevisions: { visit: 2, patient: 2, noteDraft: 1, medicationDraft: 1 },
      payload: {},
    }, "clinical-legacy-unknown-finalize-after-review");
    expect(committed.statusCode).toBe(200);
    expect(committed.json().data).toMatchObject({
      visit: { status: "AWAITING_CHARGE", revision: 3 },
      clinicalNote: { visitId, version: 1 },
      medicationDecision: { visitId, version: 1, kind: "NO_MEDICATION" },
    });
  });

  it("returns a sourced medication Snapshot for a signed NO_MEDICATION decision on a later Visit", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId, "NO_MEDICATION");
    const finalized = await finalize(test, visitId, completeFinalizationBody(), "clinical-finalize-no-medication-snapshot");
    expect(finalized.statusCode).toBe(200);
    const patientId = test.database.db.select().from(visits).where(eq(visits.id, visitId)).get()?.patientId;
    if (!patientId) throw new Error("missing fixture patient");
    await closeNoMedicationVisit(test, visitId, "clinical-close-no-medication-snapshot");
    const laterIntake = await test.app.inject({
      method: "POST",
      url: "/api/visits/intake",
      headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-later-intake-no-medication" },
      payload: {
        expectedRevisions: { patient: 2 },
        payload: {
          patientId,
          chiefComplaint: "ติดตามอาการ",
          vitals: { weightKg: 60, heightCm: 165, temperatureC: 37, systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 80, spo2Percent: 98 },
          allergy: { answer: "NO", items: [], changeReason: null },
        },
      },
    });
    expect(laterIntake.statusCode).toBe(201);
    const laterVisitId = laterIntake.json().data.visit.id as string;

    const workspace = await test.app.inject({
      method: "GET",
      url: `/api/visits/${laterVisitId}/workspace`,
      headers: { cookie: test.doctorCookie },
    });

    expect(workspace.statusCode).toBe(200);
    expect(workspace.json().data.patientSnapshot.currentMedicationContext).toEqual({
      state: "VALUE",
      value: ["ไม่สั่งยา: ไม่มีข้อบ่งชี้ในการจ่ายยา"],
      source: {
        type: "MEDICATION_DECISION",
        id: finalized.json().data.medicationDecision.id,
        occurredAt: finalized.json().data.medicationDecision.signedAt,
      },
    });
  });

  it.each([
    ["subjective", { subjective: "", objective: "O", assessment: "A", plan: "P", diagnoses: ["D"] }],
    ["objective", { subjective: "S", objective: "  ", assessment: "A", plan: "P", diagnoses: ["D"] }],
    ["assessment", { subjective: "S", objective: "O", assessment: "", plan: "P", diagnoses: ["D"] }],
    ["plan", { subjective: "S", objective: "O", assessment: "A", plan: "", diagnoses: ["D"] }],
    ["diagnoses", { subjective: "S", objective: "O", assessment: "A", plan: "P", diagnoses: [] }],
  ])("rejects an incomplete Note draft (%s) before a signed write", async (_field, note) => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveDraft(test, visitId, {
      expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
      payload: { note, medicationDecision: draftBody().payload.medicationDecision },
    }, `clinical-incomplete-note-${_field}`);

    const response = await finalize(test, visitId);
    expect(response.statusCode).toBe(422);
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
    expect(test.database.db.select().from(visits).where(eq(visits.id, visitId)).get())
      .toMatchObject({ status: "CONSULTING", revision: 2 });
  });

  it.each([
    ["UNDECIDED", { kind: "UNDECIDED" }],
    ["empty ORDER", { kind: "ORDER", items: [] }],
    ["blank NO_MEDICATION reason", { kind: "NO_MEDICATION", noMedicationReason: " " }],
  ])("rejects %s medication draft before a signed write", async (_name, medicationDecision) => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveDraft(test, visitId, {
      expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
      payload: { note: draftBody().payload.note, medicationDecision },
    }, `clinical-incomplete-medication-${_name.replaceAll(" ", "-")}`);

    const response = await finalize(test, visitId);
    expect(response.statusCode).toBe(422);
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
  });

  it("uses the Patient revision as the allergy safety token", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId);
    const patientId = test.database.db.select().from(visits).where(eq(visits.id, visitId)).get()?.patientId;
    if (!patientId) throw new Error("missing fixture patient");
    const allergy = await test.app.inject({
      method: "POST", url: `/api/patients/${patientId}/allergy-revisions`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "clinical-finalize-allergy-001" },
      payload: { expectedRevisions: { patient: 2, visit: 2 }, payload: {
        visitId, state: "NONE_KNOWN", items: [], sourceText: "ทบทวนก่อนลงนาม", reason: "ความปลอดภัย",
      } },
    });
    expect(allergy.statusCode).toBe(201);

    const response = await finalize(test, visitId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.currentRevisions).toEqual({ patient: 3 });
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
  });

  it("rejects finalization from a non-CONSULTING Visit state", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId);
    test.database.sqlite.prepare("UPDATE visits SET status='AWAITING_CHARGE' WHERE id=?").run(visitId);

    const response = await finalize(test, visitId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INVALID_STATE");
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
  });

  it.each([
    ["Visit", { visit: 1, patient: 2, noteDraft: 1, medicationDraft: 1 }, "visit", 2],
    ["Note draft", { visit: 2, patient: 2, noteDraft: 2, medicationDraft: 1 }, "noteDraft", 1],
    ["Medication draft", { visit: 2, patient: 2, noteDraft: 1, medicationDraft: 2 }, "medicationDraft", 1],
  ])("rejects stale %s revisions without a partial signature", async (_name, expectedRevisions, key, current) => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId);
    const response = await finalize(test, visitId, { expectedRevisions, payload: {} }, `clinical-finalize-stale-${key}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.currentRevisions).toEqual({ [key]: current });
    expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
  });

  it("revalidates the catalog, protects the route, replays safely, and detects a key collision", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId);
    const assistant = await finalize(test, visitId, completeFinalizationBody(), "clinical-finalize-assistant", test.assistantCookie);
    expect(assistant.statusCode).toBe(403);
    test.database.sqlite.prepare("UPDATE medications SET revision=2 WHERE id='DEMO-MED-001'").run();
    const staleCatalog = await finalize(test, visitId, completeFinalizationBody(), "clinical-finalize-catalog");
    expect(staleCatalog.statusCode).toBe(409);
    expect(staleCatalog.json().error.currentRevisions).toEqual({ "medication.DEMO-MED-001": 2 });
    test.database.sqlite.prepare("UPDATE medications SET revision=1 WHERE id='DEMO-MED-001'").run();
    const first = await finalize(test, visitId);
    const replay = await finalize(test, visitId);
    const collision = await finalize(test, visitId, {
      expectedRevisions: { visit: 2, patient: 2, noteDraft: 2, medicationDraft: 1 }, payload: {},
    });
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.key === "clinical-finalize-001");
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(first.json().data.clinicalNote.id).toBe(replay.json().data.clinicalNote.id);
    expect(first.json().data.clinicalNote.contentHash).toBe(replay.json().data.clinicalNote.contentHash);
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(stored?.responseJson).not.toContain("อาการทดสอบ");
    expect(stored?.responseJson).not.toContain("คำแนะนำทดสอบ");
  });

  it("replays signed evidence with its signer display-name snapshot after account mutation", async () => {
    const test = await fixture();
    const visitId = await createConsultingVisit(test);
    await saveCompleteDraft(test, visitId);
    const first = await finalize(test, visitId);
    const initial = first.json().data;
    test.database.sqlite.prepare("UPDATE staff_accounts SET display_name=? WHERE id=?")
      .run("ชื่อผู้ลงนามที่เปลี่ยนแล้ว", test.doctor.actor.id);

    const replay = await finalize(test, visitId);
    const replayed = replay.json().data;
    const { contentHash: noteHash, ...noteEvidence } = replayed.clinicalNote;
    const { contentHash: decisionHash, ...decisionEvidence } = replayed.medicationDecision;

    expect(replay.statusCode).toBe(200);
    expect(replayed.clinicalNote.signedBy).toEqual(initial.clinicalNote.signedBy);
    expect(replayed.medicationDecision.signedBy).toEqual(initial.medicationDecision.signedBy);
    expect(noteHash).toBe(initial.clinicalNote.contentHash);
    expect(decisionHash).toBe(initial.medicationDecision.contentHash);
    expect(hashEvidence(noteEvidence)).toBe(noteHash);
    expect(hashEvidence(decisionEvidence)).toBe(decisionHash);
  });

  it.each(["after Note", "after decision", "before Visit transition"] as const)(
    "rolls back all signed and audit writes when failure is injected %s",
    async (point) => {
      const test = await fixture();
      const visitId = await createConsultingVisit(test);
      await saveCompleteDraft(test, visitId);
      const patients = createPatientService({ database: test.database });
      const visitsService = createVisitService({ database: test.database, patients });
      const notes = createNoteService({ database: test.database });
      const medications = createMedicationService({ database: test.database });
      const failingMedications: MedicationService = point === "after Note" ? {
        ...medications,
        signDecisionDraft() { throw new Error("injected after Note"); },
      } : medications;
      const failingVisits = point === "before Visit transition" ? {
        ...visitsService,
        finalizeConsultation() { throw new Error("injected before Visit transition"); },
      } : visitsService;
      const workflow = createClinicalWorkflow({
        patients,
        visits: failingVisits,
        notes,
        medications: failingMedications,
        ...fulfillmentDependencies(test, failingMedications),
        beforeVisitTransition: point === "after decision"
          ? () => { throw new Error("injected after decision"); }
          : undefined,
      });

      expect(() => executeIdempotent({
        db: test.database.db,
        actor: test.doctor.actor,
        key: `clinical-finalize-injected-${point.replaceAll(" ", "-")}`,
        operation: "clinical.finalize-consultation.v1",
        scope: visitId,
        requestBody: completeFinalizationBody(),
        work: (tx) => ({
          statusCode: 200,
          data: workflow.finalizeConsultation(tx, test.doctor.actor, visitId, completeFinalizationBody()),
        }),
      })).toThrow(`injected ${point}`);
      expect(test.database.db.select().from(clinicalNotes).all()).toHaveLength(0);
      expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(0);
      expect(test.database.db.select().from(auditEvents).all().filter((event) => (
        event.action === "note.signed" || event.action === "medication.decision-signed" || event.action === "visit.consultation-finalized"
      ))).toHaveLength(0);
      expect(test.database.db.select().from(visits).where(eq(visits.id, visitId)).get())
        .toMatchObject({ status: "CONSULTING", revision: 2 });
      expect(test.database.db.select().from(idempotencyRecords).all().filter((record) => (
        record.key.startsWith("clinical-finalize-injected-")
      ))).toHaveLength(0);
    },
  );
});

async function finalizeOrder(test: Awaited<ReturnType<typeof fixture>>) {
  const visitId = await createConsultingVisit(test);
  await saveCompleteDraft(test, visitId, "ORDER");
  const finalized = await finalize(test, visitId);
  expect(finalized.statusCode).toBe(200);
  return { visitId, finalized: finalized.json().data };
}

async function reserveForSafetyState(test: Awaited<ReturnType<typeof fixture>>, visitId: string, key: string) {
  const receipt = await test.app.inject({
    method: "POST", url: "/api/inventory/receipts",
    headers: { cookie: test.assistantCookie, "idempotency-key": `${key}-receipt` },
    payload: { expectedRevisions: { medication: 1 }, payload: { medicationId: "DEMO-MED-001", quantity: 10, lotNumber: `${key}-LOT`, expiryDate: "2030-08-20", supplierName: "ผู้จำหน่ายสังเคราะห์", note: "เตรียมทดสอบ safety" } },
  });
  expect(receipt.statusCode).toBe(201);
  const label = await test.app.inject({ method: "GET", url: `/api/dispensing/${visitId}/labels`, headers: { cookie: test.assistantCookie } });
  expect(label.statusCode).toBe(200);
  const reserved = await test.app.inject({
    method: "POST", url: `/api/dispensing/${visitId}/reservations`,
    headers: { cookie: test.assistantCookie, "idempotency-key": `${key}-reserve` },
    payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: { labelVersionId: label.json().data.id } },
  });
  expect(reserved.statusCode).toBe(201);
  return reserved.json().data;
}

function amend(
  test: Awaited<ReturnType<typeof fixture>>,
  noteId: string,
  input: { version?: number; content?: string; reason?: string; key?: string; cookie?: string } = {},
) {
  return test.app.inject({
    method: "POST",
    url: `/api/clinical-notes/${noteId}/amendments`,
    headers: { cookie: input.cookie ?? test.doctorCookie, "idempotency-key": input.key ?? "clinical-amendment-001" },
    payload: {
      expectedRevisions: { amendment: input.version ?? 0 },
      payload: { content: input.content ?? "ข้อมูลเพิ่มเติมทดสอบ", reason: input.reason ?? "เพิ่มรายละเอียด" },
    },
  });
}

function reviseDecision(
  test: Awaited<ReturnType<typeof fixture>>,
  visitId: string,
  input: { visit?: number; patient?: number; decision?: number; reason?: string; kind?: "ORDER" | "NO_MEDICATION"; key?: string; cookie?: string } = {},
) {
  const kind = input.kind ?? "NO_MEDICATION";
  return test.app.inject({
    method: "POST",
    url: `/api/visits/${visitId}/medication-decision-revisions`,
    headers: { cookie: input.cookie ?? test.doctorCookie, "idempotency-key": input.key ?? "clinical-decision-revision-001" },
    payload: {
      expectedRevisions: { visit: input.visit ?? 3, patient: input.patient ?? 2, medicationDecision: input.decision ?? 1 },
      payload: {
        revisionReason: input.reason ?? "ปรับคำสั่งตามข้อมูลใหม่",
        decision: kind === "NO_MEDICATION"
          ? { kind, noMedicationReason: "ไม่มีข้อบ่งชี้หลังทบทวน" }
          : { kind, items: [{ medicationId: "DEMO-MED-001", medicationRevision: 1, quantity: 5, directionsTh: "หลังอาหาร" }] },
      },
    },
  });
}

describe("signed evidence amendments and safety revisions", () => {
  it("appends an amendment without changing the original hash and safely replays", async () => {
    const test = await fixture();
    const { finalized } = await finalizeOrder(test);
    const before = test.database.db.select().from(clinicalNotes).get();
    const first = await amend(test, finalized.clinicalNote.id);
    const replay = await amend(test, finalized.clinicalNote.id);
    const stored = test.database.db.select().from(idempotencyRecords).all()
      .find((record) => record.key === "clinical-amendment-001");

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ clinicalNoteId: finalized.clinicalNote.id, version: 1 });
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(test.database.db.select().from(clinicalNotes).get()).toEqual(before);
    expect(test.database.db.select().from(clinicalNoteAmendments).all()).toHaveLength(1);
    expect(stored?.responseJson).not.toContain("ข้อมูลเพิ่มเติมทดสอบ");
    expect(stored?.responseJson).not.toContain("เพิ่มรายละเอียด");
    expect(() => test.database.sqlite.prepare("UPDATE clinical_note_amendments SET content='x'").run()).toThrow(/append-only/);
  });

  it("rejects stale, blank, Assistant, and colliding amendment commands without an append", async () => {
    const test = await fixture();
    const { finalized } = await finalizeOrder(test);
    const first = await amend(test, finalized.clinicalNote.id, { key: "clinical-amendment-validation" });
    const stale = await amend(test, finalized.clinicalNote.id, { version: 0, key: "clinical-amendment-stale" });
    const blank = await amend(test, finalized.clinicalNote.id, { version: 1, content: " ", key: "clinical-amendment-blank" });
    const assistant = await amend(test, finalized.clinicalNote.id, { version: 1, cookie: test.assistantCookie, key: "clinical-amendment-assistant" });
    const collision = await amend(test, finalized.clinicalNote.id, { content: "ข้อความอื่น", key: "clinical-amendment-validation" });
    const second = await amend(test, finalized.clinicalNote.id, { version: 1, key: "clinical-amendment-second" });

    expect(first.statusCode).toBe(201);
    expect(stale.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { amendment: 1 } });
    expect(blank.statusCode).toBe(422);
    expect(assistant.statusCode).toBe(403);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(second.json().data.version).toBe(2);
    expect(test.database.db.select().from(clinicalNoteAmendments).all()).toHaveLength(2);
  });

  it("supersedes a decision with immutable catalog evidence and transitions to charge", async () => {
    const test = await fixture();
    const { visitId, finalized } = await finalizeOrder(test);
    const before = test.database.db.select().from(medicationDecisions).get();
    const response = await reviseDecision(test, visitId);

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      visit: { status: "AWAITING_CHARGE", revision: 4 },
      medicationDecision: { version: 2, kind: "NO_MEDICATION", supersedesId: finalized.medicationDecision.id },
    });
    expect(test.database.db.select().from(medicationDecisions).get()).toEqual(before);
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(2);
    expect(test.database.db.select().from(medicationOrderItems).all()).toHaveLength(1);
    expect(test.database.db.select().from(auditEvents).all().find((event) => event.action === "medication.decision-revised"))
      .toMatchObject({ reason: "ปรับคำสั่งตามข้อมูลใหม่" });
  });

  it("replays original finalization and decision revisions after a later decision changes the Visit", async () => {
    const test = await fixture();
    const { visitId, finalized } = await finalizeOrder(test);
    const firstRevision = await reviseDecision(test, visitId);
    const laterRevision = await reviseDecision(test, visitId, {
      visit: 4,
      decision: 2,
      kind: "ORDER",
      key: "clinical-decision-revision-later",
    });

    const finalizedReplay = await finalize(test, visitId);
    const firstRevisionReplay = await reviseDecision(test, visitId);

    expect(firstRevision.statusCode).toBe(201);
    expect(laterRevision.statusCode).toBe(201);
    expect(finalizedReplay.statusCode).toBe(200);
    expect(finalizedReplay.json()).toEqual({ data: finalized, replayed: true });
    expect(firstRevisionReplay.statusCode).toBe(201);
    expect(firstRevisionReplay.json()).toEqual({ data: firstRevision.json().data, replayed: true });
  });

  it("normalizes pre-fix safe references after a later decision revision", async () => {
    const test = await fixture();
    const { visitId, finalized } = await finalizeOrder(test);
    const firstRevision = await reviseDecision(test, visitId);
    const firstRevisionData = firstRevision.json().data;
    test.database.sqlite.prepare(
      "UPDATE idempotency_records SET response_json=? WHERE actor_id=? AND key=?",
    ).run(JSON.stringify({
      type: "safe-replay-reference",
      reference: {
        visitId: finalized.visit.id,
        visitRevision: finalized.visit.revision,
        clinicalNoteId: finalized.clinicalNote.id,
        medicationDecisionId: finalized.medicationDecision.id,
      },
    }), test.doctor.actor.id, "clinical-finalize-001");
    test.database.sqlite.prepare(
      "UPDATE idempotency_records SET response_json=? WHERE actor_id=? AND key=?",
    ).run(JSON.stringify({
      type: "safe-replay-reference",
      reference: {
        visitId: firstRevisionData.visit.id,
        visitRevision: firstRevisionData.visit.revision,
        medicationDecisionId: firstRevisionData.medicationDecision.id,
        medicationDecisionVersion: firstRevisionData.medicationDecision.version,
      },
    }), test.doctor.actor.id, "clinical-decision-revision-001");
    expect((await reviseDecision(test, visitId, {
      visit: 4, decision: 2, kind: "ORDER", key: "clinical-legacy-reference-later",
    })).statusCode).toBe(201);

    const finalizedReplay = await finalize(test, visitId);
    const firstRevisionReplay = await reviseDecision(test, visitId);

    expect(finalizedReplay.statusCode).toBe(200);
    expect(finalizedReplay.json()).toEqual({ data: finalized, replayed: true });
    expect(firstRevisionReplay.statusCode).toBe(201);
    expect(firstRevisionReplay.json()).toEqual({ data: firstRevisionData, replayed: true });
  });

  it.each(["AWAITING_ORDER_REVISION", "AWAITING_PREPARATION", "PREPARING", "AWAITING_CHARGE"] as const)(
    "accepts an ORDER decision revision only from %s",
    async (status) => {
      const test = await fixture();
      const { visitId } = await finalizeOrder(test);
      if (status !== "AWAITING_PREPARATION") {
        test.database.sqlite.prepare("UPDATE visits SET status=? WHERE id=?").run(status, visitId);
      }
      const response = await reviseDecision(test, visitId, { kind: "ORDER", key: `clinical-revision-${status}` });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.visit).toMatchObject({ status: "AWAITING_PREPARATION", revision: 4 });
    },
  );

  it("rejects stale Visit, safety, decision, and catalog tokens and Assistant decision revisions", async () => {
    const test = await fixture();
    const { visitId } = await finalizeOrder(test);
    const staleVisit = await reviseDecision(test, visitId, { visit: 99, key: "clinical-revision-stale-visit" });
    const stalePatient = await reviseDecision(test, visitId, { patient: 99, key: "clinical-revision-stale-patient" });
    const staleDecision = await reviseDecision(test, visitId, { decision: 99, key: "clinical-revision-stale-decision" });
    test.database.sqlite.prepare("UPDATE medications SET revision=2 WHERE id='DEMO-MED-001'").run();
    const staleCatalog = await reviseDecision(test, visitId, { kind: "ORDER", key: "clinical-revision-stale-catalog" });
    test.database.sqlite.prepare("UPDATE medications SET revision=1 WHERE id='DEMO-MED-001'").run();
    const assistant = await reviseDecision(test, visitId, { cookie: test.assistantCookie, key: "clinical-revision-assistant" });
    test.database.sqlite.prepare("UPDATE visits SET status='PREPARING' WHERE id=?").run(visitId);
    const preparingRevision = await reviseDecision(test, visitId, { key: "clinical-revision-preparing" });

    expect(staleVisit.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { visit: 3 } });
    expect(stalePatient.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { patient: 2 } });
    expect(staleDecision.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { medicationDecision: 1 } });
    expect(staleCatalog.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { "medication.DEMO-MED-001": 2 } });
    expect(assistant.statusCode).toBe(403);
    expect(preparingRevision.statusCode).toBe(201);
    expect(preparingRevision.json().data.visit).toMatchObject({ status: "AWAITING_CHARGE", revision: 4 });
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(2);
  });

  it("rolls back a decision revision, its audit, and its idempotency record when the Visit transition fails", async () => {
    const test = await fixture();
    const { visitId } = await finalizeOrder(test);
    const patients = createPatientService({ database: test.database });
    const workflow = createClinicalWorkflow({
      patients,
      visits: createVisitService({ database: test.database, patients }),
      notes: createNoteService({ database: test.database }),
      medications: createMedicationService({ database: test.database }),
      ...fulfillmentDependencies(test, createMedicationService({ database: test.database })),
      beforeDecisionRevisionTransition: () => { throw new Error("injected decision revision failure"); },
    });
    const body = {
      expectedRevisions: { visit: 3, patient: 2, medicationDecision: 1 },
      payload: { revisionReason: "ทดสอบ rollback", decision: { kind: "NO_MEDICATION" as const, noMedicationReason: "ไม่มีข้อบ่งชี้" } },
    };

    expect(() => executeIdempotent({
      db: test.database.db,
      actor: test.doctor.actor,
      key: "clinical-revision-rollback",
      operation: "medication.revise-decision.v1",
      scope: visitId,
      requestBody: body,
      work: (tx) => ({ statusCode: 201, data: workflow.reviseMedicationDecision(tx, test.doctor.actor, visitId, body) }),
    })).toThrow("injected decision revision failure");
    expect(test.database.db.select().from(medicationDecisions).all()).toHaveLength(1);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "medication.decision-revised"))
      .toEqual([]);
    expect(test.database.db.select().from(visits).where(eq(visits.id, visitId)).get())
      .toMatchObject({ status: "AWAITING_PREPARATION", revision: 3 });
    expect(test.database.db.select().from(idempotencyRecords).all().find((event) => event.key === "clinical-revision-rollback"))
      .toBeUndefined();
  });

  it("moves a Doctor allergy update from preparation to order revision atomically", async () => {
    const test = await fixture();
    const { visitId } = await finalizeOrder(test);
    const patientId = test.database.db.select().from(visits).where(eq(visits.id, visitId)).get()?.patientId;
    if (!patientId) throw new Error("missing patient");
    const response = await test.app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/allergy-revisions`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "clinical-allergy-safety-001" },
      payload: {
        expectedRevisions: { patient: 2, visit: 3 },
        payload: { visitId, state: "PRESENT", items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }], sourceText: "พบประวัติแพ้", reason: "ป้องกันการจ่ายยา" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.visit).toMatchObject({ status: "AWAITING_ORDER_REVISION", revision: 4 });
    expect(test.database.db.select().from(auditEvents).all().find((event) => event.action === "visit.allergy-safety-changed"))
      .toMatchObject({ reason: "ป้องกันการจ่ายยา" });
  });

  it("releases a real active reservation before a medication revision and preserves its allocations", async () => {
    const test = await fixture();
    const { visitId } = await finalizeOrder(test);
    const receipt = await test.app.inject({
      method: "POST",
      url: "/api/inventory/receipts",
      headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-reservation-receipt-001" },
      payload: {
        expectedRevisions: { medication: 1 },
        payload: {
          medicationId: "DEMO-MED-001", quantity: 10, lotNumber: "CLINICAL-RESERVATION-001",
          expiryDate: "2030-08-20", supplierName: "ผู้จำหน่ายสังเคราะห์", note: "เตรียมทดสอบ safety release",
        },
      },
    });
    expect(receipt.statusCode).toBe(201);
    const label = await test.app.inject({ method: "GET", url: `/api/dispensing/${visitId}/labels`, headers: { cookie: test.assistantCookie } });
    expect(label.statusCode).toBe(200);
    const reserved = await test.app.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/reservations`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "clinical-reservation-create-001" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: { labelVersionId: label.json().data.id } },
    });
    expect(reserved.statusCode).toBe(201);
    const allocationsBefore = test.database.db.select().from(inventoryReservationAllocations).all();
    expect(allocationsBefore).toHaveLength(1);

    const revised = await reviseDecision(test, visitId, {
      visit: 4,
      kind: "NO_MEDICATION",
      key: "clinical-reservation-decision-revision-001",
    });

    expect(revised.statusCode).toBe(201);
    expect(revised.json().data.visit).toMatchObject({ status: "AWAITING_CHARGE", revision: 5 });
    expect(test.database.db.select().from(inventoryReservations).all()).toMatchObject([{ status: "RELEASED" }]);
    expect(test.database.db.select().from(inventoryReservationAllocations).all()).toEqual(allocationsBefore);
    expect(test.database.db.select().from(auditEvents).all().find((event) => event.action === "inventory.reservation-released"))
      .toMatchObject({ reason: "ปรับคำสั่งตามข้อมูลใหม่" });
    expect(JSON.parse(test.database.db.select().from(auditEvents).all()
      .find((event) => event.action === "visit.preparation-abandoned")?.metadataJson ?? "{}")).toMatchObject({
      previousStatus: "PREPARING", nextStatus: "AWAITING_CHARGE",
    });
  });

  it.each(["PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF"] as const)(
    "releases an active reservation and records the actual %s allergy transition",
    async (status) => {
      const test = await fixture();
      const { visitId } = await finalizeOrder(test);
      const prepared = await reserveForSafetyState(test, visitId, `allergy-${status}`);
      const beforeAllocations = test.database.db.select().from(inventoryReservationAllocations).all();
      if (status !== "PREPARING") test.database.sqlite.prepare("UPDATE visits SET status=? WHERE id=?").run(status, visitId);
      const patientId = test.database.db.select().from(visits).where(eq(visits.id, visitId)).get()?.patientId;
      if (!patientId) throw new Error("missing patient");
      const response = await test.app.inject({
        method: "POST", url: `/api/patients/${patientId}/allergy-revisions`,
        headers: { cookie: test.doctorCookie, "idempotency-key": `allergy-transition-${status}` },
        payload: { expectedRevisions: { patient: 2, visit: 4 }, payload: { visitId, state: "PRESENT", items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }], sourceText: "พบประวัติแพ้", reason: "ความปลอดภัย" } },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().data.visit).toMatchObject({ status: "AWAITING_ORDER_REVISION", revision: 5 });
      expect(test.database.db.select().from(inventoryReservations).all()).toMatchObject([{ id: prepared.reservation.id, status: "RELEASED" }]);
      expect(test.database.db.select().from(inventoryReservationAllocations).all()).toEqual(beforeAllocations);
      const abandoned = test.database.db.select().from(auditEvents).all().find((event) => event.action === "visit.preparation-abandoned");
      expect(JSON.parse(abandoned?.metadataJson ?? "{}")).toMatchObject({ previousStatus: status, nextStatus: "AWAITING_ORDER_REVISION" });
    },
  );

  it.each(["PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF"] as const)(
    "releases an active reservation and records actual transitions for ORDER and NO_MEDICATION revision from %s",
    async (status) => {
      for (const [kind, nextStatus] of [["ORDER", "AWAITING_PREPARATION"], ["NO_MEDICATION", "AWAITING_CHARGE"]] as const) {
        const test = await fixture();
        const { visitId } = await finalizeOrder(test);
        const prepared = await reserveForSafetyState(test, visitId, `revision-${status}-${kind}`);
        const beforeAllocations = test.database.db.select().from(inventoryReservationAllocations).all();
        if (status !== "PREPARING") test.database.sqlite.prepare("UPDATE visits SET status=? WHERE id=?").run(status, visitId);
        const response = await reviseDecision(test, visitId, { visit: 4, kind, key: `revision-transition-${status}-${kind}` });
        expect(response.statusCode).toBe(201);
        expect(response.json().data.visit).toMatchObject({ status: nextStatus, revision: 5 });
        expect(test.database.db.select().from(inventoryReservations).all()).toMatchObject([{ id: prepared.reservation.id, status: "RELEASED" }]);
        expect(test.database.db.select().from(inventoryReservationAllocations).all()).toEqual(beforeAllocations);
        const abandoned = test.database.db.select().from(auditEvents).all().find((event) => event.action === "visit.preparation-abandoned");
        expect(JSON.parse(abandoned?.metadataJson ?? "{}")).toMatchObject({ previousStatus: status, nextStatus: nextStatus });
      }
    },
  );
});
