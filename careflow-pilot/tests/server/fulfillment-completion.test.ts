import { afterEach, describe, expect, it } from "vitest";
import {
  fulfillmentConfirmationBodySchema,
  fulfillmentCurrentLabelSchema,
  fulfillmentHandoffBodySchema,
  fulfillmentPickListSchema,
  fulfillmentRejectBodySchema,
  fulfillmentReleaseBodySchema,
} from "../../src/shared/contracts.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function database(): TestDatabase {
  const value = createTestDatabase();
  cleanups.push(value.cleanup);
  return value;
}

function seedChain(value: TestDatabase): void {
  const now = "2026-08-09T00:00:00.000Z";
  const hash = "a".repeat(64);
  value.sqlite.exec(`
    INSERT INTO staff_accounts (id, clinic_id, username, display_name, role, password_hash, must_change_password, active, revision, last_password_changed_at, created_at, updated_at)
    VALUES ('doctor-001', 'clinic', 'doctor-001', 'แพทย์ทดสอบ', 'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}');
    INSERT INTO patients (id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at)
    VALUES ('patient-001', 'clinic', 'DEMO-000001', 'ผู้ป่วยทดสอบ 000001', '0000000001', '1990-01-01', 'unknown', 1, '${now}', '${now}');
    INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, created_by)
    VALUES ('visit-001', 'clinic', 'patient-001', 'AWAITING_PREPARATION', 'ทดสอบ', 3, '${now}', 'doctor-001');
    INSERT INTO medication_decisions (id, visit_id, version, kind, signed_by, signed_at, content_hash, signed_by_display_name)
    VALUES ('decision-001', 'visit-001', 1, 'ORDER', 'doctor-001', '${now}', '${hash}', 'แพทย์ทดสอบ');
    INSERT INTO medication_order_items (id, medication_decision_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th)
    VALUES ('order-item-001', 'decision-001', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 2, 'ทดสอบ');
    INSERT INTO inventory_lots (id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by)
    VALUES ('lot-001', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'LOT-001', '2026-12-31', 'ผู้ขายทดสอบ', 'AVAILABLE', '${now}', 'doctor-001');
    INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
    VALUES ('receipt-001', 'clinic', 'ผู้ขายทดสอบ', '', '${now}', 'doctor-001');
    INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
    VALUES ('receipt-line-001', 'receipt-001', 'lot-001', 2, 'เม็ด');
    INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
    VALUES ('movement-001', 'clinic', 'lot-001', 'RECEIPT', 2, 'RECEIPT', 'receipt-001', '', '${now}', 'doctor-001');
    INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by)
    VALUES ('reservation-001', 'clinic', 'visit-001', 'decision-001', 1, 'ACTIVE', '${now}', 'doctor-001');
    INSERT INTO inventory_reservation_allocations (id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at)
    VALUES ('allocation-001', 'reservation-001', 'order-item-001', 'lot-001', 0, 2, 'DEMO-MED-001', 'LOT-001', '2026-12-31', 'เม็ด', '${now}');
    INSERT INTO fulfillment_label_versions (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version, created_at, created_by, patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot)
    VALUES ('label-001', 'clinic', 'visit-001', 'decision-001', 1, 1, '${now}', 'doctor-001', 'DEMO-000001', 'ผู้ป่วยทดสอบ 000001', 'คลินิกทดสอบ');
    INSERT INTO fulfillment_label_items (id, label_version_id, medication_order_item_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot, directions_th_snapshot, internal_barcode_snapshot)
    VALUES ('label-item-001', 'label-001', 'order-item-001', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 2, 'เม็ด', 'ทดสอบ', 'CF-DEMO-001');
    INSERT INTO fulfillment_label_print_events (id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot)
    VALUES ('print-001', 'label-001', 1, '${now}', 'doctor-001', 'test', '80x100mm');
    INSERT INTO fulfillment_preparations (id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version, label_version_id, revision, status, minimum_print_sequence, created_at, created_by)
    VALUES ('preparation-001', 'clinic', 'visit-001', 'reservation-001', 'decision-001', 1, 'label-001', 1, 'ACTIVE', 1, '${now}', 'doctor-001');
    INSERT INTO fulfillment_preparation_confirmations (id, preparation_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity, method, barcode_snapshot, manual_reason, confirmed_at, confirmed_by)
    VALUES ('confirmation-001', 'preparation-001', 'allocation-001', 'order-item-001', 'DEMO-MED-001', 'lot-001', 2, 'BARCODE', 'CF-DEMO-001', NULL, '${now}', 'doctor-001');
    INSERT INTO fulfillment_releases (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by)
    VALUES ('release-001', 'clinic', 'visit-001', 'decision-001', 1, 'label-001', 'print-001', 'preparation-001', 1, 'reservation-001', '${now}', 'doctor-001');
    INSERT INTO fulfillment_rejections (id, clinic_id, visit_id, preparation_id, reservation_id, label_version_id, print_sequence_at_rejection, reason, rejected_at, rejected_by)
    VALUES ('rejection-001', 'clinic', 'visit-001', 'preparation-001', 'reservation-001', 'label-001', 1, 'ทดสอบการปฏิเสธ', '${now}', 'doctor-001');
    INSERT INTO fulfillment_artifact_invalidations (id, clinic_id, visit_id, artifact_type, artifact_id, trigger, reason, invalidated_at, invalidated_by)
    VALUES ('invalidation-001', 'clinic', 'visit-001', 'RELEASE', 'release-001', 'REJECT', 'ทดสอบการยกเลิก', '${now}', 'doctor-001');
    INSERT INTO fulfillment_dispenses (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, preparation_id, release_id, reservation_id, handed_off_at, handed_off_by)
    VALUES ('dispense-001', 'clinic', 'visit-001', 'decision-001', 1, 'label-001', 'preparation-001', 'release-001', 'reservation-001', '${now}', 'doctor-001');
    INSERT INTO fulfillment_dispense_lines (id, dispense_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number_snapshot, expiry_date_snapshot, directions_th_snapshot)
    VALUES ('dispense-line-001', 'dispense-001', 'allocation-001', 'order-item-001', 'DEMO-MED-001', 'lot-001', 2, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'LOT-001', '2026-12-31', 'ทดสอบ');
  `);
}

describe("fulfillment completion persistence contracts", () => {
  it("requires a Doctor command to pin every reviewed fulfillment artifact", () => {
    expect(fulfillmentReleaseBodySchema.safeParse({ expectedRevisions: { visit: 5, preparation: 2 }, payload: { preparationId: "preparation-001" } }).success).toBe(false);
    expect(fulfillmentRejectBodySchema.safeParse({ expectedRevisions: { visit: 5, preparation: 2 }, payload: { preparationId: "preparation-001", reason: "ไม่ตรง" } }).success).toBe(false);
    expect(fulfillmentHandoffBodySchema.safeParse({ expectedRevisions: { visit: 6 }, payload: {} }).success).toBe(false);
    expect(fulfillmentReleaseBodySchema.safeParse({ expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: "decision-001", decisionVersion: 1, labelVersionId: "label-001", labelPrintEventId: "print-001", preparationId: "preparation-001", reservationId: "reservation-001" } }).success).toBe(true);
  });

  it("represents the signed ORDER label, preparation, release, and dispense chain with exact allocation associations", () => {
    const parsed = fulfillmentPickListSchema.parse({
      visit: { id: "visit-001", status: "AWAITING_HANDOFF", revision: 6, arrivedAt: "2026-08-09T00:00:00.000Z", startedAt: null },
      patient: { id: "patient-001", hn: "DEMO-000001", displayName: "ผู้ป่วยทดสอบ 000001", phone: "0000000001", birthDate: "1990-01-01", sex: "unknown", revision: 1, createdAt: "2026-08-09T00:00:00.000Z" },
      medicationDecision: { id: "decision-001", version: 1, kind: "ORDER" },
      label: { id: "label-001", medicationDecisionId: "decision-001", medicationDecisionVersion: 1, version: 1, clinicNameSnapshot: "คลินิกทดสอบ", patientHnSnapshot: "DEMO-000001", patientDisplayNameSnapshot: "ผู้ป่วยทดสอบ 000001", items: [{ orderItemId: "order-item-001", medicationId: "DEMO-MED-001", medicationRevision: 1, displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A", strengthSnapshot: "500 หน่วยทดสอบ", dosageFormSnapshot: "เม็ดทดสอบ", quantity: 2, unitSnapshot: "เม็ด", directionsThSnapshot: "ทดสอบ", internalBarcode: "CF-DEMO-001" }] },
      reservation: { id: "reservation-001", allocations: [{ id: "allocation-001", orderItemId: "order-item-001", lotId: "lot-001", quantity: 2 }] },
      preparation: { id: "preparation-001", revision: 1, status: "COMPLETED", minimumPrintSequence: 1, latestPrintEventId: "print-001", latestPrintSequence: 1, confirmations: [{ allocationId: "allocation-001", orderItemId: "order-item-001", lotId: "lot-001", method: "BARCODE", barcode: "CF-DEMO-001" }] },
      release: { id: "release-001", reservationId: "reservation-001" },
      dispense: { id: "dispense-001", reservationId: "reservation-001", lines: [{ allocationId: "allocation-001", orderItemId: "order-item-001", lotId: "lot-001", quantity: 2 }] },
      allowedActions: ["HANDOFF"],
    });

    expect(parsed.preparation?.confirmations[0]).toMatchObject({ allocationId: "allocation-001", lotId: "lot-001" });
    expect(parsed.dispense?.lines[0]).toMatchObject({ orderItemId: "order-item-001", lotId: "lot-001" });
    expect(fulfillmentCurrentLabelSchema.parse(null)).toBeNull();
  });

  it("represents NO_MEDICATION and an absent decision without any fulfillment artifacts", () => {
    const base = {
      visit: { id: "visit-001", status: "AWAITING_CHARGE" as const, revision: 4, arrivedAt: "2026-08-09T00:00:00.000Z", startedAt: null },
      patient: { id: "patient-001", hn: "DEMO-000001", displayName: "ผู้ป่วยทดสอบ 000001", phone: "0000000001", birthDate: "1990-01-01", sex: "unknown" as const, revision: 1, createdAt: "2026-08-09T00:00:00.000Z" },
      label: null,
      reservation: null,
      preparation: null,
      release: null,
      dispense: null,
      allowedActions: [] as const,
    };
    expect(fulfillmentPickListSchema.parse({
      ...base,
      medicationDecision: { id: "decision-no-med", version: 1, kind: "NO_MEDICATION", noMedicationReason: "อาการไม่จำเป็นต้องใช้ยา" },
    }).medicationDecision?.kind).toBe("NO_MEDICATION");
    expect(fulfillmentPickListSchema.parse({ ...base, medicationDecision: null }).medicationDecision).toBeNull();
    expect(fulfillmentPickListSchema.safeParse({
      ...base,
      medicationDecision: { id: "decision-no-med", version: 1, kind: "NO_MEDICATION", noMedicationReason: "ไม่ใช้ยา" },
      label: { id: "label-should-not-exist", medicationDecisionId: "decision-no-med", medicationDecisionVersion: 1, version: 1, items: [] },
    }).success).toBe(false);
    expect(fulfillmentPickListSchema.safeParse({
      ...base,
      medicationDecision: null,
      dispense: { id: "dispense-should-not-exist", reservationId: "reservation-should-not-exist", lines: [] },
    }).success).toBe(false);
  });

  it("accepts method-specific confirmation evidence and rejects missing manual reason or unknown command keys", () => {
    expect(fulfillmentConfirmationBodySchema.safeParse({
      expectedRevisions: { visit: 3, preparation: 1 },
      payload: { method: "BARCODE", allocationId: "allocation-001", preparationId: "preparation-001", barcode: "CF-DEMO-001" },
    }).success).toBe(true);
    expect(fulfillmentConfirmationBodySchema.safeParse({
      expectedRevisions: { visit: 3, preparation: 1 },
      payload: { method: "MANUAL", allocationId: "allocation-001", preparationId: "preparation-001", reason: "  " },
    }).success).toBe(false);
    expect(fulfillmentConfirmationBodySchema.safeParse({
      expectedRevisions: { visit: 3, preparation: 1 },
      payload: { method: "BARCODE", allocationId: "allocation-001", preparationId: "preparation-001", barcode: "CF-DEMO-001", extra: true },
    }).success).toBe(false);
  });

  it("rejects updates and deletes to all fulfillment and inventory evidence tables at the database boundary", () => {
    const value = database();
    seedChain(value);

    for (const table of [
      "inventory_reservation_allocations",
      "fulfillment_preparation_confirmations",
      "fulfillment_label_items",
      "fulfillment_label_versions",
      "fulfillment_label_print_events",
      "fulfillment_releases",
      "fulfillment_rejections",
      "fulfillment_artifact_invalidations",
      "fulfillment_dispense_lines",
      "inventory_stock_movements",
    ]) {
      expect(() => value.sqlite.prepare(`UPDATE ${table} SET id = id`).run()).toThrow(`${table} are append-only`);
      expect(() => value.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow(`${table} are append-only`);
    }
  });

  it("rejects unsafe reservation consumption and identity changes at the database boundary", () => {
    const value = database();
    seedChain(value);

    expect(() => value.sqlite.prepare(`
      UPDATE inventory_reservations
      SET status = 'CONSUMED', consumed_at = '2026-08-09T00:00:00.000Z', consumed_by = 'doctor-001', consumed_dispense_id = 'fake-dispense'
      WHERE id = 'reservation-001'
    `).run()).toThrow(/consumed reservation|dispense evidence|consumption evidence/i);
    expect(() => value.sqlite.prepare(`
      UPDATE inventory_reservations
      SET status = 'RELEASED', released_at = '2026-08-09T00:00:00.000Z', released_by = 'doctor-001', release_reason = 'ปล่อยรายการ',
        consumed_at = '2026-08-09T00:00:00.000Z', consumed_by = 'doctor-001', consumed_dispense_id = 'dispense-001'
      WHERE id = 'reservation-001'
    `).run()).toThrow(/consumed|release|consumption evidence/i);
    expect(() => value.sqlite.prepare(
      "INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by, consumed_at, consumed_by, consumed_dispense_id) VALUES ('invalid-consumed', 'clinic', 'visit-001', 'decision-001', 1, 'ACTIVE', '2026-08-09T00:00:00.000Z', 'doctor-001', '2026-08-09T00:00:00.000Z', 'doctor-001', 'dispense-001')",
    ).run()).toThrow(/consumed|ACTIVE|consumption evidence/i);
    expect(() => value.sqlite.prepare(
      "INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by) VALUES ('invalid-released', 'clinic', 'visit-001', 'decision-001', 1, 'RELEASED', '2026-08-09T00:00:00.000Z', 'doctor-001')",
    ).run()).toThrow(/ACTIVE|reservation/i);
    expect(() => value.sqlite.prepare(
      "UPDATE inventory_reservations SET visit_id = 'visit-other' WHERE id = 'reservation-001'",
    ).run()).toThrow(/reservation|identity|terminal/i);
    expect(() => value.sqlite.prepare(`
      UPDATE inventory_reservations
      SET status = 'CONSUMED', consumed_at = '2026-08-09T00:00:00.000Z', consumed_by = 'doctor-001', consumed_dispense_id = 'dispense-001'
      WHERE id = 'reservation-001'
    `).run()).not.toThrow();
    expect(value.sqlite.prepare("SELECT status, consumed_dispense_id FROM inventory_reservations WHERE id = 'reservation-001'").get())
      .toEqual({ status: "CONSUMED", consumed_dispense_id: "dispense-001" });
    expect(() => value.sqlite.prepare(
      "UPDATE inventory_reservations SET consumed_at = '2026-08-09T00:00:01.000Z' WHERE id = 'reservation-001'",
    ).run()).toThrow(/consumption evidence/i);
  });

  it("enforces preparation creation, revision, completion, identity, and deletion rules", () => {
    const value = database();
    seedChain(value);

    expect(() => value.sqlite.prepare(
      "INSERT INTO fulfillment_preparations (id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version, label_version_id, revision, status, minimum_print_sequence, created_at, created_by, completed_at, completed_by) VALUES ('invalid-preparation', 'clinic', 'visit-001', 'reservation-001', 'decision-001', 1, 'label-001', 2, 'ACTIVE', 1, '2026-08-09T00:00:00.000Z', 'doctor-001', NULL, NULL)",
    ).run()).toThrow(/preparation|revision|reservation/i);
    expect(() => value.sqlite.prepare(
      "UPDATE fulfillment_preparations SET status = 'COMPLETED', revision = 3, completed_at = '2026-08-09T00:00:00.000Z', completed_by = 'doctor-001' WHERE id = 'preparation-001'",
    ).run()).toThrow(/preparation|revision/i);
    expect(() => value.sqlite.prepare(
      "UPDATE fulfillment_preparations SET status = 'COMPLETED', revision = 2, completed_at = '2026-08-09T00:00:00.000Z', completed_by = 'doctor-001' WHERE id = 'preparation-001'",
    ).run()).not.toThrow();
    expect(() => value.sqlite.prepare(
      "UPDATE fulfillment_preparations SET status = 'ACTIVE', revision = 3, completed_at = NULL, completed_by = NULL WHERE id = 'preparation-001'",
    ).run()).toThrow(/preparation|revision/i);
    expect(() => value.sqlite.prepare(
      "UPDATE fulfillment_preparations SET reservation_id = 'reservation-other' WHERE id = 'preparation-001'",
    ).run()).toThrow(/preparation|identity/i);
    expect(() => value.sqlite.prepare(
      "DELETE FROM fulfillment_preparations WHERE id = 'preparation-001'",
    ).run()).toThrow(/preparation|append-only/i);
  });
});
