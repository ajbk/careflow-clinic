import { afterEach, describe, expect, it } from "vitest";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "d".repeat(64);
const cleanups: Array<() => Promise<void>> = [];
const terminalCollectionFailures = [
  { name: "payment", endpoint: "cash", trigger: "finance_collection_fail_payment", table: "finance_payments", statement: "BEFORE INSERT ON finance_payments" },
  { name: "waiver", endpoint: "waiver", trigger: "finance_collection_fail_waiver", table: "finance_charge_adjustments", statement: "BEFORE INSERT ON finance_charge_adjustments" },
  { name: "audit", endpoint: "cash", trigger: "finance_collection_fail_audit", table: "audit_events", statement: "BEFORE INSERT ON audit_events" },
  { name: "visit", endpoint: "cash", trigger: "finance_collection_fail_visit", table: "visits", statement: "BEFORE UPDATE OF status ON visits" },
  { name: "idempotency", endpoint: "cash", trigger: "finance_collection_fail_idempotency", table: "idempotency_records", statement: "BEFORE INSERT ON idempotency_records" },
] as const;

type FinanceFixture = Awaited<ReturnType<typeof createTestApp>> & {
  doctorCookie: string;
  assistantCookie: string;
};

interface CheckoutData {
  charge: { id: string } | null;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function countRows(test: FinanceFixture, table: string): number {
  const row = test.database.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

async function fixture(input: { idPrefix?: string } = {}): Promise<FinanceFixture> {
  const test = await createTestApp({ idFactory: sequence(input.idPrefix ?? "finance-concurrency-id") });
  cleanups.push(test.cleanup);
  const doctor = await seedAccount(test.database, {
    id: "finance-concurrency-doctor",
    username: "finance-concurrency-doctor",
    role: "doctor",
    displayName: "พญ. แข่งรับชำระ",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(test.database, {
    id: "finance-concurrency-assistant",
    username: "finance-concurrency-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยแข่งรับชำระ",
    mustChangePassword: false,
  });
  test.database.sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'finance-concurrency-patient', 'clinic', 'DEMO-000013', 'ผู้ป่วยทดสอบ 000013', '0000000013',
      '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      'finance-concurrency-visit', 'clinic', 'finance-concurrency-patient', 'AWAITING_CHARGE',
      'ทดสอบการแข่งรับชำระ', 7, '${NOW}', '${NOW}', 'finance-concurrency-doctor'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-concurrency-note', 'finance-concurrency-visit', 1, 'secret subjective', 'secret objective',
      'secret assessment', 'secret plan', 1, 'finance-concurrency-doctor', 'พญ. แข่งรับชำระ',
      '${NOW}', '${HASH}'
    );
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-concurrency-decision', 'finance-concurrency-visit', 1, 'NO_MEDICATION',
      'ไม่มีข้อบ่งใช้ยา', NULL, NULL, 'finance-concurrency-doctor', 'พญ. แข่งรับชำระ',
      '${NOW}', '${HASH}'
    );
  `);
  return {
    ...test,
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
  };
}

async function finalize(test: FinanceFixture, key = "finance-concurrency-finalize"): Promise<string> {
  const response = await test.app.inject({
    method: "POST",
    url: "/api/checkout/finance-concurrency-visit/charge-finalizations",
    headers: { cookie: test.doctorCookie, "idempotency-key": key },
    payload: {
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "COLLECT" },
    },
  });
  expect(response.statusCode).toBe(201);
  if (response.statusCode !== 201) throw new Error("Unable to finalize fixture Charge");
  const data = (response.json() as { data: CheckoutData }).data;
  if (!data.charge) throw new Error("Expected Charge evidence");
  return data.charge.id;
}

function cashBody(chargeId: string, amountBaht = 100, visitRevision = 8) {
  return { expectedRevisions: { visit: visitRevision }, payload: { chargeId, amountBaht } };
}

function promptPayBody(chargeId: string, amountBaht = 100, visitRevision = 8) {
  return {
    expectedRevisions: { visit: visitRevision },
    payload: { chargeId, amountBaht, manualReference: "PP-RACE-001" },
  };
}

function waiverBody(chargeId: string, visitRevision = 8) {
  return {
    expectedRevisions: { visit: visitRevision },
    payload: { chargeId, reason: "ยกเว้นเพื่อทดสอบการแข่งขัน" },
  };
}

describe("terminal collection concurrency and idempotency", () => {
  it("returns a 201 first Cash envelope, a byte-equivalent 200 replay, and no different-key duplicate", async () => {
    const test = await fixture();
    const chargeId = await finalize(test);
    const first = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-replay" },
      payload: cashBody(chargeId),
    });
    expect(first.statusCode).toBe(201);
    if (first.statusCode !== 201) return;

    const replay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-replay" },
      payload: cashBody(chargeId),
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { replayed: boolean }).replayed).toBe(true);
    expect(JSON.stringify((replay.json() as { data: unknown }).data))
      .toBe(JSON.stringify((first.json() as { data: unknown }).data));

    const collision = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-replay" },
      payload: cashBody(chargeId, 99),
    });
    expect(collision.statusCode).toBe(409);
    expect((collision.json() as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");

    const differentKey = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-second-key" },
      payload: cashBody(chargeId, 100, 9),
    });
    expect(differentKey.statusCode).toBe(409);
    expect((differentKey.json() as { error: { code: string } }).error.code).toBe("PAYMENT_ALREADY_RECORDED");
    expect(countRows(test, "finance_payments")).toBe(1);
    expect(countRows(test, "finance_charge_adjustments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(2);
    expect(countRows(test, "idempotency_records")).toBe(2);
  });

  it("returns a stale revision without payment, waiver, audit, or idempotency writes", async () => {
    const test = await fixture();
    const chargeId = await finalize(test);
    const response = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-cash-stale" },
      payload: cashBody(chargeId, 100, 7),
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { code: string; currentRevisions?: Record<string, number> } }).error)
      .toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { visit: 8 } });
    expect(countRows(test, "finance_payments")).toBe(0);
    expect(countRows(test, "finance_charge_adjustments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(1);
    expect(countRows(test, "idempotency_records")).toBe(1);
  });

  it("never permits a Payment and waiver together", async () => {
    const paid = await fixture({ idPrefix: "finance-paid-then-waiver" });
    const paidCharge = await finalize(paid);
    const cash = await paid.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: paid.doctorCookie, "idempotency-key": "finance-paid-first" },
      payload: cashBody(paidCharge),
    });
    expect(cash.statusCode).toBe(201);
    const lateWaiver = await paid.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/waivers",
      headers: { cookie: paid.doctorCookie, "idempotency-key": "finance-late-waiver" },
      payload: waiverBody(paidCharge, 9),
    });
    expect(lateWaiver.statusCode).toBe(409);
    expect((lateWaiver.json() as { error: { code: string } }).error.code).toBe("WAIVER_NOT_ALLOWED");
    expect(countRows(paid, "finance_payments")).toBe(1);
    expect(countRows(paid, "finance_charge_adjustments")).toBe(0);

    const waived = await fixture({ idPrefix: "finance-waived-then-paid" });
    const waivedCharge = await finalize(waived);
    const waiver = await waived.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/waivers",
      headers: { cookie: waived.doctorCookie, "idempotency-key": "finance-waiver-first" },
      payload: waiverBody(waivedCharge),
    });
    expect(waiver.statusCode).toBe(201);
    const lateCash = await waived.app.inject({
      method: "POST",
      url: "/api/checkout/finance-concurrency-visit/payments/cash",
      headers: { cookie: waived.doctorCookie, "idempotency-key": "finance-late-cash" },
      payload: cashBody(waivedCharge, 100, 9),
    });
    expect(lateCash.statusCode).toBe(409);
    expect((lateCash.json() as { error: { code: string } }).error.code).toBe("PAYMENT_ALREADY_RECORDED");
    expect(countRows(waived, "finance_payments")).toBe(0);
    expect(countRows(waived, "finance_charge_adjustments")).toBe(1);
  });

  it("permits at most one winner when Cash, PromptPay, and waiver race", async () => {
    const test = await fixture();
    const chargeId = await finalize(test);
    const [cash, promptPay, waiver] = await Promise.all([
      test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-concurrency-visit/payments/cash",
        headers: { cookie: test.assistantCookie, "idempotency-key": "finance-race-cash" },
        payload: cashBody(chargeId),
      }),
      test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-concurrency-visit/payments/promptpay",
        headers: { cookie: test.doctorCookie, "idempotency-key": "finance-race-promptpay" },
        payload: promptPayBody(chargeId),
      }),
      test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-concurrency-visit/waivers",
        headers: { cookie: test.doctorCookie, "idempotency-key": "finance-race-waiver" },
        payload: waiverBody(chargeId),
      }),
    ]);
    expect([cash.statusCode, promptPay.statusCode, waiver.statusCode].sort()).toEqual([201, 409, 409]);
    expect(countRows(test, "finance_payments") + countRows(test, "finance_charge_adjustments")).toBe(1);
    expect(countRows(test, "audit_events")).toBe(2);
    expect(test.database.sqlite.prepare(`
      SELECT status, revision FROM visits WHERE id = 'finance-concurrency-visit'
    `).get()).toEqual({ status: "READY_TO_CLOSE", revision: 9 });
  });

  it.each(terminalCollectionFailures)(
    "rolls back every terminal collection write if an evidence, audit, Visit, or idempotency write fails at $name",
    async (failure) => {
      const test = await fixture({ idPrefix: `finance-rollback-${failure.name}` });
      const chargeId = await finalize(test, `finance-rollback-finalize-${failure.name}`);
      test.database.sqlite.exec(`
        CREATE TRIGGER ${failure.trigger} ${failure.statement}
        BEGIN
          SELECT RAISE(ABORT, '${failure.name} injection');
        END;
      `);
      const response = await test.app.inject({
        method: "POST",
        url: failure.endpoint === "waiver"
          ? "/api/checkout/finance-concurrency-visit/waivers"
          : "/api/checkout/finance-concurrency-visit/payments/cash",
        headers: { cookie: test.doctorCookie, "idempotency-key": `finance-rollback-${failure.name}` },
        payload: failure.endpoint === "waiver" ? waiverBody(chargeId) : cashBody(chargeId),
      });
      expect(response.statusCode, failure.name).toBe(500);
      expect(countRows(test, "finance_payments"), failure.name).toBe(0);
      expect(countRows(test, "finance_charge_adjustments"), failure.name).toBe(0);
      expect(countRows(test, "audit_events"), failure.name).toBe(1);
      expect(countRows(test, "idempotency_records"), failure.name).toBe(1);
      expect(test.database.sqlite.prepare(`
        SELECT status, revision FROM visits WHERE id = 'finance-concurrency-visit'
      `).get(), failure.name).toEqual({ status: "AWAITING_PAYMENT", revision: 8 });
    },
  );
});
