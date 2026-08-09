import { afterEach, describe, expect, it } from "vitest";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "c".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

type CompletionFixture = Awaited<ReturnType<typeof createTestApp>> & {
  doctorCookie: string;
  assistantCookie: string;
};

interface CheckoutData {
  charge: { id: string } | null;
  visit: { id: string; status: string; revision: number; closedAt: string | null };
}

interface ReadyToCloseData {
  checkout: CheckoutData;
  paymentId: string;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function fixture(overrides: { beforeVisitCloseTransition?: () => void } = {}): Promise<CompletionFixture> {
  const test = await createTestApp({
    clock: () => new Date(NOW),
    idFactory: sequence("visit-completion-route"),
    ...overrides,
  });
  cleanups.push(test.cleanup);
  const doctor = await seedAccount(test.database, {
    id: "visit-completion-doctor",
    username: "visit-completion-doctor",
    role: "doctor",
    displayName: "พญ. ปิด Visit",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(test.database, {
    id: "visit-completion-assistant",
    username: "visit-completion-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยการเงิน",
    mustChangePassword: false,
  });
  test.database.sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'visit-completion-patient', 'clinic', 'DEMO-000018', 'ผู้ป่วยทดสอบ 000018', '0000000018',
      '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      'visit-completion-visit', 'clinic', 'visit-completion-patient', 'AWAITING_CHARGE',
      'ทดสอบปิด Visit', 7, '${NOW}', '${NOW}', 'visit-completion-doctor'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'visit-completion-note', 'visit-completion-visit', 1, 'S: ปวดศีรษะ', 'O: ปกติ',
      'A: ปวดศีรษะ', 'P: พักผ่อน', 1, 'visit-completion-doctor', 'พญ. ปิด Visit',
      '${NOW}', '${HASH}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('visit-completion-diagnosis', 'visit-completion-note', 0, 'ปวดศีรษะ');
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'visit-completion-decision', 'visit-completion-visit', 1, 'NO_MEDICATION',
      'ไม่มีข้อบ่งใช้ยา', NULL, NULL, 'visit-completion-doctor', 'พญ. ปิด Visit',
      '${NOW}', '${HASH}'
    );
  `);
  return {
    ...test,
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
  };
}

async function readyToClose(test: CompletionFixture): Promise<ReadyToCloseData> {
  const finalized = await test.app.inject({
    method: "POST",
    url: "/api/checkout/visit-completion-visit/charge-finalizations",
    headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-finalize" },
    payload: {
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "COLLECT" },
    },
  });
  expect(finalized.statusCode).toBe(201);
  const charge = (finalized.json() as { data: CheckoutData }).data.charge;
  if (!charge) throw new Error("Fixture Charge was not finalized");
  const collected = await test.app.inject({
    method: "POST",
    url: "/api/checkout/visit-completion-visit/payments/cash",
    headers: { cookie: test.assistantCookie, "idempotency-key": "visit-completion-cash" },
    payload: {
      expectedRevisions: { visit: 8 },
      payload: { chargeId: charge.id, amountBaht: 100 },
    },
  });
  expect(collected.statusCode).toBe(201);
  const paymentId = test.database.sqlite.prepare(
    "SELECT id FROM finance_payments WHERE visit_id = 'visit-completion-visit'",
  ).pluck().get();
  if (typeof paymentId !== "string") throw new Error("Fixture payment was not collected");
  return { checkout: (collected.json() as { data: CheckoutData }).data, paymentId };
}

describe("Doctor Visit close route", () => {
  it("closes one exact resolved Visit atomically and safely replays the immutable Closure", async () => {
    const test = await fixture();
    const ready = await readyToClose(test);
    expect(ready.checkout.charge).not.toBeNull();
    if (!ready.checkout.charge) return;

    const body = {
      expectedRevisions: { visit: 9 },
      payload: {
        chargeId: ready.checkout.charge.id,
        resolution: { kind: "PAYMENT", paymentId: ready.paymentId },
      },
    };
    const first = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-close" },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    if (first.statusCode !== 201) return;
    const result = first.json() as { replayed: boolean; data: { id: string; closedAt: string; visit: { status: string; revision: number; closedAt: string } } };
    expect(result).toMatchObject({
      replayed: false,
      data: { visit: { status: "CLOSED", revision: 10 } },
    });
    expect(result.data.closedAt).toBe(result.data.visit.closedAt);
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(1);
    expect(test.database.sqlite.prepare("SELECT status, revision, closed_at FROM visits WHERE id = 'visit-completion-visit'").get()).toEqual({
      status: "CLOSED", revision: 10, closed_at: result.data.closedAt,
    });

    const replay = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-close" },
      payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, data: { id: result.data.id } });
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(1);

    const collision = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-close" },
      payload: { ...body, payload: { ...body.payload, resolution: { kind: "PAYMENT", paymentId: "forged-payment" } } },
    });
    expect(collision.statusCode).toBe(409);
    expect((collision.json() as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(1);
  });

  it("returns stable close blockers without partial evidence for unresolved collection or forged resolution IDs", async () => {
    const test = await fixture();
    const finalized = await test.app.inject({
      method: "POST",
      url: "/api/checkout/visit-completion-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-blocker-finalize" },
      payload: { expectedRevisions: { visit: 7, clinicPricing: 1 }, payload: { settlementIntent: "COLLECT" } },
    });
    expect(finalized.statusCode).toBe(201);
    const charge = (finalized.json() as { data: CheckoutData }).data.charge;
    if (!charge) throw new Error("Fixture Charge was not finalized");

    const unresolved = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-unresolved" },
      payload: {
        expectedRevisions: { visit: 8 },
        payload: { chargeId: charge.id, resolution: { kind: "PAYMENT", paymentId: "forged-payment" } },
      },
    });
    expect(unresolved.statusCode).toBe(409);
    expect(unresolved.json()).toMatchObject({ error: { code: "VISIT_CLOSE_BLOCKED", fieldErrors: { visitState: expect.any(String) } } });
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);

    const collected = await test.app.inject({
      method: "POST",
      url: "/api/checkout/visit-completion-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "visit-completion-blocker-cash" },
      payload: { expectedRevisions: { visit: 8 }, payload: { chargeId: charge.id, amountBaht: 100 } },
    });
    expect(collected.statusCode).toBe(201);
    const paymentId = test.database.sqlite.prepare(
      "SELECT id FROM finance_payments WHERE visit_id = 'visit-completion-visit'",
    ).pluck().get();
    if (typeof paymentId !== "string") throw new Error("Fixture payment was not collected");
    const forgedCharge = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-forged-charge" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: { chargeId: "forged-charge", resolution: { kind: "PAYMENT", paymentId } },
      },
    });
    expect(forgedCharge.statusCode).toBe(409);
    expect(forgedCharge.json()).toMatchObject({ error: { code: "VISIT_CLOSE_BLOCKED", fieldErrors: { charge: expect.any(String) } } });

    const forgedPayment = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-forged-payment" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: { chargeId: charge.id, resolution: { kind: "PAYMENT", paymentId: "forged-payment" } },
      },
    });
    expect(forgedPayment.statusCode).toBe(409);
    expect(forgedPayment.json()).toMatchObject({ error: { code: "VISIT_CLOSE_BLOCKED", fieldErrors: { collection: expect.any(String) } } });
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
    expect(test.database.sqlite.prepare("SELECT status, revision, closed_at FROM visits WHERE id = 'visit-completion-visit'").get()).toEqual({
      status: "READY_TO_CLOSE", revision: 9, closed_at: null,
    });
  });

  it("rolls back the inserted Closure, Visit transition, audit, and idempotency record when close fails mid-transaction", async () => {
    const test = await fixture({ beforeVisitCloseTransition: () => { throw new Error("injected close transition failure"); } });
    const ready = await readyToClose(test);
    if (!ready.checkout.charge) throw new Error("Fixture Charge was not finalized");
    const response = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-rollback" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: { chargeId: ready.checkout.charge.id, resolution: { kind: "PAYMENT", paymentId: ready.paymentId } },
      },
    });
    expect(response.statusCode).toBe(500);
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
    expect(test.database.sqlite.prepare("SELECT status, revision, closed_at FROM visits WHERE id = 'visit-completion-visit'").get()).toEqual({
      status: "READY_TO_CLOSE", revision: 9, closed_at: null,
    });
    expect(test.database.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action = 'visit.closed'").pluck().get()).toBe(0);
    expect(test.database.sqlite.prepare("SELECT count(*) FROM idempotency_records WHERE key = 'visit-completion-rollback'").pluck().get()).toBe(0);
  });

  it("denies an Assistant before a direct close request can read clinical evidence", async () => {
    const test = await fixture();
    const response = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.assistantCookie, "idempotency-key": "visit-completion-assistant-close" },
      payload: {
        expectedRevisions: { visit: 7 },
        payload: {
          chargeId: "forged-charge",
          resolution: { kind: "PAYMENT", paymentId: "forged-payment" },
        },
      },
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
  });
});
