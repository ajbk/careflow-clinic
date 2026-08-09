import { afterEach, describe, expect, it } from "vitest";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "d".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

type CompletionFixture = Awaited<ReturnType<typeof createTestApp>> & {
  doctorCookie: string;
  assistantCookie: string;
};

interface CheckoutData {
  charge: { id: string } | null;
  visit: { id: string; revision: number; status: string; closedAt: string | null };
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(): Promise<CompletionFixture> {
  const test = await createTestApp({
    clock: () => new Date(NOW),
    idFactory: sequence("visit-completion"),
  });
  cleanups.push(test.cleanup);
  const doctor = await seedAccount(test.database, {
    id: "completion-doctor",
    username: "completion-doctor",
    role: "doctor",
    displayName: "พญ. หลักฐาน OPD",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(test.database, {
    id: "completion-assistant",
    username: "completion-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยการเงิน OPD",
    mustChangePassword: false,
  });
  test.database.sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'completion-patient', 'clinic', 'DEMO-000019', 'ผู้ป่วยทดสอบ 000019', '0000000019',
      '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      'completion-visit', 'clinic', 'completion-patient', 'AWAITING_CHARGE',
      'ปวดศีรษะจากการทดสอบ', 7, '${NOW}', '${NOW}', 'completion-doctor'
    );
    INSERT INTO intake_observations (
      id, visit_id, weight_kg, height_cm, temperature_c, systolic_mmhg, diastolic_mmhg,
      heart_rate_bpm, spo2_percent, recorded_by, recorded_at
    ) VALUES (
      'completion-observation', 'completion-visit', 60, 160, 36.5, 120, 80, 72, 99,
      'completion-doctor', '${NOW}'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'completion-note', 'completion-visit', 1, 'S: ปวดศีรษะ', 'O: ปกติ',
      'A: ปวดศีรษะจากความเครียด', 'P: พักผ่อน', 1, 'completion-doctor', 'พญ. หลักฐาน OPD',
      '${NOW}', '${HASH}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('completion-diagnosis', 'completion-note', 0, 'ปวดศีรษะ');
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'completion-decision', 'completion-visit', 1, 'NO_MEDICATION',
      'ไม่มีข้อบ่งใช้ยา', NULL, NULL, 'completion-doctor', 'พญ. หลักฐาน OPD',
      '${NOW}', '${HASH}'
    );
  `);
  return {
    ...test,
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
  };
}

async function close(test: CompletionFixture): Promise<{ closureId: string; contentHash: string }> {
  const finalized = await test.app.inject({
    method: "POST",
    url: "/api/checkout/completion-visit/charge-finalizations",
    headers: { cookie: test.doctorCookie, "idempotency-key": "completion-finalize" },
    payload: { expectedRevisions: { visit: 7, clinicPricing: 1 }, payload: { settlementIntent: "COLLECT" } },
  });
  expect(finalized.statusCode).toBe(201);
  const charge = (finalized.json() as { data: CheckoutData }).data.charge;
  if (!charge) throw new Error("Fixture finalization did not create Charge");
  const cash = await test.app.inject({
    method: "POST",
    url: "/api/checkout/completion-visit/payments/cash",
    headers: { cookie: test.assistantCookie, "idempotency-key": "completion-cash" },
    payload: { expectedRevisions: { visit: 8 }, payload: { chargeId: charge.id, amountBaht: 100 } },
  });
  expect(cash.statusCode).toBe(201);
  const paymentId = test.database.sqlite.prepare(
    "SELECT id FROM finance_payments WHERE visit_id = 'completion-visit'",
  ).pluck().get();
  if (typeof paymentId !== "string") throw new Error("Fixture Cash did not create Payment");
  const firstClose = await test.app.inject({
    method: "POST",
    url: "/api/visits/completion-visit/close",
    headers: { cookie: test.doctorCookie, "idempotency-key": "completion-close" },
    payload: {
      expectedRevisions: { visit: 9 },
      payload: { chargeId: charge.id, resolution: { kind: "PAYMENT", paymentId } },
    },
  });
  expect(firstClose.statusCode).toBe(201);
  const data = (firstClose.json() as { data: { id: string; contentHash: string } }).data;
  return { closureId: data.id, contentHash: data.contentHash };
}

describe("Visit completion evidence, privacy, and freeze", () => {
  it("keeps Checkout free of clinical prose, diagnoses, plans, and hashes for Assistant finance reads", async () => {
    const test = await fixture();
    await close(test);
    const checkout = await test.app.inject({
      method: "GET",
      url: "/api/checkout/completion-visit",
      headers: { cookie: test.assistantCookie },
    });
    expect(checkout.statusCode).toBe(200);
    const serialized = JSON.stringify(checkout.json().data);
    expect(serialized).not.toMatch(/S: ปวดศีรษะ|A: ปวดศีรษะ|พักผ่อน|วินิจฉัย|diagnos/i);
    expect(serialized).not.toMatch(/[a-f0-9]{64}/i);
  });

  it("projects Doctor-only structured OPD evidence from frozen snapshots and appends a Doctor addendum", async () => {
    const test = await fixture();
    const closure = await close(test);

    const assistant = await test.app.inject({
      method: "GET",
      url: "/api/visits/completion-visit/opd-card",
      headers: { cookie: test.assistantCookie },
    });
    expect(assistant.statusCode).toBe(403);
    expect(JSON.stringify(assistant.json())).not.toMatch(/ปวดศีรษะ|พักผ่อน|[a-f0-9]{64}/i);

    const assistantAmendment = await test.app.inject({
      method: "POST",
      url: "/api/clinical-notes/completion-note/amendments",
      headers: { cookie: test.assistantCookie, "idempotency-key": "completion-assistant-amendment" },
      payload: {
        expectedRevisions: { amendment: 0 },
        payload: { content: "ปลอมแปลง", reason: "ไม่มีสิทธิ์" },
      },
    });
    expect(assistantAmendment.statusCode).toBe(403);

    test.database.sqlite.exec(`
      UPDATE clinic_config SET name = 'คลินิก master ใหม่' WHERE id = 'clinic';
      UPDATE staff_accounts SET display_name = 'พญ. master ใหม่' WHERE id = 'completion-doctor';
    `);
    const firstCard = await test.app.inject({
      method: "GET",
      url: "/api/visits/completion-visit/opd-card",
      headers: { cookie: test.doctorCookie },
    });
    expect(firstCard.statusCode).toBe(200);
    const card = firstCard.json().data;
    expect(card).toMatchObject({
      syntheticOnly: true,
      closure: {
        id: closure.closureId,
        contentHash: closure.contentHash,
        clinic: { name: "คลินิกชนบท CareFlow Pilot" },
        patient: { displayName: "ผู้ป่วยทดสอบ 000019", hn: "DEMO-000019", birthDate: "1990-01-01" },
        doctor: { displayName: "พญ. หลักฐาน OPD" },
      },
      clinicalNote: { subjective: "S: ปวดศีรษะ", diagnoses: ["ปวดศีรษะ"], plan: "P: พักผ่อน" },
      medication: { kind: "NO_MEDICATION", noMedicationReason: "ไม่มีข้อบ่งใช้ยา" },
      charge: { grossTotalBaht: 100, netDueBaht: 100, resolution: { kind: "PAYMENT", amountBaht: 100 } },
    });

    const amendment = await test.app.inject({
      method: "POST",
      url: "/api/clinical-notes/completion-note/amendments",
      headers: { cookie: test.doctorCookie, "idempotency-key": "completion-amendment" },
      payload: {
        expectedRevisions: { amendment: 0 },
        payload: { content: "ติดตามอาการอีกครั้ง", reason: "เพิ่มคำแนะนำหลังปิด Visit" },
      },
    });
    expect(amendment.statusCode).toBe(201);
    const secondCard = await test.app.inject({
      method: "GET",
      url: "/api/visits/completion-visit/opd-card",
      headers: { cookie: test.doctorCookie },
    });
    expect(secondCard.statusCode).toBe(200);
    expect(secondCard.json().data.closure.contentHash).toBe(closure.contentHash);
    expect(secondCard.json().data.clinicalNote).toEqual(card.clinicalNote);
    expect(secondCard.json().data.amendments).toMatchObject([
      { content: "ติดตามอาการอีกครั้ง", reason: "เพิ่มคำแนะนำหลังปิด Visit", signedBy: { id: "completion-doctor" } },
    ]);
  });

  it("blocks post-close Visit, clinical, finance, and closure mutation at the database boundary", async () => {
    const test = await fixture();
    await close(test);
    expect(() => test.database.sqlite.prepare(
      "UPDATE visits SET chief_complaint = 'เปลี่ยนหลังปิด' WHERE id = 'completion-visit'",
    ).run()).toThrow(/Closure|CLOSED|closed/i);
    expect(() => test.database.sqlite.prepare(`
      INSERT INTO clinical_note_drafts (
        id, visit_id, revision, subjective, objective, assessment, plan,
        created_by, updated_by, created_at, updated_at
      ) VALUES (
        'completion-illegal-draft', 'completion-visit', 1, '', '', '', '',
        'completion-doctor', 'completion-doctor', '${NOW}', '${NOW}'
      )
    `).run()).toThrow(/closed|Closure/i);
    expect(() => test.database.sqlite.prepare(
      "UPDATE intake_observations SET temperature_c = 40 WHERE visit_id = 'completion-visit'",
    ).run()).toThrow(/closed|Closure/i);
    expect(() => test.database.sqlite.prepare(
      "UPDATE finance_payments SET amount_baht = 99 WHERE visit_id = 'completion-visit'",
    ).run()).toThrow(/append-only|closed|Closure/i);
    expect(() => test.database.sqlite.prepare(
      "DELETE FROM visit_closures WHERE visit_id = 'completion-visit'",
    ).run()).toThrow(/append-only/i);
    expect(test.database.sqlite.prepare(
      "SELECT chief_complaint FROM visits WHERE id = 'completion-visit'",
    ).pluck().get()).toBe("ปวดศีรษะจากการทดสอบ");
    expect(test.database.sqlite.prepare(
      "SELECT temperature_c FROM intake_observations WHERE visit_id = 'completion-visit'",
    ).pluck().get()).toBe(36.5);
  });
});
