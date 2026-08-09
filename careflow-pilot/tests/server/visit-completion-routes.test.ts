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

interface WaivedReadyToCloseData {
  checkout: CheckoutData;
  adjustmentId: string;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

type VisitCloseWriteStage =
  | "AFTER_CLOSURE_INSERT"
  | "AFTER_VISIT_TRANSITION"
  | "AFTER_AUDIT_APPEND"
  | "AFTER_IDEMPOTENCY_INSERT";

async function fixture(overrides: {
  beforeVisitCloseTransition?: () => void;
  visitCloseFailureInjector?: (stage: VisitCloseWriteStage) => void;
} = {}): Promise<CompletionFixture> {
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

async function readyToCloseWithWaiver(test: CompletionFixture): Promise<WaivedReadyToCloseData> {
  const finalized = await test.app.inject({
    method: "POST",
    url: "/api/checkout/visit-completion-visit/charge-finalizations",
    headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-waiver-finalize" },
    payload: {
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "FULL_WAIVER", waiverReason: "ผู้ป่วยได้รับยกเว้นเต็มจำนวน" },
    },
  });
  expect(finalized.statusCode).toBe(201);
  const checkout = (finalized.json() as { data: CheckoutData }).data;
  const adjustmentId = test.database.sqlite.prepare(
    "SELECT id FROM finance_charge_adjustments",
  ).pluck().get();
  if (!checkout.charge || typeof adjustmentId !== "string") {
    throw new Error("Fixture full waiver was not finalized");
  }
  return { checkout, adjustmentId };
}

function expectCloseBlocker(
  response: { statusCode: number; json(): { error: { code: string; fieldErrors?: Record<string, string> } } },
  field: "charge" | "collection" | "visitState",
): void {
  expect(response.statusCode).toBe(409);
  const error = response.json().error;
  expect(error.code).toBe("VISIT_CLOSE_BLOCKED");
  expect(error.fieldErrors).toEqual({
    [field]: field === "charge"
      ? "ต้องมีหลักฐาน Charge ที่สมบูรณ์"
      : field === "collection"
        ? "ต้องมีหลักฐานการชำระหรือยกเว้นที่ตรงกัน"
        : "สถานะ Visit ยังไม่พร้อมปิด",
  });
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

  it("classifies a persisted Payment amount mismatch as collection evidence, not Charge evidence", async () => {
    const test = await fixture();
    const ready = await readyToClose(test);
    if (!ready.checkout.charge) throw new Error("Fixture Charge was not finalized");
    test.database.sqlite.exec("DROP TRIGGER finance_payments_block_update;");
    test.database.sqlite.prepare(
      "UPDATE finance_payments SET amount_baht = 99 WHERE id = ?",
    ).run(ready.paymentId);

    const response = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-payment-mismatch" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: {
          chargeId: ready.checkout.charge.id,
          resolution: { kind: "PAYMENT", paymentId: ready.paymentId },
        },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "VISIT_CLOSE_BLOCKED",
        fieldErrors: { collection: "ต้องมีหลักฐานการชำระหรือยกเว้นที่ตรงกัน" },
      },
    });
    expect(response.json().error.fieldErrors).not.toHaveProperty("charge");
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
  });

  it("returns the exact charge blocker for absent and incomplete Charge evidence", async () => {
    const absent = await fixture();
    absent.database.sqlite.prepare(
      "UPDATE visits SET status = 'READY_TO_CLOSE', revision = 8 WHERE id = 'visit-completion-visit'",
    ).run();
    const absentResponse = await absent.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: absent.doctorCookie, "idempotency-key": "visit-completion-charge-absent" },
      payload: {
        expectedRevisions: { visit: 8 },
        payload: {
          chargeId: "missing-charge",
          resolution: { kind: "PAYMENT", paymentId: "missing-payment" },
        },
      },
    });
    expectCloseBlocker(absentResponse, "charge");

    const incomplete = await fixture();
    const finalized = await incomplete.app.inject({
      method: "POST",
      url: "/api/checkout/visit-completion-visit/charge-finalizations",
      headers: { cookie: incomplete.doctorCookie, "idempotency-key": "visit-completion-charge-incomplete-finalize" },
      payload: {
        expectedRevisions: { visit: 7, clinicPricing: 1 },
        payload: { settlementIntent: "COLLECT" },
      },
    });
    expect(finalized.statusCode).toBe(201);
    const charge = (finalized.json() as { data: CheckoutData }).data.charge;
    if (!charge) throw new Error("Fixture Charge was not finalized");
    incomplete.database.sqlite.exec("DROP TRIGGER finance_charge_lines_block_delete;");
    incomplete.database.sqlite.prepare("DELETE FROM finance_charge_lines WHERE charge_id = ?").run(charge.id);
    incomplete.database.sqlite.prepare(
      "UPDATE visits SET status = 'READY_TO_CLOSE', revision = 9 WHERE id = 'visit-completion-visit'",
    ).run();
    const incompleteResponse = await incomplete.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: incomplete.doctorCookie, "idempotency-key": "visit-completion-charge-incomplete" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: {
          chargeId: charge.id,
          resolution: { kind: "PAYMENT", paymentId: "missing-payment" },
        },
      },
    });
    expectCloseBlocker(incompleteResponse, "charge");
    expect(incomplete.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
  });

  it("returns the exact collection blocker for a non-full waiver or both persisted resolutions", async () => {
    const nonFullWaiver = await fixture();
    const waived = await readyToCloseWithWaiver(nonFullWaiver);
    if (!waived.checkout.charge) throw new Error("Fixture Charge was not finalized");
    nonFullWaiver.database.sqlite.exec("DROP TRIGGER finance_charge_adjustments_block_update;");
    nonFullWaiver.database.sqlite.prepare(
      "UPDATE finance_charge_adjustments SET amount_baht = -99 WHERE id = ?",
    ).run(waived.adjustmentId);
    const nonFullResponse = await nonFullWaiver.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: nonFullWaiver.doctorCookie, "idempotency-key": "visit-completion-non-full-waiver" },
      payload: {
        expectedRevisions: { visit: 8 },
        payload: {
          chargeId: waived.checkout.charge.id,
          resolution: { kind: "COLLECTION_NOT_REQUIRED", waiverAdjustmentId: waived.adjustmentId },
        },
      },
    });
    expectCloseBlocker(nonFullResponse, "collection");

    const both = await fixture();
    const paid = await readyToClose(both);
    if (!paid.checkout.charge) throw new Error("Fixture Charge was not finalized");
    both.database.sqlite.exec("DROP TRIGGER finance_charge_adjustments_source_guard;");
    both.database.sqlite.prepare(`
      INSERT INTO finance_charge_adjustments (
        id, charge_id, kind, amount_baht, reason, approved_by,
        approved_by_display_name, approved_at, content_hash
      ) VALUES (?, ?, 'FULL_WAIVER', -100, 'หลักฐานทุจริต', ?, ?, ?, ?)
    `).run(
      "visit-completion-illegal-adjustment",
      paid.checkout.charge.id,
      "visit-completion-doctor",
      "พญ. ปิด Visit",
      NOW,
      HASH,
    );
    const bothResponse = await both.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: both.doctorCookie, "idempotency-key": "visit-completion-both-resolutions" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: {
          chargeId: paid.checkout.charge.id,
          resolution: { kind: "PAYMENT", paymentId: paid.paymentId },
        },
      },
    });
    expectCloseBlocker(bothResponse, "collection");
    expect(both.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
  });

  it("distinguishes pending workflow, stale revision, and different-key reopen attempts", async () => {
    const pending = await fixture();
    const pendingResponse = await pending.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: pending.doctorCookie, "idempotency-key": "visit-completion-pending-workflow" },
      payload: {
        expectedRevisions: { visit: 7 },
        payload: {
          chargeId: "missing-charge",
          resolution: { kind: "PAYMENT", paymentId: "missing-payment" },
        },
      },
    });
    expectCloseBlocker(pendingResponse, "visitState");

    const closed = await fixture();
    const ready = await readyToClose(closed);
    if (!ready.checkout.charge) throw new Error("Fixture Charge was not finalized");
    const body = {
      expectedRevisions: { visit: 9 },
      payload: {
        chargeId: ready.checkout.charge.id,
        resolution: { kind: "PAYMENT" as const, paymentId: ready.paymentId },
      },
    };
    const stale = await closed.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: closed.doctorCookie, "idempotency-key": "visit-completion-stale-before-close" },
      payload: { ...body, expectedRevisions: { visit: 8 } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevisions: { visit: 9 },
    });

    const first = await closed.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: closed.doctorCookie, "idempotency-key": "visit-completion-first-before-reopen" },
      payload: body,
    });
    expect(first.statusCode).toBe(201);
    const differentKey = await closed.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: closed.doctorCookie, "idempotency-key": "visit-completion-different-key-reopen" },
      payload: body,
    });
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevisions: { visit: 10 },
    });
    const currentRevisionReopen = await closed.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: closed.doctorCookie, "idempotency-key": "visit-completion-current-revision-reopen" },
      payload: { ...body, expectedRevisions: { visit: 10 } },
    });
    expectCloseBlocker(currentRevisionReopen, "visitState");
    expect(closed.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(1);
  });

  it("closes a full-waiver resolution without creating or pinning a Payment", async () => {
    const test = await fixture();
    const ready = await readyToCloseWithWaiver(test);
    if (!ready.checkout.charge) throw new Error("Fixture Charge was not finalized");
    const response = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": "visit-completion-waiver-close" },
      payload: {
        expectedRevisions: { visit: 8 },
        payload: {
          chargeId: ready.checkout.charge.id,
          resolution: {
            kind: "COLLECTION_NOT_REQUIRED",
            waiverAdjustmentId: ready.adjustmentId,
          },
        },
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.resolution).toEqual({
      kind: "COLLECTION_NOT_REQUIRED",
      waiverAdjustmentId: ready.adjustmentId,
    });
    expect(test.database.sqlite.prepare(
      "SELECT payment_id, waiver_adjustment_id FROM visit_closures",
    ).get()).toEqual({ payment_id: null, waiver_adjustment_id: ready.adjustmentId });
    expect(test.database.sqlite.prepare("SELECT count(*) FROM finance_payments").pluck().get()).toBe(0);
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

  it.each([
    "AFTER_CLOSURE_INSERT",
    "AFTER_VISIT_TRANSITION",
    "AFTER_AUDIT_APPEND",
    "AFTER_IDEMPOTENCY_INSERT",
  ] as const)("rolls back every close write after injected %s failure", async (failedStage) => {
    const test = await fixture({
      visitCloseFailureInjector: (stage) => {
        if (stage === failedStage) throw new Error(`injected ${stage} failure`);
      },
    });
    const ready = await readyToClose(test);
    if (!ready.checkout.charge) throw new Error("Fixture Charge was not finalized");
    const key = `visit-completion-rollback-${failedStage.toLowerCase()}`;
    const response = await test.app.inject({
      method: "POST",
      url: "/api/visits/visit-completion-visit/close",
      headers: { cookie: test.doctorCookie, "idempotency-key": key },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: {
          chargeId: ready.checkout.charge.id,
          resolution: { kind: "PAYMENT", paymentId: ready.paymentId },
        },
      },
    });
    expect(response.statusCode).toBe(500);
    expect(test.database.sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
    expect(test.database.sqlite.prepare(
      "SELECT status, revision, closed_at FROM visits WHERE id = 'visit-completion-visit'",
    ).get()).toEqual({ status: "READY_TO_CLOSE", revision: 9, closed_at: null });
    expect(test.database.sqlite.prepare(
      "SELECT count(*) FROM audit_events WHERE action = 'visit.closed'",
    ).pluck().get()).toBe(0);
    expect(test.database.sqlite.prepare(
      "SELECT count(*) FROM idempotency_records WHERE key = ?",
    ).pluck().get(key)).toBe(0);
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
