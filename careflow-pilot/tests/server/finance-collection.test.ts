import { afterEach, describe, expect, it } from "vitest";
import * as contracts from "../../src/shared/contracts.js";
import type { CheckoutDto } from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "c".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

type FinanceFixture = Awaited<ReturnType<typeof createTestApp>> & {
  doctorCookie: string;
  assistantCookie: string;
};

interface CheckoutData {
  charge: { id: string } | null;
  grossTotalBaht: number;
  adjustmentTotalBaht: number;
  netDueBaht: number;
  collectionState: string;
  allowedActions: string[];
  closeBlockers: string[];
  visit: { status: string; revision: number };
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
  const test = await createTestApp({ idFactory: sequence(input.idPrefix ?? "finance-collection-id") });
  cleanups.push(test.cleanup);
  const doctor = await seedAccount(test.database, {
    id: "finance-collection-doctor",
    username: "finance-collection-doctor",
    role: "doctor",
    displayName: "พญ. เก็บเงินทดสอบ",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(test.database, {
    id: "finance-collection-assistant",
    username: "finance-collection-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยเก็บเงินทดสอบ",
    mustChangePassword: false,
  });
  test.database.sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'finance-collection-patient', 'clinic', 'DEMO-000012', 'ผู้ป่วยทดสอบ 000012', '0000000012',
      '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      'finance-collection-visit', 'clinic', 'finance-collection-patient', 'AWAITING_CHARGE',
      'ทดสอบการรับชำระ', 7, '${NOW}', '${NOW}', 'finance-collection-doctor'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-collection-note', 'finance-collection-visit', 1, 'secret subjective', 'secret objective',
      'secret assessment', 'secret plan', 1, 'finance-collection-doctor', 'พญ. เก็บเงินทดสอบ',
      '${NOW}', '${HASH}'
    );
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-collection-decision', 'finance-collection-visit', 1, 'NO_MEDICATION',
      'ไม่มีข้อบ่งใช้ยา', NULL, NULL, 'finance-collection-doctor', 'พญ. เก็บเงินทดสอบ',
      '${NOW}', '${HASH}'
    );
  `);
  return {
    ...test,
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
  };
}

async function finalize(test: FinanceFixture, key = "finance-collection-finalize"): Promise<CheckoutData> {
  const response = await test.app.inject({
    method: "POST",
    url: "/api/checkout/finance-collection-visit/charge-finalizations",
    headers: { cookie: test.doctorCookie, "idempotency-key": key },
    payload: {
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "COLLECT" },
    },
  });
  expect(response.statusCode).toBe(201);
  if (response.statusCode !== 201) throw new Error("Unable to finalize fixture Charge");
  return (response.json() as { data: CheckoutData }).data;
}

function waiverBody(chargeId: string, visitRevision = 8, reason = "ผู้ป่วยได้รับยกเว้นเต็มจำนวน") {
  return {
    expectedRevisions: { visit: visitRevision },
    payload: { chargeId, reason },
  };
}

function cashBody(chargeId: string, amountBaht = 100, visitRevision = 8) {
  return {
    expectedRevisions: { visit: visitRevision },
    payload: { chargeId, amountBaht },
  };
}

function promptPayBody(
  chargeId: string,
  amountBaht = 100,
  manualReference = "PP-REF-001",
  visitRevision = 8,
) {
  return {
    expectedRevisions: { visit: visitRevision },
    payload: { chargeId, amountBaht, manualReference },
  };
}

function preTask5Checkout(data: CheckoutDto, contentHash: string): unknown {
  const { resolution: _resolution, ...withoutResolution } = data;
  void _resolution;
  if (!data.charge) throw new Error("Historical command fixture requires a finalized Charge");
  return {
    ...withoutResolution,
    charge: { ...data.charge, contentHash },
    // Before Task 5 the Doctor had no close action in Checkout.
    allowedActions: [],
  };
}

describe("terminal finance collection", () => {
  it("strictly accepts only server-checkable whole-Baht collection commands", () => {
    const values = contracts as Record<string, unknown>;
    const waiver = values.approveFullWaiverBodySchema as { safeParse(value: unknown): { success: boolean } } | undefined;
    const cash = values.recordCashBodySchema as { safeParse(value: unknown): { success: boolean } } | undefined;
    const promptPay = values.confirmPromptPayBodySchema as { safeParse(value: unknown): { success: boolean } } | undefined;
    expect(waiver).toBeDefined();
    expect(cash).toBeDefined();
    expect(promptPay).toBeDefined();
    if (!waiver || !cash || !promptPay) return;

    expect(waiver.safeParse(waiverBody("charge-1")).success).toBe(true);
    expect(waiver.safeParse(waiverBody("charge-1", 8, "   ")).success).toBe(false);
    expect(waiver.safeParse({ ...waiverBody("charge-1"), grossTotalBaht: 100 }).success).toBe(false);
    expect(cash.safeParse(cashBody("charge-1", 100)).success).toBe(true);
    expect(cash.safeParse(cashBody("charge-1", 100.5)).success).toBe(false);
    expect(cash.safeParse(cashBody("charge-1", 0)).success).toBe(false);
    expect(cash.safeParse({ ...cashBody("charge-1"), payload: { chargeId: "charge-1", amountBaht: 100, actorId: "forged" } }).success).toBe(false);
    expect(promptPay.safeParse(promptPayBody("charge-1")).success).toBe(true);
    expect(promptPay.safeParse(promptPayBody("charge-1", 100, " ")).success).toBe(false);
    expect(promptPay.safeParse({ ...promptPayBody("charge-1"), payload: { chargeId: "charge-1", amountBaht: 100, manualReference: "PP-REF-001", bankConfirmation: true } }).success).toBe(false);
  });

  it("approves a Doctor full waiver as one exact negative-gross adjustment with an audited trimmed reason", async () => {
    const test = await fixture();
    const finalized = await finalize(test);
    expect(finalized.charge).not.toBeNull();
    if (!finalized.charge) return;
    expect(finalized.allowedActions).toEqual(["APPROVE_FULL_WAIVER", "RECORD_CASH", "CONFIRM_PROMPTPAY"]);

    const response = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/waivers",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-waiver-first" },
      payload: waiverBody(finalized.charge.id, 8, "  แพทย์อนุมัติยกเว้นเต็มจำนวน  "),
    });
    expect(response.statusCode).toBe(201);
    if (response.statusCode !== 201) return;
    expect((response.json() as { replayed: boolean; data: CheckoutData })).toMatchObject({
      replayed: false,
      data: {
        grossTotalBaht: 100,
        adjustmentTotalBaht: -100,
        netDueBaht: 0,
        collectionState: "COLLECTION_NOT_REQUIRED",
        allowedActions: ["CLOSE_VISIT"],
        closeBlockers: [],
        visit: { status: "READY_TO_CLOSE", revision: 9 },
      },
    });
    const adjustment = test.database.sqlite.prepare(`
      SELECT id, charge_id, kind, amount_baht, reason, approved_by, approved_by_display_name, approved_at, content_hash
      FROM finance_charge_adjustments
    `).get() as Record<string, unknown>;
    expect(adjustment).toMatchObject({
      charge_id: finalized.charge.id,
      kind: "FULL_WAIVER",
      amount_baht: -100,
      reason: "แพทย์อนุมัติยกเว้นเต็มจำนวน",
      approved_by: "finance-collection-doctor",
      approved_by_display_name: "พญ. เก็บเงินทดสอบ",
      approved_at: "2026-08-03T00:00:00.000Z",
      content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(countRows(test, "finance_payments")).toBe(0);
    const audit = test.database.sqlite.prepare(`
      SELECT action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json
      FROM audit_events WHERE action = 'charge.waiver-approved'
    `).get() as Record<string, unknown>;
    expect(audit).toMatchObject({
      action: "charge.waiver-approved",
      entity_type: "finance_charge_adjustment",
      entity_id: adjustment.id,
      entity_revision: 9,
      reason: "แพทย์อนุมัติยกเว้นเต็มจำนวน",
      occurred_at: "2026-08-03T00:00:00.000Z",
    });
    expect(JSON.parse(audit.metadata_json as string)).toEqual({
      chargeId: finalized.charge.id,
      grossTotalBaht: 100,
      adjustmentAmountBaht: -100,
    });
  });

  it("lets either role record exact Cash while rejecting a mismatch without evidence", async () => {
    const test = await fixture();
    const finalized = await finalize(test);
    expect(finalized.charge).not.toBeNull();
    if (!finalized.charge) return;

    const assistantCheckout = await test.app.inject({
      method: "GET",
      url: "/api/checkout/finance-collection-visit",
      headers: { cookie: test.assistantCookie },
    });
    expect(assistantCheckout.statusCode).toBe(200);
    expect((assistantCheckout.json() as { data: CheckoutData }).data.allowedActions).toEqual(["RECORD_CASH"]);

    const mismatch = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-mismatch" },
      payload: cashBody(finalized.charge.id, 99),
    });
    expect(mismatch.statusCode).toBe(409);
    expect((mismatch.json() as { error: { code: string } }).error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    expect(countRows(test, "finance_payments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(1);
    expect(countRows(test, "idempotency_records")).toBe(1);

    const recorded = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/payments/cash",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-cash-exact" },
      payload: cashBody(finalized.charge.id),
    });
    expect(recorded.statusCode).toBe(201);
    if (recorded.statusCode !== 201) return;
    expect((recorded.json() as { data: CheckoutData }).data).toMatchObject({
      grossTotalBaht: 100,
      adjustmentTotalBaht: 0,
      netDueBaht: 100,
      collectionState: "PAID_CASH",
      allowedActions: [],
      closeBlockers: [],
      visit: { status: "READY_TO_CLOSE", revision: 9 },
    });
    const payment = test.database.sqlite.prepare(`
      SELECT id, charge_id, visit_id, method, amount_baht, manual_reference, confirmed_by, confirmed_by_display_name, confirmed_at, content_hash
      FROM finance_payments
    `).get() as Record<string, unknown>;
    expect(payment).toMatchObject({
      charge_id: finalized.charge.id,
      visit_id: "finance-collection-visit",
      method: "CASH",
      amount_baht: 100,
      manual_reference: null,
      confirmed_by: "finance-collection-assistant",
      confirmed_by_display_name: "ผู้ช่วยเก็บเงินทดสอบ",
      confirmed_at: "2026-08-03T00:00:00.000Z",
      content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const audit = test.database.sqlite.prepare(`
      SELECT action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json
      FROM audit_events WHERE action = 'payment.cash-recorded'
    `).get() as Record<string, unknown>;
    expect(audit).toMatchObject({
      action: "payment.cash-recorded",
      entity_type: "finance_payment",
      entity_id: payment.id,
      entity_revision: 9,
      reason: null,
      occurred_at: "2026-08-03T00:00:00.000Z",
    });
    expect(JSON.parse(audit.metadata_json as string)).toEqual({
      chargeId: finalized.charge.id,
      paymentId: payment.id,
      amountBaht: 100,
    });
  });

  it("allows Doctor-only manual PromptPay confirmation with a required reference", async () => {
    const test = await fixture();
    const finalized = await finalize(test);
    expect(finalized.charge).not.toBeNull();
    if (!finalized.charge) return;

    const assistantAttempt = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/payments/promptpay",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-promptpay-assistant" },
      payload: promptPayBody(finalized.charge.id),
    });
    expect(assistantAttempt.statusCode).toBe(403);
    expect((assistantAttempt.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(countRows(test, "finance_payments")).toBe(0);

    const missingReference = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/payments/promptpay",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-promptpay-missing-reference" },
      payload: promptPayBody(finalized.charge.id, 100, " "),
    });
    expect(missingReference.statusCode).toBe(422);
    expect((missingReference.json() as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    expect(countRows(test, "finance_payments")).toBe(0);

    const confirmed = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/payments/promptpay",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-promptpay-first" },
      payload: promptPayBody(finalized.charge.id, 100, "  PP-REF-001  "),
    });
    expect(confirmed.statusCode).toBe(201);
    if (confirmed.statusCode !== 201) return;
    expect((confirmed.json() as { data: CheckoutData }).data).toMatchObject({
      collectionState: "PAID_PROMPTPAY",
      netDueBaht: 100,
      allowedActions: ["CLOSE_VISIT"],
      closeBlockers: [],
      visit: { status: "READY_TO_CLOSE", revision: 9 },
    });
    const payment = test.database.sqlite.prepare(`
      SELECT id, method, amount_baht, manual_reference, confirmed_by, confirmed_at FROM finance_payments
    `).get() as Record<string, unknown>;
    expect(payment).toMatchObject({
      method: "PROMPTPAY",
      amount_baht: 100,
      manual_reference: "PP-REF-001",
      confirmed_by: "finance-collection-doctor",
      confirmed_at: "2026-08-03T00:00:00.000Z",
    });
    const audit = test.database.sqlite.prepare(`
      SELECT action, entity_id, entity_revision, reason, metadata_json
      FROM audit_events WHERE action = 'payment.promptpay-confirmed'
    `).get() as Record<string, unknown>;
    expect(audit).toMatchObject({
      action: "payment.promptpay-confirmed",
      entity_id: payment.id,
      entity_revision: 9,
      reason: null,
    });
    expect(JSON.parse(audit.metadata_json as string)).toEqual({
      chargeId: finalized.charge.id,
      paymentId: payment.id,
      amountBaht: 100,
      manualReference: "PP-REF-001",
    });
  });

  it.each([
    {
      name: "waiver",
      key: "finance-historical-waiver",
      actor: "doctor" as const,
      url: "/api/checkout/finance-collection-visit/waivers",
      payload: (chargeId: string) => waiverBody(chargeId),
    },
    {
      name: "Cash",
      key: "finance-historical-cash",
      actor: "assistant" as const,
      url: "/api/checkout/finance-collection-visit/payments/cash",
      payload: (chargeId: string) => cashBody(chargeId),
    },
    {
      name: "PromptPay",
      key: "finance-historical-promptpay",
      actor: "doctor" as const,
      url: "/api/checkout/finance-collection-visit/payments/promptpay",
      payload: (chargeId: string) => promptPayBody(chargeId),
    },
  ])("replays an actual pre-Task5 $name envelope byte-for-byte without changing current Checkout", async (variant) => {
    const test = await fixture({ idPrefix: `finance-${variant.name.toLowerCase()}-legacy` });
    const finalized = await finalize(test, `finance-${variant.name.toLowerCase()}-legacy-finalize`);
    if (!finalized.charge) throw new Error("Unable to finalize historical collection fixture");
    const cookie = variant.actor === "doctor" ? test.doctorCookie : test.assistantCookie;
    const actorId = variant.actor === "doctor"
      ? "finance-collection-doctor"
      : "finance-collection-assistant";
    const payload = variant.payload(finalized.charge.id);
    const first = await test.app.inject({
      method: "POST",
      url: variant.url,
      headers: { cookie, "idempotency-key": variant.key },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const currentData = (first.json() as { data: CheckoutDto }).data;
    expect(JSON.stringify(currentData)).not.toContain("contentHash");
    const charge = test.database.sqlite.prepare(
      "SELECT content_hash AS contentHash FROM finance_charges WHERE id = ?",
    ).get(finalized.charge.id) as { contentHash: string } | undefined;
    if (!charge) throw new Error("Historical collection fixture is missing Charge evidence");
    const historicalData = preTask5Checkout(currentData, charge.contentHash);
    test.database.sqlite.prepare(`
      UPDATE idempotency_records SET response_json = ?
      WHERE actor_id = ? AND key = ?
    `).run(JSON.stringify({ data: historicalData, replayed: false }), actorId, variant.key);

    const replay = await test.app.inject({
      method: "POST",
      url: variant.url,
      headers: { cookie, "idempotency-key": variant.key },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(JSON.stringify(replay.json().data)).toBe(JSON.stringify(historicalData));

    const redacted = test.database.sqlite.prepare(`
      SELECT response_json AS responseJson FROM idempotency_records
      WHERE actor_id = ? AND key = ?
    `).get(actorId, variant.key) as { responseJson: string } | undefined;
    expect(redacted?.responseJson).not.toContain(charge.contentHash);
    expect(JSON.parse(redacted?.responseJson ?? "{}")).toMatchObject({
      type: "safe-replay-reference",
      reference: { responseShape: "LEGACY_HASHED_V1" },
    });

    const current = await test.app.inject({
      method: "GET",
      url: "/api/checkout/finance-collection-visit",
      headers: { cookie },
    });
    expect(current.statusCode).toBe(200);
    expect(JSON.stringify(current.json().data)).not.toContain("contentHash");
  });

  it("rejects Assistant waiver attempts before any collection write", async () => {
    const test = await fixture();
    const finalized = await finalize(test);
    expect(finalized.charge).not.toBeNull();
    if (!finalized.charge) return;

    const response = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-collection-visit/waivers",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-waiver-assistant" },
      payload: waiverBody(finalized.charge.id),
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(countRows(test, "finance_charge_adjustments")).toBe(0);
    expect(countRows(test, "finance_payments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(1);
    expect(countRows(test, "idempotency_records")).toBe(1);
  });
});
