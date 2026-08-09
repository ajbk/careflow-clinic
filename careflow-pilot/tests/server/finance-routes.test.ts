import { afterEach, describe, expect, it } from "vitest";
import * as contracts from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "b".repeat(64);
const cleanups: Array<() => Promise<void>> = [];

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
  });

  it("strictly parses a server-derived finalize command and exposes only the approved COLLECT variant", async () => {
    const values = contracts as Record<string, unknown>;
    const finalizeChargeBodySchema = values.finalizeChargeBodySchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;
    expect(finalizeChargeBodySchema).toBeDefined();
    if (!finalizeChargeBodySchema) return;

    expect(finalizeChargeBodySchema.safeParse(body()).success).toBe(true);
    expect(finalizeChargeBodySchema.safeParse({ ...body(), grossTotalBaht: 100 }).success).toBe(false);
    expect(finalizeChargeBodySchema.safeParse({
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "FULL_WAIVER", waiverReason: "ยังไม่อยู่ใน Task 2" },
    }).success).toBe(false);
    expect(finalizeChargeBodySchema.safeParse({
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: { settlementIntent: "COLLECT", amountBaht: 100 },
    }).success).toBe(false);
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

  it("replays the exact finalization projection after later evidence and from a pre-projection reference", async () => {
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

    test.database.sqlite.prepare(`
      UPDATE idempotency_records SET response_json = ?
      WHERE actor_id = 'finance-route-doctor' AND key = 'finance-finalize-stable-later'
    `).run(JSON.stringify({
      type: "safe-replay-reference",
      reference: {
        chargeId,
        patient: originalData.patient,
        visit: originalData.visit,
      },
    }));
    const legacyReferenceReplay = await test.app.inject({
      method: "POST",
      url: "/api/checkout/finance-route-visit/charge-finalizations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "finance-finalize-stable-later" },
      payload: body(),
    });
    expect(legacyReferenceReplay.statusCode).toBe(200);
    expect(legacyReferenceReplay.json().replayed).toBe(true);
    expect(JSON.stringify(legacyReferenceReplay.json().data)).toBe(JSON.stringify(originalData));
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

  it("rolls back Charge, Visit, audit, and idempotency rows when each terminal write fails", async () => {
    const failureCases = [
      { name: "audit", trigger: "finance_fail_audit", table: "audit_events", statement: "BEFORE INSERT ON audit_events" },
      { name: "visit", trigger: "finance_fail_visit", table: "visits", statement: "BEFORE UPDATE OF status ON visits" },
      { name: "idempotency", trigger: "finance_fail_idempotency", table: "idempotency_records", statement: "BEFORE INSERT ON idempotency_records" },
    ];

    for (const failure of failureCases) {
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
      if (response.statusCode !== 500) continue;
      expect(countRows(test, "finance_charges"), failure.name).toBe(0);
      expect(countRows(test, "finance_charge_lines"), failure.name).toBe(0);
      expect(countRows(test, "audit_events"), failure.name).toBe(0);
      expect(countRows(test, "idempotency_records"), failure.name).toBe(0);
      expect(test.database.sqlite.prepare("SELECT status, revision FROM visits WHERE id = 'finance-route-visit'").get(), failure.name)
        .toEqual({ status: "AWAITING_CHARGE", revision: 7 });
    }
  });
});
