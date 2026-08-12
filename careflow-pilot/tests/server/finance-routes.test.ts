import { afterEach, describe, expect, it } from "vitest";
import * as contracts from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "b".repeat(64);
const cleanups: Array<() => Promise<void>> = [];
const chargeFinalizationFailures = [
  { name: "audit", trigger: "finance_fail_audit", table: "audit_events", statement: "BEFORE INSERT ON audit_events" },
  { name: "visit", trigger: "finance_fail_visit", table: "visits", statement: "BEFORE UPDATE OF status ON visits" },
  { name: "idempotency", trigger: "finance_fail_idempotency", table: "idempotency_records", statement: "BEFORE INSERT ON idempotency_records" },
] as const;
const fullWaiverFinalizationFailures = [
  {
    name: "adjustment",
    trigger: "finance_fail_finalize_waiver_adjustment",
    statement: "BEFORE INSERT ON finance_charge_adjustments",
    when: "",
  },
  {
    name: "visit",
    trigger: "finance_fail_finalize_waiver_visit",
    statement: "BEFORE UPDATE OF status ON visits",
    when: "",
  },
  {
    name: "waiver-audit",
    trigger: "finance_fail_finalize_waiver_audit",
    statement: "BEFORE INSERT ON audit_events",
    when: "WHEN NEW.action = 'charge.waiver-approved'",
  },
  {
    name: "idempotency",
    trigger: "finance_fail_finalize_waiver_idempotency",
    statement: "BEFORE INSERT ON idempotency_records",
    when: "",
  },
] as const;

type FinanceRouteFixture = Awaited<ReturnType<typeof createTestApp>> & {
  doctorCookie: string;
  assistantCookie: string;
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function countRows(test: FinanceRouteFixture, table: string): number {
  const row = test.database.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

async function fixture(input: { visitId?: string; idPrefix?: string } = {}): Promise<FinanceRouteFixture> {
  const test = await createTestApp({ idFactory: sequence(input.idPrefix ?? "finance-route-id") });
  cleanups.push(test.cleanup);
  const doctor = await seedAccount(test.database, {
    id: "finance-route-doctor",
    username: "finance-route-doctor",
    role: "doctor",
    displayName: "พญ. เส้นทางการเงิน",
    mustChangePassword: false,
  });
  const assistant = await seedAccount(test.database, {
    id: "finance-route-assistant",
    username: "finance-route-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยเส้นทางการเงิน",
    mustChangePassword: false,
  });
  const visitId = input.visitId ?? "finance-route-visit";
  test.database.sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'finance-route-patient', 'clinic', 'DEMO-000011', 'ผู้ป่วยทดสอบ 000011', '0000000011',
      '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      '${visitId}', 'clinic', 'finance-route-patient', 'AWAITING_CHARGE', 'ทดสอบเส้นทางการเงิน', 7,
      '${NOW}', '${NOW}', 'finance-route-doctor'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-route-note', '${visitId}', 1, 'secret subjective', 'secret objective', 'secret assessment',
      'secret plan', 1, 'finance-route-doctor', 'พญ. เส้นทางการเงิน', '${NOW}', '${HASH}'
    );
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-route-decision', '${visitId}', 1, 'NO_MEDICATION', 'ไม่มีข้อบ่งใช้ยา', NULL, NULL,
      'finance-route-doctor', 'พญ. เส้นทางการเงิน', '${NOW}', '${HASH}'
    );
  `);
  return {
    ...test,
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
  };
}

function body(visitRevision = 7, clinicPricingRevision = 1) {
  return {
    expectedRevisions: { visit: visitRevision, clinicPricing: clinicPricingRevision },
    payload: { settlementIntent: "COLLECT" as const },
  };
}

function fullWaiverBody(
  waiverReason = "ผู้ป่วยเข้าเกณฑ์ยกเว้นค่าบริการ",
  visitRevision = 7,
  clinicPricingRevision = 1,
) {
  return {
    expectedRevisions: { visit: visitRevision, clinicPricing: clinicPricingRevision },
    payload: { settlementIntent: "FULL_WAIVER" as const, waiverReason },
  };
}

describe("finance checkout routes", () => {
  it("rejects anonymous charge finalization before any finance, audit, or idempotency write", async () => {
    const test = await fixture();
    const response = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { "idempotency-key": "finance-anonymous-denied" },
      payload: body(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_REQUIRED");
    expect(countRows(test, "finance_charges")).toBe(0);
    expect(countRows(test, "finance_charge_lines")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(0);
    expect(countRows(test, "idempotency_records")).toBe(0);
  });

  it("requires finance authentication and rejects Assistant charge finalization before service work", async () => {
    const test = await fixture();
    const anonymous = await test.app.inject({ method: "GET", url: "/api/checkout/finance-route-visit" });
    expect(anonymous.statusCode).toBe(401);
    if (anonymous.statusCode !== 401) return;

    const assistantPreview = await test.app.inject({
      method: "GET",
      url: "/api/checkout/finance-route-visit",
      headers: { cookie: test.assistantCookie },
    });
    expect(assistantPreview.statusCode).toBe(200);
    if (assistantPreview.statusCode !== 200) return;
    expect(assistantPreview.json().data).toMatchObject({
      visit: { id: "finance-route-visit", status: "AWAITING_CHARGE", revision: 7 },
      clinicPricingRevision: 1,
      grossTotalBaht: 100,
      collectionState: "PENDING_CHARGE",
    });
    expect(JSON.stringify(assistantPreview.json().data)).not.toMatch(/secret (subjective|objective|assessment|plan)/);

    const assistantFinalize = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-assistant-denied" },
      payload: body(),
    });
    expect(assistantFinalize.statusCode).toBe(403);
    expect(assistantFinalize.json().error.code).toBe("FORBIDDEN");

    const assistantWaiverFinalize = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "finance-assistant-waiver-denied" },
      payload: fullWaiverBody(),
    });
    expect(assistantWaiverFinalize.statusCode).toBe(403);
    expect(assistantWaiverFinalize.json().error.code).toBe("FORBIDDEN");
    expect(countRows(test, "finance_charges")).toBe(0);
    expect(countRows(test, "finance_charge_adjustments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(0);
    expect(countRows(test, "idempotency_records")).toBe(0);
  });

  it("strictly parses both server-derived finalization variants and trims the full-waiver reason", async () => {
    const values = contracts as Record<string, unknown>;
    const finalizeChargeBodySchema = values.finalizeChargeBodySchema as {
      safeParse: (value: unknown) => {
        success: boolean;
        data?: { payload: { settlementIntent: string; waiverReason?: string } };
      };
    } | undefined;
    expect(finalizeChargeBodySchema).toBeDefined();
    if (!finalizeChargeBodySchema) return;

    expect(finalizeChargeBodySchema.safeParse(body()).success).toBe(true);
    expect(finalizeChargeBodySchema.safeParse({ ...body(), grossTotalBaht: 100 }).success).toBe(false);
    const fullWaiver = finalizeChargeBodySchema.safeParse(fullWaiverBody("  ผู้ป่วยเข้าเกณฑ์ยกเว้น  "));
    expect(fullWaiver.success).toBe(true);
    expect(fullWaiver.data?.payload).toEqual({
      settlementIntent: "FULL_WAIVER",
      waiverReason: "ผู้ป่วยเข้าเกณฑ์ยกเว้น",
    });
    expect(finalizeChargeBodySchema.safeParse(fullWaiverBody("   ")).success).toBe(false);
    expect(finalizeChargeBodySchema.safeParse({
      ...fullWaiverBody(),
      payload: { ...fullWaiverBody().payload, amountBaht: 100 },
    }).success).toBe(false);
    expect(finalizeChargeBodySchema.safeParse({
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "COLLECT", amountBaht: 100 },
    }).success).toBe(false);
  });

  it("atomically finalizes a Doctor full waiver with exact evidence and safe replay", async () => {
    const test = await fixture({ idPrefix: "finance-finalize-waiver" });
    const command = fullWaiverBody("  ผู้ป่วยเข้าเกณฑ์ยกเว้นค่าบริการ  ");
    const first = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-waiver-replay" },
      payload: command,
    });

    expect(first.statusCode).toBe(201);
    if (first.statusCode !== 201) return;
    expect(first.json()).toMatchObject({
      replayed: false,
      data: {
        visit: { status: "READY_TO_CLOSE", revision: 8 },
        clinicPricingRevision: 1,
        grossTotalBaht: 100,
        adjustmentTotalBaht: -100,
        netDueBaht: 0,
        collectionState: "COLLECTION_NOT_REQUIRED",
        allowedActions: ["CLOSE_VISIT"],
        closeBlockers: [],
      },
    });
    const chargeId = first.json().data.charge.id as string;
    const adjustment = test.database.sqlite.prepare(`
      SELECT id, charge_id AS chargeId, kind, amount_baht AS amountBaht, reason,
        approved_by AS approvedBy, approved_by_display_name AS approvedByDisplayName,
        approved_at AS approvedAt, content_hash AS contentHash
      FROM finance_charge_adjustments WHERE charge_id = ?
    `).get(chargeId) as Record<string, unknown> | undefined;
    expect(adjustment).toBeDefined();
    if (!adjustment) return;
    const adjustmentId = adjustment.id as string;
    expect(adjustmentId).toMatch(/^finance-finalize-waiver-\d+$/);
    expect(adjustment).toMatchObject({
      chargeId,
      kind: "FULL_WAIVER",
      amountBaht: -100,
      reason: "ผู้ป่วยเข้าเกณฑ์ยกเว้นค่าบริการ",
      approvedBy: "finance-route-doctor",
      approvedByDisplayName: "พญ. เส้นทางการเงิน",
      approvedAt: "2026-08-03T00:00:00.000Z",
    });
    expect(adjustment?.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const audits = test.database.sqlite.prepare(`
      SELECT action, entity_type AS entityType, entity_id AS entityId,
        entity_revision AS entityRevision, reason, metadata_json AS metadataJson
      FROM audit_events ORDER BY rowid
    `).all() as Array<Record<string, unknown>>;
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: "charge.finalized",
      entityType: "finance_charge",
      entityId: chargeId,
      entityRevision: 8,
      reason: null,
    });
    expect(JSON.parse(audits[0]?.metadataJson as string)).toMatchObject({
      visitId: "finance-route-visit",
      grossTotalBaht: 100,
      previousStatus: "AWAITING_CHARGE",
      nextStatus: "READY_TO_CLOSE",
    });
    expect(audits[1]).toMatchObject({
      action: "charge.waiver-approved",
      entityType: "finance_charge_adjustment",
      entityId: adjustmentId,
      entityRevision: 8,
      reason: "ผู้ป่วยเข้าเกณฑ์ยกเว้นค่าบริการ",
    });
    expect(JSON.parse(audits[1]?.metadataJson as string)).toEqual({
      adjustmentAmountBaht: -100,
      chargeId,
      grossTotalBaht: 100,
    });

    const replay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-waiver-replay" },
      payload: command,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(JSON.stringify(replay.json().data)).toBe(JSON.stringify(first.json().data));

    const collision = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-waiver-replay" },
      payload: fullWaiverBody("เหตุผลอื่น"),
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    const differentKey = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-waiver-second" },
      payload: fullWaiverBody("ผู้ป่วยเข้าเกณฑ์ยกเว้นค่าบริการ", 8),
    });
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().error.code).toBe("CHARGE_ALREADY_FINALIZED");
    expect(countRows(test, "finance_charges")).toBe(1);
    expect(countRows(test, "finance_charge_lines")).toBe(1);
    expect(countRows(test, "finance_charge_adjustments")).toBe(1);
    expect(countRows(test, "finance_payments")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(2);
    expect(countRows(test, "idempotency_records")).toBe(1);
  });

  it("finalizes once, replays the immutable response at 200, and rejects collisions and domain duplicates", async () => {
    const test = await fixture();
    const first = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-replay" },
      payload: body(),
    });
    expect(first.statusCode).toBe(201);
    if (first.statusCode !== 201) return;
    expect(first.json()).toMatchObject({
      replayed: false,
      data: {
        visit: { status: "AWAITING_PAYMENT", revision: 8 },
        clinicPricingRevision: 1,
        grossTotalBaht: 100,
        adjustmentTotalBaht: 0,
        netDueBaht: 100,
        collectionState: "AWAITING_COLLECTION",
      },
    });
    const replay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-replay" },
      payload: body(),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(JSON.stringify(replay.json().data)).toBe(JSON.stringify(first.json().data));

    const collision = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-replay" },
      payload: body(8),
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    const differentKey = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-second-key" },
      payload: body(8),
    });
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().error.code).toBe("CHARGE_ALREADY_FINALIZED");
    expect(countRows(test, "finance_charges")).toBe(1);
    expect(countRows(test, "finance_charge_lines")).toBe(1);
    expect(countRows(test, "audit_events")).toBe(1);
    expect(countRows(test, "idempotency_records")).toBe(1);
  });

  it("replays the exact pinned finalization projection after later evidence", async () => {
    const test = await fixture();
    const first = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-stable-later" },
      payload: body(),
    });
    expect(first.statusCode).toBe(201);
    if (first.statusCode !== 201) return;
    const originalData = first.json().data;
    const chargeId = originalData.charge.id as string;

    test.database.sqlite.prepare(`
      INSERT INTO finance_payments (
        id, charge_id, visit_id, method, amount_baht, manual_reference,
        confirmed_by, confirmed_by_display_name, confirmed_at, content_hash
      ) VALUES (
        'finance-later-payment', ?, 'finance-route-visit', 'CASH', 100, NULL,
        'finance-route-assistant', 'ผู้ช่วยเส้นทางการเงิน', ?, ?
      )
    `).run(chargeId, NOW, HASH);
    test.database.sqlite.prepare(`
      UPDATE visits SET status = 'READY_TO_CLOSE', revision = 9
      WHERE id = 'finance-route-visit' AND status = 'AWAITING_PAYMENT' AND revision = 8
    `).run();

    const replay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-stable-later" },
      payload: body(),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(JSON.stringify(replay.json().data)).toBe(JSON.stringify(originalData));
    expect(countRows(test, "finance_charges")).toBe(1);
    expect(countRows(test, "finance_payments")).toBe(1);
    expect(countRows(test, "audit_events")).toBe(1);
    expect(countRows(test, "idempotency_records")).toBe(1);
  });

  it("replays a literal projection-less 5dacfa4-era COLLECT response byte-for-byte", async () => {
    const test = await fixture();
    const historicalData = {
      patient: {
        id: "finance-route-patient",
        hn: "DEMO-000011",
        displayName: "ผู้ป่วยทดสอบ 000011",
        birthDate: "1990-01-01",
        sex: "unknown",
      },
      visit: {
        id: "finance-route-visit",
        status: "AWAITING_PAYMENT",
        revision: 8,
        arrivedAt: NOW,
        startedAt: NOW,
        closedAt: null,
      },
      sourceKind: "NO_MEDICATION",
      clinicPricingRevision: 1,
      charge: {
        id: "legacy-task2-charge",
        sourceKind: "NO_MEDICATION",
        medicationDecisionId: "finance-route-decision",
        medicationDecisionVersion: 1,
        fulfillmentDispenseId: null,
        clinicPricingRevision: 1,
        consultationFeeBahtSnapshot: 100,
        currency: "THB",
        lineCount: 1,
        finalizedBy: {
          id: "finance-route-doctor",
          displayName: "พญ. เส้นทางการเงิน",
        },
        finalizedAt: "2026-08-03T00:00:00.000Z",
        contentHash: "9d23815dffbf6ec66a231a62bbb2f4e2f5306e466774c511e8c9b3b2792173ab",
      },
      lines: [{
        id: "legacy-task2-line",
        position: 0,
        lineType: "CONSULTATION",
        descriptionSnapshot: "ค่าตรวจ",
        quantity: 1,
        unitPriceBaht: 100,
        lineTotalBaht: 100,
        medicationOrderItemId: null,
        fulfillmentDispenseLineId: null,
      }],
      grossTotalBaht: 100,
      adjustmentTotalBaht: 0,
      netDueBaht: 100,
      collectionState: "AWAITING_COLLECTION",
      allowedActions: [],
      closeBlockers: ["collection"],
    };
    test.database.sqlite.exec(`
      INSERT INTO finance_charges (
        id, clinic_id, visit_id, source_kind, medication_decision_id,
        medication_decision_version, fulfillment_dispense_id, clinic_pricing_revision,
        consultation_fee_baht_snapshot, currency, line_count, finalized_by,
        finalized_by_display_name, finalized_at, content_hash
      ) VALUES (
        'legacy-task2-charge', 'clinic', 'finance-route-visit', 'NO_MEDICATION',
        'finance-route-decision', 1, NULL, 1, 100, 'THB', 1,
        'finance-route-doctor', 'พญ. เส้นทางการเงิน', '2026-08-03T00:00:00.000Z',
        '9d23815dffbf6ec66a231a62bbb2f4e2f5306e466774c511e8c9b3b2792173ab'
      );
      INSERT INTO finance_charge_lines (
        id, charge_id, position, line_type, description_snapshot, quantity,
        unit_price_baht, line_total_baht, medication_order_item_id, fulfillment_dispense_line_id
      ) VALUES (
        'legacy-task2-line', 'legacy-task2-charge', 0, 'CONSULTATION', 'ค่าตรวจ',
        1, 100, 100, NULL, NULL
      );
      UPDATE visits SET status = 'AWAITING_PAYMENT', revision = 8
      WHERE id = 'finance-route-visit';
    `);
    test.database.sqlite.prepare(`
      INSERT INTO idempotency_records (
        clinic_id, actor_id, key, request_hash, response_status, response_json, created_at
      ) VALUES ('clinic', 'finance-route-doctor', ?, ?, 201, ?, ?)
    `).run(
      "finance-task2-projectionless",
      "6c776d2151b3195bacb534ccc4fda6bd880450df0ec79a1c2eb22bee2a83b809",
      JSON.stringify({
        type: "safe-replay-reference",
        reference: {
          chargeId: "legacy-task2-charge",
          patient: historicalData.patient,
          visit: historicalData.visit,
        },
      }),
      "2026-08-03T00:00:00.000Z",
    );

    const legacyReferenceReplay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-task2-projectionless" },
      payload: body(),
    });
    expect(legacyReferenceReplay.statusCode).toBe(200);
    expect(legacyReferenceReplay.json().replayed).toBe(true);
    expect(JSON.stringify(legacyReferenceReplay.json().data)).toBe(JSON.stringify(historicalData));
  });

  it("returns stale Visit and clinic-pricing revisions without creating finance evidence", async () => {
    const test = await fixture();
    const staleVisit = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-stale-visit" },
      payload: body(6),
    });
    expect(staleVisit.statusCode).toBe(409);
    if (staleVisit.statusCode !== 409) return;
    expect(staleVisit.json().error).toMatchObject({ code: "REVISION_CONFLICT", currentRevisions: { visit: 7 } });

    const stalePricing = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-stale-pricing" },
      payload: body(7, 2),
    });
    expect(stalePricing.statusCode).toBe(409);
    expect(stalePricing.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevisions: { clinicPricing: 1 },
    });
    expect(countRows(test, "finance_charges")).toBe(0);
    expect(countRows(test, "finance_charge_lines")).toBe(0);
    expect(countRows(test, "audit_events")).toBe(0);
    expect(countRows(test, "idempotency_records")).toBe(0);
  });

  it("allows at most one concurrent finalization and leaves no duplicate charge evidence", async () => {
    const test = await fixture();
    const [first, second] = await Promise.all([
      test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-route-visit/charge-finalizations",
        headers: { cookie: test.doctorCookie, "idempotency-key": "finance-race-first" },
        payload: body(),
      }),
      test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-route-visit/charge-finalizations",
        headers: { cookie: test.doctorCookie, "idempotency-key": "finance-race-second" },
        payload: body(),
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    if (![first.statusCode, second.statusCode].includes(201)) return;
    expect(countRows(test, "finance_charges")).toBe(1);
    expect(countRows(test, "finance_charge_lines")).toBe(1);
    expect(countRows(test, "audit_events")).toBe(1);
  });

  it.each(chargeFinalizationFailures)(
    "rolls back Charge, Visit, audit, and idempotency rows when the $name terminal write fails",
    async (failure) => {
      const test = await fixture({ idPrefix: `finance-${failure.name}` });
      test.database.sqlite.exec(`
        CREATE TRIGGER ${failure.trigger} ${failure.statement}
        BEGIN
          SELECT RAISE(ABORT, '${failure.name} injection');
        END;
      `);
      const response = await test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-route-visit/charge-finalizations",
        headers: { cookie: test.doctorCookie, "idempotency-key": `finance-${failure.name}-failure` },
        payload: body(),
      });
      expect(response.statusCode, failure.name).toBe(500);
      if (response.statusCode !== 500) return;
      expect(countRows(test, "finance_charges"), failure.name).toBe(0);
      expect(countRows(test, "finance_charge_lines"), failure.name).toBe(0);
      expect(countRows(test, "audit_events"), failure.name).toBe(0);
      expect(countRows(test, "idempotency_records"), failure.name).toBe(0);
      expect(test.database.sqlite.prepare("SELECT status, revision FROM visits WHERE id = 'finance-route-visit'").get(), failure.name)
        .toEqual({ status: "AWAITING_CHARGE", revision: 7 });
    },
  );

  it.each(fullWaiverFinalizationFailures)(
    "rolls back every full-waiver finalization row when the $name terminal write fails",
    async (failure) => {
      const test = await fixture({ idPrefix: `finance-finalize-waiver-${failure.name}` });
      test.database.sqlite.exec(`
        CREATE TRIGGER ${failure.trigger} ${failure.statement} ${failure.when}
        BEGIN
          SELECT RAISE(ABORT, '${failure.name} injection');
        END;
      `);
      const response = await test.app.inject({
        method: "POST",
        url: "/api/checkout/finance-route-visit/charge-finalizations",
        headers: { cookie: test.doctorCookie, "idempotency-key": `finance-waiver-${failure.name}-failure` },
        payload: fullWaiverBody(),
      });
      expect(response.statusCode, failure.name).toBe(500);
      expect(countRows(test, "finance_charges"), failure.name).toBe(0);
      expect(countRows(test, "finance_charge_lines"), failure.name).toBe(0);
      expect(countRows(test, "finance_charge_adjustments"), failure.name).toBe(0);
      expect(countRows(test, "finance_payments"), failure.name).toBe(0);
      expect(countRows(test, "audit_events"), failure.name).toBe(0);
      expect(countRows(test, "idempotency_records"), failure.name).toBe(0);
      expect(test.database.sqlite.prepare("SELECT status, revision FROM visits WHERE id = 'finance-route-visit'").get(), failure.name)
        .toEqual({ status: "AWAITING_CHARGE", revision: 7 });
    },
  );
});
