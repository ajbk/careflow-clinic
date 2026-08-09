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
  netDueBaht: number;
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(sourceKind: "NO_MEDICATION" | "ORDER" = "NO_MEDICATION"): Promise<CompletionFixture> {
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
      'completion-decision', 'completion-visit', 1, '${sourceKind}',
      ${sourceKind === "NO_MEDICATION" ? "'ไม่มีข้อบ่งใช้ยา'" : "NULL"}, NULL, NULL,
      'completion-doctor', 'พญ. หลักฐาน OPD',
      '${NOW}', '${HASH}'
    );
  `);
  if (sourceKind === "ORDER") seedOrderMultiLotEvidence(test);
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
    payload: {
      expectedRevisions: { visit: 8 },
      payload: {
        chargeId: charge.id,
        amountBaht: (finalized.json() as { data: CheckoutData }).data.netDueBaht,
      },
    },
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
  expect(test.database.sqlite.prepare(
    "SELECT status, revision, closed_at FROM visits WHERE id = 'completion-visit'",
  ).get()).toEqual({
    status: "CLOSED",
    revision: 10,
    closed_at: NOW,
  });
  expect(test.database.sqlite.prepare(
    "SELECT count(*) FROM visit_closures WHERE visit_id = 'completion-visit'",
  ).pluck().get()).toBe(1);
  const data = (firstClose.json() as { data: { id: string; contentHash: string } }).data;
  return { closureId: data.id, contentHash: data.contentHash };
}

function seedOrderMultiLotEvidence(test: Awaited<ReturnType<typeof createTestApp>>): void {
  test.database.sqlite.exec(`
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot,
      quantity, directions_th
    ) VALUES (
      'completion-order-multi-lot', 'completion-decision', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 5,
      'รับประทานหลังอาหาร'
    );
    INSERT INTO medication_order_price_snapshots (
      id, medication_order_item_id, medication_id, medication_revision,
      unit_price_baht_snapshot, currency, captured_at
    ) VALUES (
      'completion-order-price', 'completion-order-multi-lot', 'DEMO-MED-001', 1, 5, 'THB', '${NOW}'
    );
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, display_name_snapshot,
      strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
      supplier_name, status, created_at, created_by
    ) VALUES
      ('completion-order-lot-a', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
       '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'OPD-LOT-A', '2027-08-10',
       'ผู้ขายทดสอบ', 'AVAILABLE', '${NOW}', 'completion-doctor'),
      ('completion-order-lot-b', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
       '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'OPD-LOT-B', '2027-09-10',
       'ผู้ขายทดสอบ', 'AVAILABLE', '${NOW}', 'completion-doctor');
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      status, created_at, created_by
    ) VALUES (
      'completion-order-reservation', 'clinic', 'completion-visit', 'completion-decision', 1,
      'ACTIVE', '${NOW}', 'completion-doctor'
    );
    INSERT INTO inventory_reservation_allocations (
      id, reservation_id, medication_order_item_id, lot_id, position, quantity,
      medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
    ) VALUES
      ('completion-order-allocation-a', 'completion-order-reservation',
       'completion-order-multi-lot', 'completion-order-lot-a', 0, 2, 'DEMO-MED-001',
       'OPD-LOT-A', '2027-08-10', 'เม็ด', '${NOW}'),
      ('completion-order-allocation-b', 'completion-order-reservation',
       'completion-order-multi-lot', 'completion-order-lot-b', 1, 3, 'DEMO-MED-001',
       'OPD-LOT-B', '2027-09-10', 'เม็ด', '${NOW}');
    INSERT INTO fulfillment_label_versions (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      version, created_at, created_by, patient_hn_snapshot,
      patient_display_name_snapshot, clinic_name_snapshot
    ) VALUES (
      'completion-order-label', 'clinic', 'completion-visit', 'completion-decision', 1,
      1, '${NOW}', 'completion-doctor', 'DEMO-000019', 'ผู้ป่วยทดสอบ 000019',
      'คลินิกชนบท CareFlow Pilot'
    );
    INSERT INTO fulfillment_label_items (
      id, label_version_id, medication_order_item_id, position, medication_id,
      medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot,
      quantity, unit_snapshot, directions_th_snapshot, internal_barcode_snapshot
    ) VALUES (
      'completion-order-label-item', 'completion-order-label', 'completion-order-multi-lot',
      0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
      'เม็ดทดสอบ', 5, 'เม็ด', 'รับประทานหลังอาหาร', 'CF-DEMO-001'
    );
    INSERT INTO fulfillment_label_print_events (
      id, label_version_id, sequence, requested_at, requested_by,
      renderer_version, media_size_snapshot
    ) VALUES (
      'completion-order-print', 'completion-order-label', 1, '${NOW}',
      'completion-doctor', 'test', '80x100mm'
    );
    INSERT INTO fulfillment_preparations (
      id, clinic_id, visit_id, reservation_id, medication_decision_id,
      medication_decision_version, label_version_id, revision, status,
      minimum_print_sequence, created_at, created_by
    ) VALUES (
      'completion-order-preparation', 'clinic', 'completion-visit',
      'completion-order-reservation', 'completion-decision', 1, 'completion-order-label',
      1, 'ACTIVE', 1, '${NOW}', 'completion-doctor'
    );
    UPDATE fulfillment_preparations SET
      status = 'COMPLETED', revision = 2, completed_at = '${NOW}', completed_by = 'completion-doctor'
    WHERE id = 'completion-order-preparation';
    INSERT INTO fulfillment_releases (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      label_version_id, label_print_event_id, preparation_id, preparation_revision,
      reservation_id, released_at, released_by
    ) VALUES (
      'completion-order-release', 'clinic', 'completion-visit', 'completion-decision', 1,
      'completion-order-label', 'completion-order-print', 'completion-order-preparation', 2,
      'completion-order-reservation', '${NOW}', 'completion-doctor'
    );
    INSERT INTO fulfillment_dispenses (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      label_version_id, preparation_id, release_id, reservation_id, handed_off_at, handed_off_by
    ) VALUES (
      'completion-order-dispense', 'clinic', 'completion-visit', 'completion-decision', 1,
      'completion-order-label', 'completion-order-preparation', 'completion-order-release',
      'completion-order-reservation', '${NOW}', 'completion-doctor'
    );
    INSERT INTO fulfillment_dispense_lines (
      id, dispense_id, reservation_allocation_id, medication_order_item_id,
      medication_id, lot_id, quantity, display_name_snapshot, strength_snapshot,
      dosage_form_snapshot, unit_snapshot, lot_number_snapshot, expiry_date_snapshot,
      directions_th_snapshot
    ) VALUES
      ('completion-order-dispense-line-a', 'completion-order-dispense',
       'completion-order-allocation-a', 'completion-order-multi-lot', 'DEMO-MED-001',
       'completion-order-lot-a', 2, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
       'เม็ดทดสอบ', 'เม็ด', 'OPD-LOT-A', '2027-08-10', 'รับประทานหลังอาหาร'),
      ('completion-order-dispense-line-b', 'completion-order-dispense',
       'completion-order-allocation-b', 'completion-order-multi-lot', 'DEMO-MED-001',
       'completion-order-lot-b', 3, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
       'เม็ดทดสอบ', 'เม็ด', 'OPD-LOT-B', '2027-09-10', 'รับประทานหลังอาหาร');
    INSERT INTO fulfillment_dispense_price_snapshots (
      id, fulfillment_dispense_line_id, order_price_snapshot_id, medication_id,
      unit_price_baht_snapshot, currency, captured_at
    ) VALUES
      ('completion-order-dispense-price-a', 'completion-order-dispense-line-a',
       'completion-order-price', 'DEMO-MED-001', 5, 'THB', '${NOW}'),
      ('completion-order-dispense-price-b', 'completion-order-dispense-line-b',
       'completion-order-price', 'DEMO-MED-001', 5, 'THB', '${NOW}');
    UPDATE inventory_reservations SET
      status = 'CONSUMED', consumed_at = '${NOW}', consumed_by = 'completion-doctor',
      consumed_dispense_id = 'completion-order-dispense'
    WHERE id = 'completion-order-reservation';
  `);
}

function seedReleasedReservationEvidence(test: CompletionFixture): void {
  test.database.sqlite.exec(`
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot,
      quantity, directions_th
    ) VALUES (
      'completion-order-item', 'completion-decision', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'รับประทานตามคำแนะนำ'
    );
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, display_name_snapshot,
      strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
      supplier_name, status, created_at, created_by
    ) VALUES (
      'completion-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
      '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'CLOSE-LOT-001', '2027-08-10',
      'ผู้ขายทดสอบ', 'AVAILABLE', '${NOW}', 'completion-doctor'
    );
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      status, created_at, created_by
    ) VALUES (
      'completion-released-reservation', 'clinic', 'completion-visit', 'completion-decision', 1,
      'ACTIVE', '${NOW}', 'completion-doctor'
    );
    UPDATE inventory_reservations SET
      status = 'RELEASED', released_at = '${NOW}', released_by = 'completion-doctor',
      release_reason = 'ยกเลิกก่อนปิด Visit'
    WHERE id = 'completion-released-reservation';
  `);
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

  it("keeps the Doctor OPD and Closure chain byte-stable across both closed-Note replacement spellings", async () => {
    const test = await fixture();
    await close(test);
    test.database.sqlite.exec(`
      INSERT INTO patients (
        id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
      ) VALUES (
        'opd-replace-open-patient', 'clinic', 'DEMO-000018', 'ผู้ป่วยทดสอบ 000018',
        '0000000018', '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
      );
      INSERT INTO visits (
        id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
      ) VALUES (
        'opd-replace-open-visit', 'clinic', 'opd-replace-open-patient', 'CONSULTING',
        'ทดสอบป้องกัน OPD', 1, '${NOW}', '${NOW}', 'completion-doctor'
      );
    `);
    const beforeResponse = await test.app.inject({
      method: "GET",
      url: "/api/visits/completion-visit/opd-card",
      headers: { cookie: test.doctorCookie },
    });
    expect(beforeResponse.statusCode).toBe(200);
    const beforeCard = beforeResponse.json().data;
    const frozenTables = [
      "visits",
      "clinical_notes",
      "clinical_note_diagnoses",
      "medication_decisions",
      "finance_charges",
      "finance_charge_lines",
      "finance_payments",
      "visit_closures",
    ];
    const frozenBytes = Buffer.from(JSON.stringify(Object.fromEntries(frozenTables.map((table) => [
      table,
      test.database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]))));

    for (const insertVerb of ["REPLACE", "INSERT OR REPLACE"] as const) {
      expect(() => test.database.sqlite.prepare(`
        ${insertVerb} INTO clinical_notes (
          id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
          signed_by, signed_by_display_name, signed_at, content_hash
        ) VALUES (
          'completion-note', 'opd-replace-open-visit', 1, 'replacement S', 'replacement O',
          'replacement A', 'replacement P', 1, 'completion-doctor', 'พญ. หลักฐาน OPD',
          '${NOW}', '${"f".repeat(64)}'
        )
      `).run()).toThrow("clinical_notes insert conflicts with protected evidence");
      expect(Buffer.from(JSON.stringify(Object.fromEntries(frozenTables.map((table) => [
        table,
        test.database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]))))).toEqual(frozenBytes);
      expect(test.database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      const afterResponse = await test.app.inject({
        method: "GET",
        url: "/api/visits/completion-visit/opd-card",
        headers: { cookie: test.doctorCookie },
      });
      expect(afterResponse.statusCode).toBe(200);
      expect(afterResponse.json().data).toEqual(beforeCard);
    }
  });

  it("projects an ORDER dispense split across two lots without collapsing its OPD evidence", async () => {
    const test = await fixture("ORDER");
    await close(test);
    const response = await test.app.inject({
      method: "GET",
      url: "/api/visits/completion-visit/opd-card",
      headers: { cookie: test.doctorCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      medication: {
        kind: "ORDER",
        dispense: { id: "completion-order-dispense", handedOffAt: NOW },
        items: [
          {
            dispenseLineId: "completion-order-dispense-line-a",
            orderItemId: "completion-order-multi-lot",
            quantity: 2,
            lotNumber: "OPD-LOT-A",
            expiryDate: "2027-08-10",
          },
          {
            dispenseLineId: "completion-order-dispense-line-b",
            orderItemId: "completion-order-multi-lot",
            quantity: 3,
            lotNumber: "OPD-LOT-B",
            expiryDate: "2027-09-10",
          },
        ],
      },
      charge: {
        grossTotalBaht: 125,
        adjustmentTotalBaht: 0,
        netDueBaht: 125,
        lines: [
          { position: 0, lineType: "CONSULTATION", lineTotalBaht: 100 },
          {
            position: 1,
            lineType: "MEDICATION",
            fulfillmentDispenseLineId: "completion-order-dispense-line-a",
            quantity: 2,
            lineTotalBaht: 10,
          },
          {
            position: 2,
            lineType: "MEDICATION",
            fulfillmentDispenseLineId: "completion-order-dispense-line-b",
            quantity: 3,
            lineTotalBaht: 15,
          },
        ],
        resolution: { kind: "PAYMENT", amountBaht: 125 },
      },
    });
    expect(response.json().data.medication.items).toHaveLength(2);
    expect(response.json().data.charge.lines).toHaveLength(3);
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

  it("blocks inserting a reservation for a Visit after Closure", async () => {
    const test = await fixture();
    await close(test);
    expect(() => test.database.sqlite.prepare(`
      INSERT INTO inventory_reservations (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
        status, created_at, created_by
      ) VALUES (
        'completion-illegal-reservation', 'clinic', 'completion-visit', 'completion-decision', 1,
        'ACTIVE', '${NOW}', 'completion-doctor'
      )
    `).run()).toThrow(/reservation|closed|Closure/i);
  });

  it("blocks deleting a reservation for a Visit after Closure", async () => {
    const test = await fixture();
    seedReleasedReservationEvidence(test);
    await close(test);
    expect(() => test.database.sqlite.prepare(
      "DELETE FROM inventory_reservations WHERE id = 'completion-released-reservation'",
    ).run()).toThrow(/reservation|closed|Closure/i);
  });

  it("blocks inserting an allocation for a Visit reservation after Closure", async () => {
    const test = await fixture();
    seedReleasedReservationEvidence(test);
    await close(test);
    expect(() => test.database.sqlite.prepare(`
      INSERT INTO inventory_reservation_allocations (
        id, reservation_id, medication_order_item_id, lot_id, position, quantity,
        medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
      ) VALUES (
        'completion-illegal-allocation', 'completion-released-reservation',
        'completion-order-item', 'completion-lot', 0, 1, 'DEMO-MED-001',
        'CLOSE-LOT-001', '2027-08-10', 'เม็ด', '${NOW}'
      )
    `).run()).toThrow(/reservation|allocation|closed|Closure/i);
  });
});
