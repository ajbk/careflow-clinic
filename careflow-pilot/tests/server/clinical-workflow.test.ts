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
import { auditEvents, executeIdempotent, idempotencyRecords } from "../../src/server/modules/platform/index.js";
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
