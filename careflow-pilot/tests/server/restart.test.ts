import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/client.js";
import { auditEvents } from "../../src/server/modules/platform/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("real-file restart boundary", () => {
  it("preserves Intake Allergy, Journey, stock, Charge, Payment, Closure, and OPD evidence across real-file restarts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-restart-"));
    const databasePath = join(directory, "careflow.sqlite");
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    const firstDatabase = openDatabase(databasePath);
    const firstConfig = {
      host: "127.0.0.1",
      port: 3001,
      databasePath,
      cookieSecure: false,
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath: "./dist/client",
    } as const;
    const firstApp = await buildApp({
      db: firstDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: (() => {
        let index = 0;
        return () => `restart-${++index}`;
      })(),
    });
    await firstApp.ready();

    const assistant = await seedAccount(firstDatabase as never, {
      id: "assistant-restart-001",
      username: "restart-assistant",
      role: "assistant",
      displayName: "ผู้ช่วยรีสตาร์ต",
      mustChangePassword: false,
    });
    const doctor = await seedAccount(firstDatabase as never, {
      id: "doctor-restart-001",
      username: "restart-doctor",
      role: "doctor",
      displayName: "พญ. รีสตาร์ต",
      mustChangePassword: false,
    });

    const assistantCookie = cookieFrom(await login(firstApp, assistant.username, assistant.password));
    const doctorCookie = cookieFrom(await login(firstApp, doctor.username, doctor.password));
    for (const cookie of [assistantCookie, doctorCookie]) {
      const acknowledged = await firstApp.inject({
        method: "POST",
        url: "/api/auth/acknowledge-pilot",
        headers: { cookie },
        payload: { accepted: true },
      });
      expect(acknowledged.statusCode).toBe(204);
    }

    const patientResponse = await firstApp.inject({
      method: "POST",
      url: "/api/patients/synthetic",
      headers: { cookie: assistantCookie, "idempotency-key": "restart-patient-001" },
      payload: { expectedRevisions: {}, payload: {} },
    });
    expect(patientResponse.statusCode).toBe(201);
    const patient = patientResponse.json().data;
    const intakeResponse = await firstApp.inject({
      method: "POST",
      url: "/api/visits/intake",
      headers: { cookie: assistantCookie, "idempotency-key": "restart-intake-001" },
      payload: {
        expectedRevisions: { patient: patient.revision },
        payload: {
          patientId: patient.id,
          chiefComplaint: "ไอและมีไข้",
          vitals: {
            weightKg: 60,
            heightCm: 165,
            temperatureC: 37.5,
            systolicMmhg: 120,
            diastolicMmhg: 80,
            heartRateBpm: 80,
            spo2Percent: 98,
          },
          allergy: { answer: "NO", items: [], changeReason: null },
        },
      },
    });
    expect(intakeResponse.statusCode).toBe(201);
    const intake = intakeResponse.json().data;
    const visitId = intake.visit.id as string;
    const started = await firstApp.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-start-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().data.visit).toMatchObject({ id: visitId, status: "CONSULTING", revision: 2 });

    const allergyReview = await firstApp.inject({
      method: "POST",
      url: `/api/patients/${patient.id}/allergy-revisions`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-allergy-001" },
      payload: {
        expectedRevisions: { patient: 2, visit: 2 },
        payload: {
          visitId,
          state: "PRESENT",
          items: [{ substance: "เพนิซิลลิน", reaction: "ผื่น", severity: "MODERATE", note: "ยืนยันกับผู้ป่วย" }],
          sourceText: "ผู้ป่วยยืนยันประวัติแพ้เพนิซิลลิน",
          reason: "บันทึกก่อนการรักษา",
        },
      },
    });
    expect(allergyReview.statusCode).toBe(201);
    expect(allergyReview.json().data).toMatchObject({
      patient: { id: patient.id, revision: 3 },
      allergy: { revision: 2, state: "PRESENT", items: [{ substance: "เพนิซิลลิน" }] },
      visit: { id: visitId, revision: 2 },
    });

    const draft = await firstApp.inject({
      method: "POST", url: `/api/visits/${visitId}/consultation-draft`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-draft-001" },
      payload: {
        expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
        payload: {
          note: { subjective: "ไอ", objective: "ไข้", assessment: "หวัด", plan: "พักผ่อน", diagnoses: ["หวัด"] },
          medicationDecision: { kind: "ORDER", items: [{ medicationId: "DEMO-MED-001", medicationRevision: 1, quantity: 3, directionsTh: "หลังอาหาร" }] },
        },
      },
    });
    expect(draft.statusCode).toBe(200);
    const finalized = await firstApp.inject({
      method: "POST", url: `/api/visits/${visitId}/finalize-consultation`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-finalize-001" },
      payload: { expectedRevisions: { visit: 2, patient: 3, noteDraft: 1, medicationDraft: 1 }, payload: {} },
    });
    expect(finalized.statusCode).toBe(200);
    const finalizedData = finalized.json().data;
    const firstAmendment = await firstApp.inject({
      method: "POST", url: `/api/clinical-notes/${finalizedData.clinicalNote.id}/amendments`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-amendment-001" },
      payload: { expectedRevisions: { amendment: 0 }, payload: { content: "ติดตามอาการ", reason: "เพิ่มคำแนะนำ" } },
    });
    expect(firstAmendment.statusCode).toBe(201);
    const secondAmendment = await firstApp.inject({
      method: "POST", url: `/api/clinical-notes/${finalizedData.clinicalNote.id}/amendments`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-amendment-002" },
      payload: { expectedRevisions: { amendment: 1 }, payload: { content: "ทบทวนสัญญาณอันตราย", reason: "เพิ่มข้อควรกลับมาพบแพทย์" } },
    });
    expect(secondAmendment.statusCode).toBe(201);

    const beforeAuditIds = firstDatabase.sqlite
      .prepare("SELECT id FROM audit_events ORDER BY id")
      .pluck()
      .all() as string[];
    const beforeSessionCount = firstDatabase.sqlite
      .prepare("SELECT count(*) FROM sessions")
      .pluck()
      .get();
    const workspaceBefore = await firstApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: doctorCookie },
    });
    expect(workspaceBefore.statusCode).toBe(200);
    const intakeId = workspaceBefore.json().data.intake.id as string;
    const beforeEvidence = {
      note: finalizedData.clinicalNote,
      decision: finalizedData.medicationDecision,
      allergy: workspaceBefore.json().data.patientSnapshot.allergy,
      amendments: workspaceBefore.json().data.amendments,
      patientRevision: workspaceBefore.json().data.patient.revision,
      visitRevision: workspaceBefore.json().data.visit.revision,
    };
    expect(beforeEvidence.amendments).toEqual([
      firstAmendment.json().data,
      secondAmendment.json().data,
    ]);
    await firstApp.close();
    firstDatabase.close();

    const secondDatabase = openDatabase(databasePath);
    const secondApp = await buildApp({
      db: secondDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: (() => {
        let index = 0;
        return () => `restart-after-${++index}`;
      })(),
    });
    await secondApp.ready();
    let secondClosed = false;
    cleanups.push(async () => {
      if (!secondClosed) {
        await secondApp.close();
        secondDatabase.close();
      }
    });

    const workspaceAfter = await secondApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: doctorCookie },
    });
    expect(workspaceAfter.statusCode).toBe(200);
    expect(workspaceAfter.json().data).toMatchObject({
      visit: { id: visitId, status: "AWAITING_PREPARATION", revision: 3 },
      patient: { id: patient.id, hn: patient.hn },
      intake: { id: intakeId, chiefComplaint: "ไอและมีไข้" },
    });
    expect(workspaceAfter.json().data).toMatchObject({
      signedClinicalNote: { id: beforeEvidence.note.id, version: 1, contentHash: beforeEvidence.note.contentHash },
      medicationDecision: { id: beforeEvidence.decision.id, version: 1, contentHash: beforeEvidence.decision.contentHash },
      patient: { revision: beforeEvidence.patientRevision },
      visit: { revision: beforeEvidence.visitRevision },
      patientSnapshot: {
        activeProblems: { state: "VALUE", value: ["หวัด"], source: { type: "CLINICAL_NOTE", id: beforeEvidence.note.id, occurredAt: beforeEvidence.note.signedAt } },
        latestRelevantPlan: { state: "VALUE", value: "พักผ่อน", source: { type: "CLINICAL_NOTE", id: beforeEvidence.note.id, occurredAt: beforeEvidence.note.signedAt } },
        currentMedicationContext: { state: "VALUE", value: ["[DEMO] ยาทดสอบชนิด A"], source: { type: "MEDICATION_DECISION", id: beforeEvidence.decision.id, occurredAt: beforeEvidence.decision.signedAt } },
      },
    });
    expect(workspaceAfter.json().data.patientSnapshot.allergy).toEqual(beforeEvidence.allergy);
    expect(workspaceAfter.json().data.amendments).toEqual(beforeEvidence.amendments);
    const queueAfter = await secondApp.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: doctorCookie },
    });
    expect(queueAfter.statusCode).toBe(200);
    expect(queueAfter.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ visit: expect.objectContaining({ id: visitId, status: "AWAITING_PREPARATION", revision: 3 }) }),
      ]),
    );
    expect(secondDatabase.sqlite.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(beforeSessionCount);
    expect(secondDatabase.sqlite.prepare("SELECT id FROM audit_events ORDER BY id").pluck().all()).toEqual(beforeAuditIds);
    expect(secondDatabase.db.select().from(auditEvents).all().map((event) => event.entityId)).toEqual(
      expect.arrayContaining([patient.id, visitId]),
    );

    const orderPricesAfterFirstRestart = secondDatabase.sqlite.prepare(`
      SELECT snapshot.id AS order_price_snapshot_id, snapshot.medication_order_item_id, snapshot.medication_id, snapshot.medication_revision,
        snapshot.unit_price_baht_snapshot, snapshot.currency, item.quantity
      FROM medication_order_price_snapshots AS snapshot
      INNER JOIN medication_order_items AS item ON item.id = snapshot.medication_order_item_id
      WHERE item.medication_decision_id = ?
      ORDER BY snapshot.id
    `).all(beforeEvidence.decision.id) as Array<{ order_price_snapshot_id: string }>;
    expect(orderPricesAfterFirstRestart).toEqual([{
      order_price_snapshot_id: expect.any(String),
      medication_order_item_id: expect.any(String),
      medication_id: "DEMO-MED-001",
      medication_revision: 1,
      unit_price_baht_snapshot: 5,
      currency: "THB",
      quantity: 3,
    }]);
    const orderPriceSnapshotId = orderPricesAfterFirstRestart[0]?.order_price_snapshot_id;
    if (!orderPriceSnapshotId) throw new Error("Signed ORDER price snapshot was not persisted");

    for (const [key, lotNumber, expiryDate, quantity] of [
      ["restart-receipt-early", "RESTART-EARLY", "2030-08-10", 1],
      ["restart-receipt-late", "RESTART-LATE", "2030-08-20", 2],
    ] as const) {
      const receipt = await secondApp.inject({
        method: "POST",
        url: "/api/inventory/receipts",
        headers: { cookie: assistantCookie, "idempotency-key": key },
        payload: {
          expectedRevisions: { medication: 1 },
          payload: {
            medicationId: "DEMO-MED-001",
            quantity,
            lotNumber,
            expiryDate,
            supplierName: "ผู้จำหน่ายทดสอบการรีสตาร์ต",
            note: "หลักฐานหลายล็อตหลังเปิดฐานข้อมูลใหม่",
          },
        },
      });
      expect(receipt.statusCode).toBe(201);
    }
    const labelResponse = await secondApp.inject({
      method: "GET",
      url: `/api/dispensing/${visitId}/labels`,
      headers: { cookie: assistantCookie },
    });
    expect(labelResponse.statusCode).toBe(200);
    const label = labelResponse.json().data;
    const reservationStart = await secondApp.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/reservations`,
      headers: { cookie: assistantCookie, "idempotency-key": "restart-multi-lot-reservation" },
      payload: {
        expectedRevisions: { visit: 3, medicationDecision: 1 },
        payload: { labelVersionId: label.id },
      },
    });
    expect(reservationStart.statusCode).toBe(201);
    const reservationData = reservationStart.json().data;
    expect(reservationData.reservation.allocations.map((allocation: { lotNumberSnapshot: string; quantity: number }) => ({
      lotNumber: allocation.lotNumberSnapshot,
      quantity: allocation.quantity,
    }))).toEqual([
      { lotNumber: "RESTART-EARLY", quantity: 1 },
      { lotNumber: "RESTART-LATE", quantity: 2 },
    ]);
    const printed = await secondApp.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/labels/${reservationData.label.id}/print-events`,
      headers: { cookie: assistantCookie, "idempotency-key": "restart-multi-lot-print" },
      payload: {
        expectedRevisions: { visit: 4 },
        payload: { rendererVersion: "restart-test", decisionVersion: reservationData.medicationDecision.version },
      },
    });
    expect(printed.statusCode).toBe(201);
    let preparation = reservationData.preparation;
    for (const allocation of reservationData.reservation.allocations) {
      const labelItem = reservationData.label.items.find((item: { orderItemId: string }) => item.orderItemId === allocation.orderItemId);
      expect(labelItem).toBeDefined();
      const confirmation = await secondApp.inject({
        method: "POST",
        url: `/api/dispensing/${visitId}/preparation-confirmations`,
        headers: { cookie: assistantCookie, "idempotency-key": `restart-confirm-${allocation.id}` },
        payload: {
          expectedRevisions: { visit: 4, preparation: preparation.revision },
          payload: {
            method: "BARCODE",
            preparationId: preparation.id,
            allocationId: allocation.id,
            barcode: labelItem?.internalBarcode,
          },
        },
      });
      expect(confirmation.statusCode).toBe(201);
      preparation = confirmation.json().data.preparation;
    }
    const completed = await secondApp.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/complete-preparation`,
      headers: { cookie: assistantCookie, "idempotency-key": "restart-multi-lot-complete" },
      payload: {
        expectedRevisions: { visit: 4, preparation: preparation.revision },
        payload: { preparationId: preparation.id, reservationId: reservationData.reservation.id },
      },
    });
    expect(completed.statusCode).toBe(201);
    const released = await secondApp.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/release`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-multi-lot-release" },
      payload: {
        expectedRevisions: { visit: 5, preparation: completed.json().data.preparation.revision },
        payload: {
          decisionId: reservationData.medicationDecision.id,
          decisionVersion: reservationData.medicationDecision.version,
          labelVersionId: reservationData.label.id,
          labelPrintEventId: printed.json().data.preparation.latestPrintEventId,
          preparationId: preparation.id,
          reservationId: reservationData.reservation.id,
        },
      },
    });
    expect(released.statusCode).toBe(201);
    const handedOff = await secondApp.inject({
      method: "POST",
      url: `/api/dispensing/${visitId}/handoff`,
      headers: { cookie: assistantCookie, "idempotency-key": "restart-multi-lot-handoff" },
      payload: {
        expectedRevisions: { visit: 6 },
        payload: {
          decisionId: reservationData.medicationDecision.id,
          decisionVersion: reservationData.medicationDecision.version,
          labelVersionId: reservationData.label.id,
          releaseId: released.json().data.release.id,
          reservationId: reservationData.reservation.id,
        },
      },
    });
    expect(handedOff.statusCode).toBe(201);
    expect(handedOff.json().data.visit).toMatchObject({ status: "AWAITING_CHARGE", revision: 7 });
    const dispensePricesBeforeSecondRestart = secondDatabase.sqlite.prepare(`
      SELECT line.lot_number_snapshot, snapshot.medication_id, snapshot.unit_price_baht_snapshot,
        snapshot.currency, snapshot.order_price_snapshot_id
      FROM fulfillment_dispense_price_snapshots AS snapshot
      INNER JOIN fulfillment_dispense_lines AS line ON line.id = snapshot.fulfillment_dispense_line_id
      INNER JOIN fulfillment_dispenses AS dispense ON dispense.id = line.dispense_id
      WHERE dispense.visit_id = ?
      ORDER BY line.lot_number_snapshot
    `).all(visitId);
    expect(dispensePricesBeforeSecondRestart).toEqual([
      {
        lot_number_snapshot: "RESTART-EARLY",
        medication_id: "DEMO-MED-001",
        unit_price_baht_snapshot: 5,
        currency: "THB",
        order_price_snapshot_id: orderPriceSnapshotId,
      },
      {
        lot_number_snapshot: "RESTART-LATE",
        medication_id: "DEMO-MED-001",
        unit_price_baht_snapshot: 5,
        currency: "THB",
        order_price_snapshot_id: orderPriceSnapshotId,
      },
    ]);
    const checkoutBeforeSecondRestart = await secondApp.inject({
      method: "GET",
      url: `/api/checkout/${visitId}`,
      headers: { cookie: doctorCookie },
    });
    expect(checkoutBeforeSecondRestart.statusCode).toBe(200);
    expect(checkoutBeforeSecondRestart.json().data).toMatchObject({
      visit: { status: "AWAITING_CHARGE", revision: 7 },
      grossTotalBaht: 115,
      netDueBaht: 115,
    });

    await secondApp.close();
    secondDatabase.close();
    secondClosed = true;

    const thirdDatabase = openDatabase(databasePath);
    const thirdApp = await buildApp({
      db: thirdDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: (() => {
        let index = 0;
        return () => `restart-third-${++index}`;
      })(),
    });
    await thirdApp.ready();
    let thirdClosed = false;
    cleanups.push(async () => {
      if (!thirdClosed) {
        await thirdApp.close();
        thirdDatabase.close();
      }
    });
    expect(thirdDatabase.sqlite.prepare(`
      SELECT line.lot_number_snapshot, snapshot.medication_id, snapshot.unit_price_baht_snapshot,
        snapshot.currency, snapshot.order_price_snapshot_id
      FROM fulfillment_dispense_price_snapshots AS snapshot
      INNER JOIN fulfillment_dispense_lines AS line ON line.id = snapshot.fulfillment_dispense_line_id
      INNER JOIN fulfillment_dispenses AS dispense ON dispense.id = line.dispense_id
      WHERE dispense.visit_id = ?
      ORDER BY line.lot_number_snapshot
    `).all(visitId)).toEqual(dispensePricesBeforeSecondRestart);
    const checkoutAfterSecondRestart = await thirdApp.inject({
      method: "GET",
      url: `/api/checkout/${visitId}`,
      headers: { cookie: doctorCookie },
    });
    expect(checkoutAfterSecondRestart.statusCode).toBe(200);
    expect(checkoutAfterSecondRestart.json().data).toMatchObject({
      visit: { status: "AWAITING_CHARGE", revision: 7 },
      grossTotalBaht: 115,
      netDueBaht: 115,
    });

    const auditCountBeforeJourneyRead = Number(thirdDatabase.sqlite
      .prepare("SELECT count(*) FROM audit_events")
      .pluck()
      .get());
    const journeyBeforeCharge = await thirdApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/journey`,
      headers: { cookie: doctorCookie },
    });
    expect(journeyBeforeCharge.statusCode).toBe(200);
    const journeyBeforeChargeData = journeyBeforeCharge.json().data;
    expect(journeyBeforeChargeData).toMatchObject({
      visit: { id: visitId, status: "AWAITING_CHARGE", revision: 7 },
      nextTask: { action: "FINALIZE_CHARGE", primaryRole: "doctor", availability: "AVAILABLE" },
      blockers: [],
    });
    const repeatedJourneyRead = await thirdApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/journey`,
      headers: { cookie: doctorCookie },
    });
    expect(repeatedJourneyRead.statusCode).toBe(200);
    expect(repeatedJourneyRead.json().data).toEqual(journeyBeforeChargeData);
    expect(Number(thirdDatabase.sqlite.prepare("SELECT count(*) FROM audit_events").pluck().get()))
      .toBe(auditCountBeforeJourneyRead);

    const charged = await thirdApp.inject({
      method: "POST",
      url: `/api/checkout/${visitId}/charge-finalizations`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-finalize-charge" },
      payload: {
        expectedRevisions: { visit: 7, clinicPricing: 1 },
        payload: { settlementIntent: "COLLECT" },
      },
    });
    expect(charged.statusCode).toBe(201);
    const chargedData = charged.json().data;
    expect(chargedData).toMatchObject({
      visit: { id: visitId, status: "AWAITING_PAYMENT", revision: 8 },
      grossTotalBaht: 115,
      netDueBaht: 115,
      collectionState: "AWAITING_COLLECTION",
      charge: { id: expect.any(String) },
    });

    const cash = await thirdApp.inject({
      method: "POST",
      url: `/api/checkout/${visitId}/payments/cash`,
      headers: { cookie: assistantCookie, "idempotency-key": "restart-record-cash" },
      payload: {
        expectedRevisions: { visit: 8 },
        payload: { chargeId: chargedData.charge.id, amountBaht: 115 },
      },
    });
    expect(cash.statusCode).toBe(201);
    const paymentId = thirdDatabase.sqlite
      .prepare("SELECT id FROM finance_payments WHERE visit_id = ?")
      .pluck()
      .get(visitId) as string;
    expect(paymentId).toMatch(/\S/);
    expect(cash.json().data).toMatchObject({
      visit: { id: visitId, status: "READY_TO_CLOSE", revision: 9 },
      netDueBaht: 115,
      resolution: { kind: "PAYMENT", paymentId, method: "CASH" },
    });

    const closed = await thirdApp.inject({
      method: "POST",
      url: `/api/visits/${visitId}/close`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-close-visit" },
      payload: {
        expectedRevisions: { visit: 9 },
        payload: { chargeId: chargedData.charge.id, resolution: { kind: "PAYMENT", paymentId } },
      },
    });
    expect(closed.statusCode).toBe(201);
    const closure = closed.json().data;
    expect(closure).toMatchObject({ id: expect.any(String), visitId, chargeId: chargedData.charge.id });

    const journeyAfterClosure = await thirdApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/journey`,
      headers: { cookie: doctorCookie },
    });
    expect(journeyAfterClosure.statusCode).toBe(200);
    const journeyAfterClosureData = journeyAfterClosure.json().data;
    expect(journeyAfterClosureData).toMatchObject({
      visit: { id: visitId, status: "CLOSED", revision: 10 },
      nextTask: { action: "OPEN_OPD_CARD", primaryRole: "doctor", availability: "AVAILABLE" },
      blockers: [],
    });
    const allergyAfterClosure = await thirdApp.inject({
      method: "GET",
      url: `/api/patients/${patient.id}/allergy-assessment`,
      headers: { cookie: doctorCookie },
    });
    expect(allergyAfterClosure.statusCode).toBe(200);
    const stockAfterClosure = thirdDatabase.sqlite.prepare(`
      SELECT
        COALESCE(SUM(quantity_delta), 0) AS onHand,
        COALESCE((SELECT SUM(quantity) FROM inventory_reservation_allocations allocation
          INNER JOIN inventory_reservations reservation ON reservation.id = allocation.reservation_id
          WHERE allocation.lot_id IN (SELECT id FROM inventory_lots WHERE lot_number IN ('RESTART-EARLY', 'RESTART-LATE'))
            AND reservation.status = 'ACTIVE'), 0) AS reserved
      FROM inventory_stock_movements
      WHERE lot_id IN (SELECT id FROM inventory_lots WHERE lot_number IN ('RESTART-EARLY', 'RESTART-LATE'))
    `).get() as { onHand: number; reserved: number };
    expect(stockAfterClosure).toEqual({ onHand: 0, reserved: 0 });
    const durableEvidence = {
      journey: journeyAfterClosureData,
      allergy: allergyAfterClosure.json().data,
      stock: stockAfterClosure,
      checkout: (await thirdApp.inject({ method: "GET", url: `/api/checkout/${visitId}`, headers: { cookie: doctorCookie } })).json().data,
      closure: thirdDatabase.sqlite.prepare(`
        SELECT id, visit_id AS visitId, charge_id AS chargeId, payment_id AS paymentId, waiver_adjustment_id AS waiverAdjustmentId, content_hash AS contentHash
        FROM visit_closures WHERE visit_id = ?
      `).get(visitId),
      opd: (await thirdApp.inject({ method: "GET", url: `/api/visits/${visitId}/opd-card`, headers: { cookie: doctorCookie } })).json().data,
      counts: {
        charges: thirdDatabase.sqlite.prepare("SELECT count(*) FROM finance_charges WHERE visit_id = ?").pluck().get(visitId),
        payments: thirdDatabase.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE visit_id = ?").pluck().get(visitId),
        closures: thirdDatabase.sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = ?").pluck().get(visitId),
        dispenses: thirdDatabase.sqlite.prepare("SELECT count(*) FROM fulfillment_dispenses WHERE visit_id = ?").pluck().get(visitId),
      },
    };
    expect(durableEvidence.checkout).toMatchObject({
      visit: { status: "CLOSED", revision: 10 },
      charge: { id: chargedData.charge.id },
      resolution: { kind: "PAYMENT", paymentId, method: "CASH" },
      collectionState: "CLOSED",
    });
    expect(durableEvidence.counts).toEqual({ charges: 1, payments: 1, closures: 1, dispenses: 1 });

    await thirdApp.close();
    thirdDatabase.close();
    thirdClosed = true;

    const fourthDatabase = openDatabase(databasePath);
    const fourthApp = await buildApp({
      db: fourthDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: (() => {
        let index = 0;
        return () => `restart-fourth-${++index}`;
      })(),
    });
    await fourthApp.ready();
    cleanups.push(async () => {
      await fourthApp.close();
      fourthDatabase.close();
    });
    const afterFinalRestart = {
      journey: (await fourthApp.inject({ method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: doctorCookie } })).json().data,
      allergy: (await fourthApp.inject({ method: "GET", url: `/api/patients/${patient.id}/allergy-assessment`, headers: { cookie: doctorCookie } })).json().data,
      stock: fourthDatabase.sqlite.prepare(`
        SELECT
          COALESCE(SUM(quantity_delta), 0) AS onHand,
          COALESCE((SELECT SUM(quantity) FROM inventory_reservation_allocations allocation
            INNER JOIN inventory_reservations reservation ON reservation.id = allocation.reservation_id
            WHERE allocation.lot_id IN (SELECT id FROM inventory_lots WHERE lot_number IN ('RESTART-EARLY', 'RESTART-LATE'))
              AND reservation.status = 'ACTIVE'), 0) AS reserved
        FROM inventory_stock_movements
        WHERE lot_id IN (SELECT id FROM inventory_lots WHERE lot_number IN ('RESTART-EARLY', 'RESTART-LATE'))
      `).get(),
      checkout: (await fourthApp.inject({ method: "GET", url: `/api/checkout/${visitId}`, headers: { cookie: doctorCookie } })).json().data,
      closure: fourthDatabase.sqlite.prepare(`
        SELECT id, visit_id AS visitId, charge_id AS chargeId, payment_id AS paymentId, waiver_adjustment_id AS waiverAdjustmentId, content_hash AS contentHash
        FROM visit_closures WHERE visit_id = ?
      `).get(visitId),
      opd: (await fourthApp.inject({ method: "GET", url: `/api/visits/${visitId}/opd-card`, headers: { cookie: doctorCookie } })).json().data,
      counts: {
        charges: fourthDatabase.sqlite.prepare("SELECT count(*) FROM finance_charges WHERE visit_id = ?").pluck().get(visitId),
        payments: fourthDatabase.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE visit_id = ?").pluck().get(visitId),
        closures: fourthDatabase.sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = ?").pluck().get(visitId),
        dispenses: fourthDatabase.sqlite.prepare("SELECT count(*) FROM fulfillment_dispenses WHERE visit_id = ?").pluck().get(visitId),
      },
    };
    expect(afterFinalRestart).toEqual(durableEvidence);
  });
});
