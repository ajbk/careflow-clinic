import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createMedicationService,
  medicationDecisions,
  medicationDecisionDrafts,
  medicationOrderDraftItems,
  type MedicationService,
} from "../../src/server/modules/medication/index.js";
import { clinicalNoteDrafts, clinicalNotes, createNoteService } from "../../src/server/modules/note/index.js";
import { createPatientService } from "../../src/server/modules/patient/index.js";
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
    expectedRevisions: { visit: 2, patient: 1, noteDraft: 1, medicationDraft: 1 },
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
      payload: { expectedRevisions: { patient: 1, visit: 2 }, payload: {
        visitId, state: "NONE_KNOWN", items: [], sourceText: "ทบทวนก่อนลงนาม", reason: "ความปลอดภัย",
      } },
    });
    expect(allergy.statusCode).toBe(201);

    const response = await finalize(test, visitId);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.currentRevisions).toEqual({ patient: 2 });
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
    ["Visit", { visit: 1, patient: 1, noteDraft: 1, medicationDraft: 1 }, "visit", 2],
    ["Note draft", { visit: 2, patient: 1, noteDraft: 2, medicationDraft: 1 }, "noteDraft", 1],
    ["Medication draft", { visit: 2, patient: 1, noteDraft: 1, medicationDraft: 2 }, "medicationDraft", 1],
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
      expectedRevisions: { visit: 2, patient: 1, noteDraft: 2, medicationDraft: 1 }, payload: {},
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
