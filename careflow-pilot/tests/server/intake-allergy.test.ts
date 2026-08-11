import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as contracts from "../../src/shared/contracts.js";
import { submitIntakeBodySchema } from "../../src/shared/contracts.js";
import { createPatientService, patientAllergyItems, patientAllergyRevisions, patients } from "../../src/server/modules/patient/index.js";
import { auditEvents, runAuditedTransaction } from "../../src/server/modules/platform/index.js";
import { intakeObservations } from "../../src/server/modules/visit/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const emptyVitals = {
  weightKg: null,
  heightCm: null,
  temperatureC: null,
  systolicMmhg: null,
  diastolicMmhg: null,
  heartRateBpm: null,
  spo2Percent: null,
};

const singleItem = {
  substance: "เพนิซิลลิน",
  reaction: "ผื่นลมพิษ",
  severity: "MILD",
  note: null,
};

function noAnswer(patientId = "patient-1") {
  return {
    expectedRevisions: { patient: 1 },
    payload: {
      patientId,
      chiefComplaint: "ไอ",
      vitals: emptyVitals,
      allergy: { answer: "NO", items: [], changeReason: null },
    },
  };
}

function yesAnswer(patientId = "patient-1", items: unknown[] = [singleItem], changeReason: string | null = null) {
  return {
    ...noAnswer(patientId),
    payload: {
      ...noAnswer(patientId).payload,
      allergy: { answer: "YES", items, changeReason },
    },
  };
}

type SafeParser = { safeParse(value: unknown): { success: boolean } };

describe("Intake allergy contracts", () => {
  it("accepts only the declared NO and YES answer shapes", () => {
    expect(submitIntakeBodySchema.parse(noAnswer()).payload.allergy.answer).toBe("NO");
    expect(submitIntakeBodySchema.parse(yesAnswer()).payload.allergy.answer).toBe("YES");

    expect(submitIntakeBodySchema.safeParse({
      ...noAnswer(),
      payload: {
        ...noAnswer().payload,
        allergy: { answer: "NO", items: [singleItem], changeReason: null },
      },
    }).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [])).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", Array.from({ length: 21 }, () => singleItem))).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse({
      ...noAnswer(),
      payload: { ...noAnswer().payload, allergy: { items: [], changeReason: null } },
    }).success).toBe(false);
  });

  it("uses Unicode code-point limits and canonical allergy severity", () => {
    const atSubstanceLimit = { ...singleItem, substance: "😀".repeat(200) };
    const aboveSubstanceLimit = { ...singleItem, substance: "😀".repeat(201) };
    const atReactionLimit = { ...singleItem, reaction: "😀".repeat(300) };
    const aboveReactionLimit = { ...singleItem, reaction: "😀".repeat(301) };
    const atNoteLimit = { ...singleItem, note: "😀".repeat(500) };
    const aboveNoteLimit = { ...singleItem, note: "😀".repeat(501) };

    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [atSubstanceLimit])).success).toBe(true);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [aboveSubstanceLimit])).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [atReactionLimit])).success).toBe(true);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [aboveReactionLimit])).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [atNoteLimit])).success).toBe(true);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [aboveNoteLimit])).success).toBe(false);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [singleItem], "😀".repeat(500))).success).toBe(true);
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [singleItem], "😀".repeat(501))).success).toBe(false);

    for (const severity of ["UNKNOWN", "MILD", "MODERATE", "SEVERE"]) {
      expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [{ ...singleItem, severity }])).success).toBe(true);
    }
    expect(submitIntakeBodySchema.safeParse(yesAnswer("patient-1", [{ ...singleItem, severity: "CRITICAL" }])).success).toBe(false);
  });

  it("rejects unknown and own prototype keys at every Intake command level", () => {
    const valid = noAnswer();
    const invalidBodies = [
      { ...valid, unexpected: true },
      { ...valid, expectedRevisions: { ...valid.expectedRevisions, unexpected: true } },
      { ...valid, payload: { ...valid.payload, unexpected: true } },
      { ...valid, payload: { ...valid.payload, vitals: { ...valid.payload.vitals, unexpected: true } } },
      { ...valid, payload: { ...valid.payload, allergy: { ...valid.payload.allergy, unexpected: true } } },
      yesAnswer("patient-1", [{ ...singleItem, unexpected: true }]),
    ];
    for (const body of invalidBodies) {
      expect(submitIntakeBodySchema.safeParse(body).success).toBe(false);
    }

    const ownPrototype = JSON.parse(
      '{"expectedRevisions":{"patient":1},"payload":{"patientId":"patient-1","chiefComplaint":"ไอ","vitals":{"weightKg":null,"heightCm":null,"temperatureC":null,"systolicMmhg":null,"diastolicMmhg":null,"heartRateBpm":null,"spo2Percent":null},"allergy":{"answer":"NO","items":[],"changeReason":null,"__proto__":{"polluted":true}}}}',
    ) as Record<string, unknown>;
    expect(submitIntakeBodySchema.safeParse(ownPrototype).success).toBe(false);
  });

  it("strictly parses the patient allergy context response", () => {
    const schema = (contracts as Record<string, unknown>).patientAllergyContextSchema as SafeParser | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const valid = {
      patient: {
        id: "patient-1",
        hn: "DEMO-000001",
        displayName: "ผู้ป่วยทดสอบ 000001",
        phone: "0000000001",
        birthDate: "1990-01-01",
        sex: "unknown",
        revision: 1,
        createdAt: "2026-08-03T00:00:00.000Z",
      },
      allergy: {
        id: null,
        revision: 0,
        state: "UNKNOWN",
        items: [],
        sourceText: null,
        reason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
    expect(schema.safeParse({ ...valid, patient: { ...valid.patient, unexpected: true } }).success).toBe(false);
  });
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const test = await createTestApp(overrides as never);
  cleanups.push(test.cleanup);
  const assistant = await seedAccount(test.database, {
    id: "intake-allergy-assistant",
    username: "intake-allergy-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยทดสอบ",
    mustChangePassword: false,
  });
  const doctor = await seedAccount(test.database, {
    id: "intake-allergy-doctor",
    username: "intake-allergy-doctor",
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

async function createPatient(test: Awaited<ReturnType<typeof fixture>>, key = "intake-allergy-patient-001") {
  const response = await test.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie: test.assistantCookie, "idempotency-key": key },
    payload: { expectedRevisions: {}, payload: {} },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data.id as string;
}

async function postIntake(
  test: Awaited<ReturnType<typeof fixture>>,
  patientId: string,
  allergy: unknown = noAnswer(patientId).payload.allergy,
  key = "intake-allergy-command-001",
  complaint = "ไอและมีไข้",
  expectedPatientRevision?: number,
) {
  return test.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie: test.assistantCookie, "idempotency-key": key },
    payload: {
      expectedRevisions: {
        patient: expectedPatientRevision ?? test.database.db.select().from(patients).where(eq(patients.id, patientId)).get()?.revision ?? 1,
      },
      payload: { patientId, chiefComplaint: complaint, vitals: emptyVitals, allergy },
    },
  });
}

function recordIntakeAllergy(
  test: Awaited<ReturnType<typeof fixture>>,
  input: { patientId: string; expectedPatientRevision: number; answer: unknown; visitId: string },
) {
  const service = createPatientService({
    database: test.database,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
  }) as unknown as {
    recordIntakeAllergy: (
      tx: Parameters<Parameters<typeof runAuditedTransaction>[0]["work"]>[0],
      actor: typeof test.assistant.actor,
      value: {
        patientId: string;
        visitId: string;
        expectedPatientRevision: number;
        answer: unknown;
        occurredAt: string;
      },
    ) => unknown;
  };
  return runAuditedTransaction({
    db: test.database.db,
    actor: test.assistant.actor,
    work: (tx) => service.recordIntakeAllergy(tx, test.assistant.actor, {
      ...input,
      occurredAt: "2026-08-03T00:00:00.000Z",
    }),
  });
}

type IntakeEvidence = {
  visits: Array<{ id: string; patient_id: string }>;
  intake_observations: Array<{ visit_id: string }>;
  patient_allergy_revisions: Array<{ patient_id: string }>;
  patient_allergy_items: Array<Record<string, unknown>>;
  patients: Array<{ id: string; revision: number }>;
  audit_events: Array<{ action: string }>;
  idempotency_records: Array<{ key: string }>;
};

function readIntakeEvidence(test: Awaited<ReturnType<typeof fixture>>): IntakeEvidence {
  const rows = <T extends Record<string, unknown>>(table: string): T[] =>
    test.database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as T[];
  return {
    visits: rows<IntakeEvidence["visits"][number]>("visits"),
    intake_observations: rows<IntakeEvidence["intake_observations"][number]>("intake_observations"),
    patient_allergy_revisions: rows<IntakeEvidence["patient_allergy_revisions"][number]>("patient_allergy_revisions"),
    patient_allergy_items: rows<IntakeEvidence["patient_allergy_items"][number]>("patient_allergy_items"),
    patients: rows<IntakeEvidence["patients"][number]>("patients"),
    audit_events: rows<IntakeEvidence["audit_events"][number]>("audit_events"),
    idempotency_records: rows<IntakeEvidence["idempotency_records"][number]>("idempotency_records"),
  };
}

const intakeWriteStages = [
  "AFTER_VISIT_INSERT",
  "AFTER_OBSERVATION_INSERT",
  "AFTER_ALLERGY_INSERT",
  "AFTER_PATIENT_REVISION",
  "AFTER_ALLERGY_AUDIT",
  "AFTER_INTAKE_AUDIT",
] as const;

describe("atomic Intake allergy command", () => {
  it("commits UNKNOWN to NONE_KNOWN with one Patient revision and timestamp-aligned evidence", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    const response = await postIntake(test, patientId);

    expect(response.statusCode).toBe(201);
    const data = response.json().data;
    expect(data).toMatchObject({
      patient: { id: patientId, revision: 2 },
      allergy: {
        revision: 1,
        state: "NONE_KNOWN",
        items: [],
        sourceText: "ผู้ป่วยตอบระหว่าง Intake",
        reason: "ทบทวนก่อนส่งเข้าคิว",
        reviewedAt: "2026-08-03T00:00:00.000Z",
      },
    });
    const observation = test.database.db.select().from(intakeObservations).get();
    const revision = test.database.db.select().from(patientAllergyRevisions).get();
    const events = test.database.db.select().from(auditEvents).all();
    const allergyAudit = events.find((event) => event.action === "allergy.updated");
    const intakeAudit = events.find((event) => event.action === "visit.intake-submitted");
    expect(observation?.recordedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(revision?.reviewedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(allergyAudit?.occurredAt).toBe("2026-08-03T00:00:00.000Z");
    expect(intakeAudit?.occurredAt).toBe("2026-08-03T00:00:00.000Z");
    expect(JSON.parse(allergyAudit?.metadataJson ?? "{}")).toMatchObject({
      visitId: data.visit.id,
      previousState: "UNKNOWN",
      state: "NONE_KNOWN",
      allergyRevisionId: data.allergy.id,
      allergyRevision: 1,
      itemCount: 0,
    });
    expect(JSON.parse(intakeAudit?.metadataJson ?? "{}")).toMatchObject({
      allergyRevisionId: data.allergy.id,
      allergyState: "NONE_KNOWN",
    });
  });

  it("commits UNKNOWN to PRESENT with ordered allergy items", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    const response = await postIntake(test, patientId, {
      answer: "YES",
      items: [
        { substance: "เพนิซิลลิน", reaction: "ผื่น", severity: "MILD", note: "เฝ้าระวัง" },
        { substance: "ไอบูโพรเฟน", reaction: "หายใจลำบาก", severity: "SEVERE", note: null },
      ],
      changeReason: null,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      patient: { revision: 2 },
      allergy: {
        revision: 1,
        state: "PRESENT",
        items: [
          { substance: "เพนิซิลลิน", reaction: "ผื่น", severity: "MILD", note: "เฝ้าระวัง" },
          { substance: "ไอบูโพรเฟน", reaction: "หายใจลำบาก", severity: "SEVERE", note: null },
        ],
      },
    });
    expect(test.database.db.select().from(patientAllergyItems).all().map((item) => item.position)).toEqual([0, 1]);
  });

  it("requires a reason when a resolved PRESENT assessment changes to NO", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 1,
      visitId: "present-no-first",
      answer: { answer: "YES", items: [singleItem], changeReason: null },
    });

    expect(() => recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 2,
      visitId: "present-no-missing-reason",
      answer: { answer: "NO", items: [], changeReason: null },
    })).toThrow("กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(1);

    const withReason = recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 2,
      visitId: "present-no-with-reason",
      answer: { answer: "NO", items: [], changeReason: "  ทบทวนข้อมูลใหม่  " },
    }) as { patient: { revision: number }; allergy: { revision: number; state: string; reason: string } };
    expect(withReason).toMatchObject({
      patient: { revision: 3 },
      allergy: { revision: 2, state: "NONE_KNOWN", reason: "ทบทวนข้อมูลใหม่" },
    });
  });

  it("requires a reason when a resolved NONE_KNOWN assessment changes to YES", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 1,
      visitId: "none-yes-first",
      answer: { answer: "NO", items: [], changeReason: null },
    });

    expect(() => recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 2,
      visitId: "none-yes-missing-reason",
      answer: { answer: "YES", items: [singleItem], changeReason: null },
    })).toThrow("กรุณาระบุเหตุผลที่ข้อมูลแพ้ยาเปลี่ยน");
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(1);

    const withReason = recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 2,
      visitId: "none-yes-with-reason",
      answer: { answer: "YES", items: [singleItem], changeReason: "พบข้อมูลยาแพ้เพิ่มเติม" },
    }) as { patient: { revision: number }; allergy: { revision: number; state: string; reason: string } };
    expect(withReason).toMatchObject({
      patient: { revision: 3 },
      allergy: { revision: 2, state: "PRESENT", reason: "พบข้อมูลยาแพ้เพิ่มเติม" },
    });
  });

  it("returns a stale Patient CAS revision before validating a conflicting Allergy answer and writes nothing", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 1,
      visitId: "stale-patient-winner",
      answer: { answer: "YES", items: [singleItem], changeReason: null },
    });
    const before = readIntakeEvidence(test);

    const stale = await postIntake(test, patientId, {
      answer: "NO",
      items: [],
      changeReason: null,
    }, "intake-stale-before-reason", "ไอและมีไข้", 1);

    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevisions: { patient: 2 },
    });
    expect(readIntakeEvidence(test)).toEqual(before);
  });

  it("appends a same-state Intake review and increments the current Patient revision exactly once", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 1,
      visitId: "same-state-first",
      answer: { answer: "NO", items: [], changeReason: null },
    });

    const second = recordIntakeAllergy(test, {
      patientId,
      expectedPatientRevision: 2,
      visitId: "same-state-second",
      answer: { answer: "NO", items: [], changeReason: null },
    }) as { patient: { revision: number }; allergy: { revision: number; state: string; reason: string } };
    expect(second).toMatchObject({
      patient: { revision: 3 },
      allergy: { revision: 2, state: "NONE_KNOWN", reason: "ทบทวนก่อนส่งเข้าคิว" },
    });
    expect(test.database.db.select().from(patientAllergyRevisions).all()).toHaveLength(2);
  });

  it("rolls every Intake write boundary back to an identical evidence snapshot", async () => {
    for (const stage of intakeWriteStages) {
      const test = await fixture({
        intakeFailureInjector: (current: string) => {
          if (current === stage) throw new Error(`fail:${stage}`);
        },
      });
      const patientId = await createPatient(test, `intake-rollback-patient-${stage}`);
      const before = readIntakeEvidence(test);

      const response = await postIntake(test, patientId, noAnswer(patientId).payload.allergy, `intake-rollback-${stage}`);

      expect(response.statusCode).toBe(500);
      expect(readIntakeEvidence(test)).toEqual(before);
    }
  });

  it("replays the exact committed Intake data and rejects collision, duplicate, and concurrent writes", async () => {
    const test = await fixture();
    const patientId = await createPatient(test);
    const first = await postIntake(test, patientId, noAnswer(patientId).payload.allergy, "intake-exact-replay");
    const replay = await postIntake(test, patientId, noAnswer(patientId).payload.allergy, "intake-exact-replay", "ไอและมีไข้", 1);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(JSON.stringify(replay.json().data)).toBe(JSON.stringify(first.json().data));

    const beforeCollision = readIntakeEvidence(test);
    const collision = await postIntake(test, patientId, noAnswer(patientId).payload.allergy, "intake-exact-replay", "ปวดหัว", 1);
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(readIntakeEvidence(test)).toEqual(beforeCollision);

    const beforeDuplicate = readIntakeEvidence(test);
    const duplicate = await postIntake(test, patientId, noAnswer(patientId).payload.allergy, "intake-active-duplicate");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACTIVE_VISIT_EXISTS");
    expect(readIntakeEvidence(test)).toEqual(beforeDuplicate);

    const secondPatientId = await createPatient(test, "intake-race-patient");
    const beforeRace = readIntakeEvidence(test);
    const [raceA, raceB] = await Promise.all([
      postIntake(test, secondPatientId, noAnswer(secondPatientId).payload.allergy, "intake-race-a"),
      postIntake(test, secondPatientId, noAnswer(secondPatientId).payload.allergy, "intake-race-b"),
    ]);
    expect([raceA.statusCode, raceB.statusCode].sort()).toEqual([201, 409]);
    expect([raceA.json().error?.code, raceB.json().error?.code]).toContain("ACTIVE_VISIT_EXISTS");
    const afterRace = readIntakeEvidence(test);
    const raceVisit = afterRace.visits.find((visit) => visit.patient_id === secondPatientId);
    expect(afterRace.visits).toHaveLength(beforeRace.visits.length + 1);
    expect(afterRace.intake_observations).toHaveLength(beforeRace.intake_observations.length + 1);
    expect(afterRace.patient_allergy_revisions).toHaveLength(beforeRace.patient_allergy_revisions.length + 1);
    expect(afterRace.patient_allergy_items).toHaveLength(beforeRace.patient_allergy_items.length);
    expect(afterRace.patients).toHaveLength(beforeRace.patients.length);
    expect(afterRace.patients.find((patient) => patient.id === secondPatientId)).toMatchObject({ revision: 2 });
    expect(afterRace.audit_events).toHaveLength(beforeRace.audit_events.length + 2);
    expect(afterRace.idempotency_records).toHaveLength(beforeRace.idempotency_records.length + 1);
    expect(raceVisit).toBeDefined();
    expect(afterRace.intake_observations.filter((observation) => observation.visit_id === raceVisit?.id)).toHaveLength(1);
    expect(afterRace.patient_allergy_revisions.filter((revision) => revision.patient_id === secondPatientId)).toHaveLength(1);
    expect(afterRace.audit_events.slice(beforeRace.audit_events.length).map((event) => event.action).sort())
      .toEqual(["allergy.updated", "visit.intake-submitted"]);
    expect(afterRace.idempotency_records.slice(beforeRace.idempotency_records.length).map((row) => row.key))
      .toHaveLength(1);
    expect(afterRace.idempotency_records.slice(beforeRace.idempotency_records.length)[0]?.key)
      .toMatch(/^(intake-race-a|intake-race-b)$/);
  });
});
