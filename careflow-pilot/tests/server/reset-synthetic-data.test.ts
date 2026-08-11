import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmdirSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runResetSyntheticData, RESET_CONFIRMATION } from "../../src/server/maintenance/reset-synthetic.js";
import { maintenanceLockPath } from "../../src/server/host-lock.js";
import { openDatabase } from "../../src/server/db/client.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function populatedDatabase() {
  const fixture = await createTestApp();
  cleanups.push(fixture.cleanup);
  const account = await seedAccount(fixture.database, {
    id: "reset-assistant-001",
    username: "reset-assistant",
    role: "assistant",
    displayName: "ผู้ช่วยรีเซ็ต",
    mustChangePassword: false,
    pilotAcknowledgedAt: null,
  });
  const cookie = cookieFrom(await login(fixture.app, account.username, account.password));
  await fixture.app.inject({
    method: "POST",
    url: "/api/auth/acknowledge-pilot",
    headers: { cookie },
    payload: { accepted: true },
  });
  const patientResponse = await fixture.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie, "idempotency-key": "reset-patient-001" },
    payload: { expectedRevisions: {}, payload: {} },
  });
  const patient = patientResponse.json().data;
  const intakeResponse = await fixture.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie, "idempotency-key": "reset-intake-001" },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId: patient.id,
        chiefComplaint: "ไอ",
          vitals: {
            weightKg: 60,
            heightCm: 165,
            temperatureC: 37,
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
  const accountAuditCount = fixture.database.sqlite
    .prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'account.%'")
    .pluck()
    .get();
  await fixture.app.close();
  fixture.database.close();
  return { ...fixture, accountAuditCount };
}

function reset(databasePath: string, confirmation = RESET_CONFIRMATION): { code: number; output: string[]; errors: string[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const code = runResetSyntheticData({
    argv: ["--database", databasePath, "--confirm", confirmation],
    stdout: (line) => output.push(line),
    stderr: (line) => errors.push(line),
  });
  return { code, output, errors };
}

function seedClinicalEvidence(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    const now = "2026-08-03T00:00:00.000Z";
    const hash = "a".repeat(64);
    const patientId = database.prepare("SELECT id FROM patients").pluck().get() as string;
    const visitId = database.prepare("SELECT id FROM visits").pluck().get() as string;
    database.exec(`
      INSERT INTO patient_allergy_revisions VALUES ('reset-allergy-revision', '${patientId}', 2, 'NONE_KNOWN', 'source', 'reason', 'reset-assistant-001', '${now}');
      INSERT INTO patient_allergy_items VALUES ('reset-allergy-item', 'reset-allergy-revision', 0, 'substance', 'reaction', 'MILD', NULL);
      INSERT INTO clinical_note_drafts VALUES ('reset-note-draft', '${visitId}', 1, '', '', '', '', 'reset-assistant-001', 'reset-assistant-001', '${now}', '${now}');
      INSERT INTO clinical_note_draft_diagnoses VALUES ('reset-note-draft-diagnosis', 'reset-note-draft', 0, 'diagnosis');
      INSERT INTO clinical_notes (
        id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
        signed_by, signed_at, content_hash, signed_by_display_name
      ) VALUES ('reset-note', '${visitId}', 1, 'subjective', 'objective', 'assessment', 'plan', 1, 'reset-assistant-001', '${now}', '${hash}', 'ผู้ช่วยรีเซ็ต');
      INSERT INTO clinical_note_diagnoses VALUES ('reset-note-diagnosis', 'reset-note', 0, 'diagnosis');
      INSERT INTO clinical_note_amendments (
        id, clinical_note_id, version, content, reason, signed_by, signed_by_display_name, signed_at, content_hash
      ) VALUES ('reset-note-amendment', 'reset-note', 1, 'content', 'reason', 'reset-assistant-001', 'ผู้ช่วยรีเซ็ต', '${now}', '${hash}');
      INSERT INTO medication_decision_drafts VALUES ('reset-decision-draft', '${visitId}', 1, 'ORDER', NULL, 'reset-assistant-001', 'reset-assistant-001', '${now}', '${now}');
      INSERT INTO medication_order_draft_items VALUES ('reset-order-draft-item', 'reset-decision-draft', 0, 'DEMO-MED-001', 1, 1, 'ทดสอบ');
      INSERT INTO medication_decisions (
        id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
        signed_by, signed_at, content_hash, signed_by_display_name
      ) VALUES ('reset-decision', '${visitId}', 1, 'ORDER', NULL, NULL, NULL, 'reset-assistant-001', '${now}', '${hash}', 'ผู้ช่วยรีเซ็ต');
      INSERT INTO medication_order_items VALUES ('reset-order-item', 'reset-decision', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'ทดสอบ');
      INSERT INTO medication_order_price_snapshots (
        id, medication_order_item_id, medication_id, medication_revision, unit_price_baht_snapshot, currency, captured_at
      ) VALUES ('reset-order-price-snapshot', 'reset-order-item', 'DEMO-MED-001', 1, 5, 'THB', '${now}');
    `);
  } finally {
    database.close();
  }
}

function seedInventoryEvidence(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    const now = "2026-08-03T00:00:00.000Z";
    database.exec(`
      INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
      VALUES
        ('reset-receipt-early', 'clinic', 'ผู้จำหน่ายรีเซ็ต', 'หลักฐานหลายล็อตแรก', '${now}', 'reset-assistant-001'),
        ('reset-receipt-late', 'clinic', 'ผู้จำหน่ายรีเซ็ต', 'หลักฐานหลายล็อตหลัง', '${now}', 'reset-assistant-001');
      INSERT INTO inventory_lots (
        id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot,
        dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by
      ) VALUES
        ('reset-lot-early', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
         'เม็ดทดสอบ', 'เม็ด', 'RESET-EARLY', '2027-08-10', 'ผู้จำหน่ายรีเซ็ต', 'AVAILABLE', '${now}', 'reset-assistant-001'),
        ('reset-lot-late', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
         'เม็ดทดสอบ', 'เม็ด', 'RESET-LATE', '2027-08-20', 'ผู้จำหน่ายรีเซ็ต', 'AVAILABLE', '${now}', 'reset-assistant-001');
      INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
      VALUES
        ('reset-receipt-line-early', 'reset-receipt-early', 'reset-lot-early', 1, 'เม็ด'),
        ('reset-receipt-line-late', 'reset-receipt-late', 'reset-lot-late', 2, 'เม็ด');
      INSERT INTO inventory_stock_movements (
        id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id
      ) VALUES
        ('reset-movement-early', 'clinic', 'reset-lot-early', 'RECEIPT', 1, 'RECEIPT', 'reset-receipt-early', 'หลักฐานหลายล็อตแรก', '${now}', 'reset-assistant-001'),
        ('reset-movement-late', 'clinic', 'reset-lot-late', 'RECEIPT', 2, 'RECEIPT', 'reset-receipt-late', 'หลักฐานหลายล็อตหลัง', '${now}', 'reset-assistant-001');
    `);
  } finally {
    database.close();
  }
}

function seedMultiLotDispenseEvidence(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    const now = "2026-08-03T00:00:00.000Z";
    const patient = database.prepare("SELECT id, hn, display_name FROM patients ORDER BY id LIMIT 1").get() as {
      id: string;
      hn: string;
      display_name: string;
    };
    const visitId = database.prepare("SELECT id FROM visits ORDER BY id LIMIT 1").pluck().get() as string;
    database.exec(`
      INSERT INTO fulfillment_label_versions (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version,
        created_at, created_by, patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot
      ) VALUES (
        'reset-multi-label', 'clinic', '${visitId}', 'reset-decision', 1, 1,
        '${now}', 'reset-assistant-001', '${patient.hn}', '${patient.display_name}', 'คลินิกชนบท CareFlow Pilot'
      );
      INSERT INTO fulfillment_label_items (
        id, label_version_id, medication_order_item_id, position, medication_id, medication_revision,
        display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot,
        directions_th_snapshot, internal_barcode_snapshot
      ) VALUES (
        'reset-multi-label-item', 'reset-multi-label', 'reset-order-item', 0, 'DEMO-MED-001', 1,
        '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 3, 'เม็ด', 'ทดสอบ', 'CF-DEMO-001'
      );
      INSERT INTO inventory_reservations (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
        status, created_at, created_by
      ) VALUES (
        'reset-multi-reservation', 'clinic', '${visitId}', 'reset-decision', 1,
        'ACTIVE', '${now}', 'reset-assistant-001'
      );
      INSERT INTO inventory_reservation_allocations (
        id, reservation_id, medication_order_item_id, lot_id, position, quantity,
        medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
      ) VALUES
        ('reset-multi-allocation-early', 'reset-multi-reservation', 'reset-order-item', 'reset-lot-early', 0, 1,
         'DEMO-MED-001', 'RESET-EARLY', '2027-08-10', 'เม็ด', '${now}'),
        ('reset-multi-allocation-late', 'reset-multi-reservation', 'reset-order-item', 'reset-lot-late', 1, 2,
         'DEMO-MED-001', 'RESET-LATE', '2027-08-20', 'เม็ด', '${now}');
      INSERT INTO fulfillment_preparations (
        id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version,
        label_version_id, revision, status, minimum_print_sequence, created_at, created_by, completed_at, completed_by
      ) VALUES (
        'reset-multi-preparation', 'clinic', '${visitId}', 'reset-multi-reservation', 'reset-decision', 1,
        'reset-multi-label', 1, 'ACTIVE', 1, '${now}', 'reset-assistant-001', NULL, NULL
      );
      INSERT INTO fulfillment_label_print_events (
        id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot
      ) VALUES ('reset-multi-print', 'reset-multi-label', 1, '${now}', 'reset-assistant-001', 'reset-test', '80x100mm');
      INSERT INTO fulfillment_preparation_confirmations (
        id, preparation_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id,
        quantity, method, barcode_snapshot, manual_reason, confirmed_at, confirmed_by
      ) VALUES
        ('reset-multi-confirm-early', 'reset-multi-preparation', 'reset-multi-allocation-early', 'reset-order-item', 'DEMO-MED-001', 'reset-lot-early',
         1, 'BARCODE', 'CF-DEMO-001', NULL, '${now}', 'reset-assistant-001'),
        ('reset-multi-confirm-late', 'reset-multi-preparation', 'reset-multi-allocation-late', 'reset-order-item', 'DEMO-MED-001', 'reset-lot-late',
         2, 'BARCODE', 'CF-DEMO-001', NULL, '${now}', 'reset-assistant-001');
      UPDATE fulfillment_preparations SET
        revision = 2, status = 'COMPLETED', completed_at = '${now}', completed_by = 'reset-assistant-001'
      WHERE id = 'reset-multi-preparation';
      INSERT INTO fulfillment_releases (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id,
        label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by
      ) VALUES (
        'reset-multi-release', 'clinic', '${visitId}', 'reset-decision', 1, 'reset-multi-label',
        'reset-multi-print', 'reset-multi-preparation', 2, 'reset-multi-reservation', '${now}', 'reset-assistant-001'
      );
      INSERT INTO fulfillment_dispenses (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id,
        preparation_id, release_id, reservation_id, handed_off_at, handed_off_by
      ) VALUES (
        'reset-multi-dispense', 'clinic', '${visitId}', 'reset-decision', 1, 'reset-multi-label',
        'reset-multi-preparation', 'reset-multi-release', 'reset-multi-reservation', '${now}', 'reset-assistant-001'
      );
      INSERT INTO fulfillment_dispense_lines (
        id, dispense_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity,
        display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number_snapshot,
        expiry_date_snapshot, directions_th_snapshot
      ) VALUES
        ('reset-multi-dispense-line-early', 'reset-multi-dispense', 'reset-multi-allocation-early', 'reset-order-item', 'DEMO-MED-001', 'reset-lot-early', 1,
         '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'RESET-EARLY', '2027-08-10', 'ทดสอบ'),
        ('reset-multi-dispense-line-late', 'reset-multi-dispense', 'reset-multi-allocation-late', 'reset-order-item', 'DEMO-MED-001', 'reset-lot-late', 2,
         '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'RESET-LATE', '2027-08-20', 'ทดสอบ');
      INSERT INTO fulfillment_dispense_price_snapshots (
        id, fulfillment_dispense_line_id, order_price_snapshot_id, medication_id, unit_price_baht_snapshot, currency, captured_at
      ) VALUES
        ('reset-multi-price-early', 'reset-multi-dispense-line-early', 'reset-order-price-snapshot', 'DEMO-MED-001', 5, 'THB', '${now}'),
        ('reset-multi-price-late', 'reset-multi-dispense-line-late', 'reset-order-price-snapshot', 'DEMO-MED-001', 5, 'THB', '${now}');
      INSERT INTO inventory_stock_movements (
        id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id
      ) VALUES
        ('reset-multi-dispense-movement-early', 'clinic', 'reset-lot-early', 'DISPENSE', -1, 'DISPENSE', 'reset-multi-dispense-line-early', '', '${now}', 'reset-assistant-001'),
        ('reset-multi-dispense-movement-late', 'clinic', 'reset-lot-late', 'DISPENSE', -2, 'DISPENSE', 'reset-multi-dispense-line-late', '', '${now}', 'reset-assistant-001');
      UPDATE inventory_reservations SET
        status = 'CONSUMED', consumed_at = '${now}', consumed_by = 'reset-assistant-001', consumed_dispense_id = 'reset-multi-dispense'
      WHERE id = 'reset-multi-reservation';
    `);
  } finally {
    database.close();
  }
}

function seedFinanceEvidence(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    const now = "2026-08-03T00:00:00.000Z";
    const hash = "c".repeat(64);
    database.exec(`
      INSERT INTO staff_accounts (
        id, clinic_id, username, display_name, role, password_hash, must_change_password,
        active, revision, last_password_changed_at, created_at, updated_at
      ) VALUES (
        'reset-finance-doctor', 'clinic', 'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', 'doctor', 'hash', 0,
        1, 1, '${now}', '${now}', '${now}'
      );
      INSERT INTO patients (
        id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
      ) VALUES (
        'reset-finance-patient', 'clinic', 'DEMO-999999', 'ผู้ป่วยทดสอบ 999999', '0000009999',
        '1990-01-01', 'unknown', 1, '${now}', '${now}'
      );
      INSERT INTO visits (
        id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
      ) VALUES (
        'reset-finance-payment-visit', 'clinic', 'reset-finance-patient', 'AWAITING_CHARGE', 'ทดสอบรีเซ็ต', 1,
        '${now}', '${now}', 'reset-finance-doctor'
      );
      INSERT INTO clinical_notes (
        id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
        signed_by, signed_by_display_name, signed_at, content_hash
      ) VALUES (
        'reset-finance-note-payment', 'reset-finance-payment-visit', 1, 'subjective', 'objective', 'assessment',
        'plan', 1, 'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', '${now}', '${hash}'
      );
      INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
      VALUES ('reset-finance-diagnosis-payment', 'reset-finance-note-payment', 0, 'วินิจฉัยเพื่อปิด Visit');
      INSERT INTO medication_decisions (
        id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
        signed_by, signed_by_display_name, signed_at, content_hash
      ) VALUES (
        'reset-finance-decision-payment', 'reset-finance-payment-visit', 1, 'NO_MEDICATION', 'ไม่มีข้อบ่งใช้ยา',
        NULL, NULL, 'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', '${now}', '${hash}'
      );
      INSERT INTO finance_charges (
        id, clinic_id, visit_id, source_kind, medication_decision_id, medication_decision_version,
        fulfillment_dispense_id, clinic_pricing_revision, consultation_fee_baht_snapshot, currency,
        line_count, finalized_by, finalized_by_display_name, finalized_at, content_hash
      ) VALUES (
        'reset-finance-charge-payment', 'clinic', 'reset-finance-payment-visit', 'NO_MEDICATION',
        'reset-finance-decision-payment', 1, NULL, 1, 100, 'THB', 1,
        'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', '${now}', '${hash}'
      );
      INSERT INTO finance_charge_lines (
        id, charge_id, position, line_type, description_snapshot, quantity, unit_price_baht,
        line_total_baht, medication_order_item_id, fulfillment_dispense_line_id
      ) VALUES (
        'reset-finance-line-payment', 'reset-finance-charge-payment', 0, 'CONSULTATION', 'ค่าตรวจ', 1, 100,
        100, NULL, NULL
      );
      UPDATE visits SET status = 'AWAITING_PAYMENT', revision = 2 WHERE id = 'reset-finance-payment-visit';
      INSERT INTO finance_payments (
        id, charge_id, visit_id, method, amount_baht, manual_reference, confirmed_by,
        confirmed_by_display_name, confirmed_at, content_hash
      ) VALUES (
        'reset-finance-payment', 'reset-finance-charge-payment', 'reset-finance-payment-visit', 'CASH', 100,
        NULL, 'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', '${now}', '${hash}'
      );
      UPDATE visits SET status = 'READY_TO_CLOSE', revision = 3 WHERE id = 'reset-finance-payment-visit';
      INSERT INTO visit_closures (
        id, clinic_id, visit_id, visit_revision, charge_id, payment_id, waiver_adjustment_id,
        clinic_name_snapshot, patient_id_snapshot, patient_hn_snapshot, patient_display_name_snapshot,
        patient_birth_date_snapshot, patient_sex_snapshot, doctor_id_snapshot, doctor_display_name_snapshot,
        closed_at, content_hash
      ) VALUES (
        'reset-finance-closure', 'clinic', 'reset-finance-payment-visit', 3,
        'reset-finance-charge-payment', 'reset-finance-payment', NULL,
        'คลินิกชนบท CareFlow Pilot', 'reset-finance-patient', 'DEMO-999999', 'ผู้ป่วยทดสอบ 999999',
        '1990-01-01', 'unknown', 'reset-finance-doctor', 'พญ. รีเซ็ตการเงิน', '${now}', '${hash}'
      );
      UPDATE visits SET status = 'CLOSED', revision = 4, closed_at = '${now}' WHERE id = 'reset-finance-payment-visit';
      INSERT INTO audit_events (
        id, clinic_id, actor_id, actor_role, action, entity_type, entity_id, entity_revision, reason, occurred_at, metadata_json
      ) VALUES (
        'reset-finance-audit', 'clinic', 'reset-finance-doctor', 'doctor', 'charge.finalized', 'finance_charge',
        'reset-finance-charge-payment', 2, NULL, '${now}', '{}'
      );
    `);
  } finally {
    database.close();
  }
}

function seedFulfillmentAuditEvidence(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    const actions = [
      "label.version-created",
      "label.print-requested",
      "preparation.rejected",
      "fulfillment.artifacts-invalidated",
      "fulfillment.released",
      "fulfillment.rejected",
      "medication.release-created",
      "dispense.handoff-confirmed",
      "inventory.stock-dispensed",
      "inventory.reservation-released",
      "visit.handoff-confirmed",
    ];
    const insert = database.prepare(`
      INSERT INTO audit_events (
        id, clinic_id, actor_id, actor_role, action, entity_type, entity_id,
        entity_revision, reason, occurred_at, metadata_json
      ) VALUES (?, 'clinic', 'reset-assistant-001', 'assistant', ?, 'reset', ?, 1, 'reset test', ?, '{}')
    `);
    const transaction = database.transaction(() => {
      actions.forEach((action, index) => insert.run(`reset-fulfillment-audit-${index}`, action, `reset-evidence-${index}`, "2026-08-03T00:00:00.000Z"));
    });
    transaction();
  } finally {
    database.close();
  }
}

describe("guarded synthetic reset", () => {
  it("deletes only synthetic workflow data and preserves accounts/account audit", async () => {
    const fixture = await populatedDatabase();
    seedClinicalEvidence(fixture.databasePath);
    seedInventoryEvidence(fixture.databasePath);
    seedMultiLotDispenseEvidence(fixture.databasePath);
    seedFinanceEvidence(fixture.databasePath);
    seedFulfillmentAuditEvidence(fixture.databasePath);
    const beforeReset = new Database(fixture.databasePath);
    try {
      expect(beforeReset.prepare("SELECT status, revision FROM visits WHERE id = 'reset-finance-payment-visit'").get())
        .toEqual({ status: "CLOSED", revision: 4 });
      expect(beforeReset.prepare("SELECT count(*) FROM visit_closures WHERE id = 'reset-finance-closure'").pluck().get()).toBe(1);
      expect(beforeReset.prepare(`
        SELECT line.lot_number_snapshot, snapshot.unit_price_baht_snapshot
        FROM fulfillment_dispense_price_snapshots AS snapshot
        INNER JOIN fulfillment_dispense_lines AS line ON line.id = snapshot.fulfillment_dispense_line_id
        WHERE line.dispense_id = 'reset-multi-dispense'
        ORDER BY line.lot_number_snapshot
      `).all()).toEqual([
        { lot_number_snapshot: "RESET-EARLY", unit_price_baht_snapshot: 5 },
        { lot_number_snapshot: "RESET-LATE", unit_price_baht_snapshot: 5 },
      ]);
    } finally {
      beforeReset.close();
    }
    const result = reset(fixture.databasePath);

    expect(result.code).toBe(0);
    expect(result.output).toEqual(["Synthetic Pilot data reset complete"]);
    expect(result.errors).toEqual([]);
    const database = new Database(fixture.databasePath);
    try {
      expect(database.prepare("SELECT count(*) FROM patients").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM visits").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM intake_observations").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM idempotency_records").pluck().get()).toBe(0);
      for (const table of [
        "patient_allergy_items",
        "patient_allergy_revisions",
        "clinical_note_draft_diagnoses",
        "clinical_note_drafts",
        "clinical_note_diagnoses",
        "clinical_note_amendments",
        "clinical_notes",
        "medication_order_draft_items",
        "medication_decision_drafts",
        "medication_order_items",
        "medication_order_price_snapshots",
        "fulfillment_dispense_price_snapshots",
        "fulfillment_dispense_lines",
        "fulfillment_dispenses",
        "fulfillment_releases",
        "fulfillment_rejections",
        "fulfillment_artifact_invalidations",
        "fulfillment_preparation_confirmations",
        "fulfillment_preparations",
        "fulfillment_label_print_events",
        "fulfillment_label_items",
        "fulfillment_label_versions",
        "finance_payments",
        "finance_charge_adjustments",
        "finance_charge_lines",
        "finance_charges",
        "medication_decisions",
        "inventory_stock_movements",
        "inventory_adjustments",
        "inventory_lot_status_events",
        "inventory_receipt_lines",
        "inventory_receipts",
        "inventory_reservation_allocations",
        "inventory_reservations",
        "inventory_lots",
        "visit_closures",
      ]) {
        expect(database.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
      }
      expect(database.prepare("SELECT id, display_name, active, revision, unit_price_baht FROM medications ORDER BY id").all()).toEqual([
        { id: "DEMO-MED-001", display_name: "[DEMO] ยาทดสอบชนิด A", active: 1, revision: 1, unit_price_baht: 5 },
        { id: "DEMO-MED-002", display_name: "[DEMO] ยาทดสอบชนิด B", active: 1, revision: 1, unit_price_baht: 10 },
        { id: "DEMO-MED-003", display_name: "[DEMO] ยาทดสอบชนิด C", active: 1, revision: 1, unit_price_baht: 50 },
        { id: "DEMO-MED-004", display_name: "[DEMO] ยาทดสอบชนิด D", active: 1, revision: 1, unit_price_baht: 15 },
      ]);
      expect(database.prepare("SELECT consultation_fee_baht, pricing_revision FROM clinic_config WHERE id = 'clinic'").get())
        .toEqual({ consultation_fee_baht: 100, pricing_revision: 1 });
      expect(database.prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM staff_accounts").pluck().get()).toBe(2);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'account.%'").pluck().get()).toBe(fixture.accountAuditCount);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'patient.%' OR action LIKE 'visit.%' OR action LIKE 'allergy.%' OR action LIKE 'note.%' OR action LIKE 'medication.%' OR action LIKE 'inventory.%' OR action LIKE 'label.%' OR action LIKE 'preparation.%' OR action LIKE 'fulfillment.%' OR action LIKE 'dispense.%' OR action LIKE 'charge.%' OR action LIKE 'payment.%'").pluck().get()).toBe(0);
      expect(Number(fixture.accountAuditCount)).toBeGreaterThan(0);
      expect(() => database.prepare("DELETE FROM audit_events WHERE action LIKE 'account.%'").run()).toThrow("append-only");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'inventory_reservations_after_closure_block_insert',
          'inventory_reservations_after_closure_block_delete',
          'inventory_reservation_allocations_after_closure_block_insert',
          'inventory_reservations_closed_id_conflict_guard',
          'inventory_reservation_allocations_closed_id_conflict_guard'
        ) ORDER BY name
      `).all()).toEqual([
        { name: "inventory_reservation_allocations_after_closure_block_insert" },
        { name: "inventory_reservation_allocations_closed_id_conflict_guard" },
        { name: "inventory_reservations_after_closure_block_delete" },
        { name: "inventory_reservations_after_closure_block_insert" },
        { name: "inventory_reservations_closed_id_conflict_guard" },
      ]);
      expect(database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name IN (
          'visit_closures_block_update',
          'visit_closures_block_delete',
          'finance_charges_block_delete',
          'finance_payments_block_delete',
          'fulfillment_dispense_price_snapshots_block_delete',
          'medication_order_price_snapshots_block_delete'
        ) ORDER BY name
      `).all()).toEqual([
        { name: "finance_charges_block_delete" },
        { name: "finance_payments_block_delete" },
        { name: "fulfillment_dispense_price_snapshots_block_delete" },
        { name: "medication_order_price_snapshots_block_delete" },
        { name: "visit_closures_block_delete" },
        { name: "visit_closures_block_update" },
      ]);
      expect(database.prepare(`
        SELECT count(*) FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE '%_protected_insert_conflict_guard'
      `).pluck().get()).toBe(46);
      expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'visits_closed_insert_guard'",
      ).get()).toEqual({ name: "visits_closed_insert_guard" });
      const medicationBeforeReplace = Buffer.from(JSON.stringify(database.prepare(
        "SELECT * FROM medications WHERE id = 'DEMO-MED-001'",
      ).get()));
      database.pragma("recursive_triggers = OFF");
      expect(() => database.prepare(`
        INSERT OR REPLACE INTO medications (
          id, display_name, strength_text, dosage_form_text, canonical_unit,
          internal_barcode, active, revision, unit_price_baht, created_at, updated_at
        ) SELECT
          id, display_name, strength_text, dosage_form_text, canonical_unit,
          internal_barcode, active, revision, unit_price_baht, created_at, updated_at
        FROM medications WHERE id = 'DEMO-MED-001'
      `).run()).toThrow("medications insert conflicts with protected evidence");
      expect(Buffer.from(JSON.stringify(database.prepare(
        "SELECT * FROM medications WHERE id = 'DEMO-MED-001'",
      ).get()))).toEqual(medicationBeforeReplace);
    } finally {
      database.close();
    }

    expect(reset(fixture.databasePath)).toMatchObject({
      code: 0,
      output: ["Synthetic Pilot data reset complete"],
      errors: [],
    });
  });

  it("rejects a live host lock and wrong confirmation without changing bytes", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    const beforeWhileOpen = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    const live = reset(fixture.databasePath);
    expect(live.code).toBe(1);
    expect(live.errors).toEqual(["Synthetic Pilot data reset failed"]);
    await fixture.app.close();
    fixture.database.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    const wrong = reset(fixture.databasePath, "RESET");
    expect(wrong.code).toBe(1);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(after).toBe(before);
    expect(before).not.toBe("");
    expect(beforeWhileOpen).not.toBe("");
  });

  it("rejects unknown application tables byte-for-byte unchanged", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const foreign = new Database(fixture.databasePath);
    foreign.exec("CREATE TABLE unexpected_reset_table(value TEXT NOT NULL)");
    foreign.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");

    const result = reset(fixture.databasePath);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(result.code).toBe(1);
    expect(after).toBe(before);
  });

  it("rejects a tampered migration record before opening a writable reset transaction", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const tampered = new Database(fixture.databasePath);
    tampered.prepare("UPDATE __drizzle_migrations SET hash = 'evil' WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)").run();
    tampered.close();
    const before = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");

    const result = reset(fixture.databasePath);
    const after = createHash("sha256").update(readFileSync(fixture.databasePath)).digest("hex");
    expect(result.code).toBe(1);
    expect(after).toBe(before);
  });

  it("prevents a Clinic Host from starting while the maintenance lock is held", async () => {
    const fixture = await createTestApp();
    cleanups.push(fixture.cleanup);
    fixture.database.close();
    const lockPath = maintenanceLockPath(fixture.databasePath);
    mkdirSync(lockPath, { mode: 0o700 });
    try {
      expect(() => openDatabase(fixture.databasePath)).toThrow("synthetic maintenance");
    } finally {
      rmdirSync(lockPath);
    }
  });
});
