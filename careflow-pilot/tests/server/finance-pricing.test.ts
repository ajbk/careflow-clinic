import { afterEach, describe, expect, it } from "vitest";
import * as contracts from "../../src/shared/contracts.js";
import type { Actor } from "../../src/shared/contracts.js";
import { createFulfillmentService } from "../../src/server/modules/fulfillment/index.js";
import { createInventoryService } from "../../src/server/modules/inventory/index.js";
import { createMedicationService } from "../../src/server/modules/medication/index.js";
import { runAuditedTransaction, type AppTransaction } from "../../src/server/modules/platform/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

interface PricingModule {
  snapshotOrderPrices(tx: AppTransaction, medicationDecisionId: string): void;
  snapshotDispensePrices(tx: AppTransaction, dispenseId: string): void;
}

function database(): TestDatabase {
  const value = createTestDatabase();
  cleanups.push(value.cleanup);
  return value;
}

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

async function loadPricing(): Promise<PricingModule | null> {
  const modulePath = new URL("../../src/server/modules/finance/pricing.js", import.meta.url).href;
  try {
    return await import(/* @vite-ignore */ modulePath) as PricingModule;
  } catch {
    return null;
  }
}

function doctor(): Actor {
  return { id: "price-doctor", role: "doctor", displayName: "พญ. ราคาทดสอบ" };
}

function seedDoctorAndVisit(
  value: TestDatabase,
  input: { visitId: string; patientSuffix: string; status?: "AWAITING_PREPARATION" | "AWAITING_HANDOFF" },
): void {
  const actor = doctor();
  const patientNumber = input.patientSuffix.padStart(6, "0");
  const phoneSuffix = input.patientSuffix.padStart(4, "0");
  value.sqlite.exec(`
    INSERT INTO staff_accounts (
      id, clinic_id, username, display_name, role, password_hash, must_change_password,
      active, revision, last_password_changed_at, created_at, updated_at
    ) SELECT
      '${actor.id}', 'clinic', 'price-doctor', '${actor.displayName}', 'doctor', 'hash', 0,
      1, 1, '${NOW}', '${NOW}', '${NOW}'
    WHERE NOT EXISTS (SELECT 1 FROM staff_accounts WHERE id = '${actor.id}');
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'price-patient-${input.patientSuffix}', 'clinic', 'DEMO-${patientNumber}',
      'ผู้ป่วยทดสอบ ${patientNumber}', '000000${phoneSuffix}', '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      '${input.visitId}', 'clinic', 'price-patient-${input.patientSuffix}', '${input.status ?? "AWAITING_PREPARATION"}',
      'ทดสอบราคา', 1, '${NOW}', '${NOW}', '${actor.id}'
    );
  `);
}

function seedOrderDraft(
  value: TestDatabase,
  input: { id: string; visitId: string; medicationIds: string[] },
): void {
  value.sqlite.exec(`
    INSERT INTO medication_decision_drafts (
      id, visit_id, revision, kind, no_medication_reason, created_by, updated_by, created_at, updated_at
    ) VALUES ('${input.id}', '${input.visitId}', 1, 'ORDER', NULL, 'price-doctor', 'price-doctor', '${NOW}', '${NOW}');
    ${input.medicationIds.map((medicationId, position) => `
      INSERT INTO medication_order_draft_items (
        id, decision_draft_id, position, medication_id, medication_revision, quantity, directions_th
      ) VALUES ('${input.id}-item-${position}', '${input.id}', ${position}, '${medicationId}', 1, ${position + 1}, 'รับประทานตามสั่ง');
    `).join("\n")}
  `);
}

function signOrder(value: TestDatabase, visitId: string, ids: () => string) {
  const medications = createMedicationService({
    database: value,
    clock: () => new Date(NOW),
    idFactory: ids,
  });
  return runAuditedTransaction({
    db: value.db,
    actor: doctor(),
    work: (tx) => medications.signDecisionDraft(tx, doctor(), visitId, 1),
  });
}

function seedNoMedicationDraft(value: TestDatabase, id: string, visitId: string): void {
  value.sqlite.exec(`
    INSERT INTO medication_decision_drafts (
      id, visit_id, revision, kind, no_medication_reason, created_by, updated_by, created_at, updated_at
    ) VALUES ('${id}', '${visitId}', 1, 'NO_MEDICATION', 'ไม่มีข้อบ่งใช้ยา', 'price-doctor', 'price-doctor', '${NOW}', '${NOW}');
  `);
}

function seedReadyHandoff(value: TestDatabase, input: { decisionId: string; orderItemId: string }): void {
  value.sqlite.exec(`
    INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
    VALUES ('price-receipt', 'clinic', 'ผู้จำหน่ายราคาทดสอบ', '', '${NOW}', 'price-doctor');
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot,
      dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by
    ) VALUES
      ('price-lot-a', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'PRICE-A', '2027-08-31', 'ผู้จำหน่ายราคาทดสอบ', 'AVAILABLE', '${NOW}', 'price-doctor'),
      ('price-lot-b', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'PRICE-B', '2027-08-31', 'ผู้จำหน่ายราคาทดสอบ', 'AVAILABLE', '${NOW}', 'price-doctor');
    INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
    VALUES
      ('price-receipt-line-a', 'price-receipt', 'price-lot-a', 2, 'เม็ด'),
      ('price-receipt-line-b', 'price-receipt', 'price-lot-b', 3, 'เม็ด');
    INSERT INTO inventory_stock_movements (
      id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id
    ) VALUES
      ('price-movement-a', 'clinic', 'price-lot-a', 'RECEIPT', 2, 'RECEIPT', 'price-receipt', '', '${NOW}', 'price-doctor'),
      ('price-movement-b', 'clinic', 'price-lot-b', 'RECEIPT', 3, 'RECEIPT', 'price-receipt', '', '${NOW}', 'price-doctor');
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by
    ) VALUES ('price-reservation', 'clinic', 'price-handoff-visit', '${input.decisionId}', 1, 'ACTIVE', '${NOW}', 'price-doctor');
    INSERT INTO inventory_reservation_allocations (
      id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id,
      lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
    ) VALUES
      ('price-allocation-a', 'price-reservation', '${input.orderItemId}', 'price-lot-a', 0, 2, 'DEMO-MED-001', 'PRICE-A', '2027-08-31', 'เม็ด', '${NOW}'),
      ('price-allocation-b', 'price-reservation', '${input.orderItemId}', 'price-lot-b', 1, 3, 'DEMO-MED-001', 'PRICE-B', '2027-08-31', 'เม็ด', '${NOW}');
    INSERT INTO fulfillment_label_versions (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version, created_at, created_by,
      patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot
    ) VALUES ('price-label', 'clinic', 'price-handoff-visit', '${input.decisionId}', 1, 1, '${NOW}', 'price-doctor', 'DEMO-000003', 'ผู้ป่วยราคาทดสอบ 3', 'คลินิกชนบท CareFlow Pilot');
    INSERT INTO fulfillment_label_items (
      id, label_version_id, medication_order_item_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot, directions_th_snapshot,
      internal_barcode_snapshot
    ) VALUES ('price-label-item', 'price-label', '${input.orderItemId}', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 5, 'เม็ด', 'รับประทานตามสั่ง', 'CF-DEMO-001');
    INSERT INTO fulfillment_label_print_events (
      id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot
    ) VALUES ('price-print', 'price-label', 1, '${NOW}', 'price-doctor', 'test', '80x100mm');
    INSERT INTO fulfillment_preparations (
      id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version, label_version_id,
      revision, status, minimum_print_sequence, created_at, created_by
    ) VALUES ('price-preparation', 'clinic', 'price-handoff-visit', 'price-reservation', '${input.decisionId}', 1, 'price-label', 1, 'ACTIVE', 1, '${NOW}', 'price-doctor');
    UPDATE fulfillment_preparations
    SET status = 'COMPLETED', revision = 2, completed_at = '${NOW}', completed_by = 'price-doctor'
    WHERE id = 'price-preparation';
    INSERT INTO fulfillment_preparation_confirmations (
      id, preparation_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity,
      method, barcode_snapshot, manual_reason, confirmed_at, confirmed_by
    ) VALUES
      ('price-confirmation-a', 'price-preparation', 'price-allocation-a', '${input.orderItemId}', 'DEMO-MED-001', 'price-lot-a', 2, 'BARCODE', 'CF-DEMO-001', NULL, '${NOW}', 'price-doctor'),
      ('price-confirmation-b', 'price-preparation', 'price-allocation-b', '${input.orderItemId}', 'DEMO-MED-001', 'price-lot-b', 3, 'BARCODE', 'CF-DEMO-001', NULL, '${NOW}', 'price-doctor');
    INSERT INTO fulfillment_releases (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id,
      label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by
    ) VALUES ('price-release', 'clinic', 'price-handoff-visit', '${input.decisionId}', 1, 'price-label', 'price-print', 'price-preparation', 2, 'price-reservation', '${NOW}', 'price-doctor');
  `);
}

describe("integer-Baht price masters and immutable snapshots", () => {
  it("seeds the required Thai price masters with integer values", () => {
    const value = database();

    expect(value.sqlite.prepare("SELECT consultation_fee_baht, pricing_revision FROM clinic_config WHERE id = 'clinic'").get())
      .toEqual({ consultation_fee_baht: 100, pricing_revision: 1 });
    expect(value.sqlite.prepare("SELECT id, unit_price_baht FROM medications ORDER BY id").all()).toEqual([
      { id: "DEMO-MED-001", unit_price_baht: 5 },
      { id: "DEMO-MED-002", unit_price_baht: 10 },
      { id: "DEMO-MED-003", unit_price_baht: 50 },
      { id: "DEMO-MED-004", unit_price_baht: 15 },
    ]);
  });

  it("rejects missing, decimal, unsafe, and out-of-range Baht DTO values", () => {
    const values = contracts as Record<string, unknown>;
    const consultationFeeBahtSchema = values.consultationFeeBahtSchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;
    const unitPriceBahtSchema = values.unitPriceBahtSchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;
    const priceSnapshotSchema = values.priceSnapshotSchema as {
      safeParse: (value: unknown) => { success: boolean };
    } | undefined;

    expect(consultationFeeBahtSchema).toBeDefined();
    expect(unitPriceBahtSchema).toBeDefined();
    expect(priceSnapshotSchema).toBeDefined();
    if (!consultationFeeBahtSchema || !unitPriceBahtSchema || !priceSnapshotSchema) return;

    expect(consultationFeeBahtSchema.safeParse(100).success).toBe(true);
    expect(consultationFeeBahtSchema.safeParse(undefined).success).toBe(false);
    expect(consultationFeeBahtSchema.safeParse(100.5).success).toBe(false);
    expect(consultationFeeBahtSchema.safeParse(1_000_001).success).toBe(false);
    expect(unitPriceBahtSchema.safeParse(0).success).toBe(true);
    expect(unitPriceBahtSchema.safeParse(-1).success).toBe(false);
    expect(unitPriceBahtSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(priceSnapshotSchema.safeParse({
      unitPriceBaht: 5,
      currency: "THB",
      sourceMedicationId: "DEMO-MED-001",
      sourceMedicationRevision: Number.MAX_SAFE_INTEGER + 1,
    }).success).toBe(false);
  });

  it("enforces integer price-master boundaries at the SQLite boundary", () => {
    const value = database();

    expect(() => value.sqlite.prepare("UPDATE clinic_config SET consultation_fee_baht = 0, pricing_revision = 2").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE clinic_config SET consultation_fee_baht = 100.5, pricing_revision = 2").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE clinic_config SET consultation_fee_baht = 1000001, pricing_revision = 2").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE clinic_config SET pricing_revision = 0").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE medications SET unit_price_baht = -1, revision = 2 WHERE id = 'DEMO-MED-001'").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE medications SET unit_price_baht = 5.5, revision = 2 WHERE id = 'DEMO-MED-001'").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE medications SET unit_price_baht = 1000001, revision = 2 WHERE id = 'DEMO-MED-001'").run()).toThrow(/check|constraint/i);
    expect(() => value.sqlite.prepare("UPDATE medications SET unit_price_baht = 6 WHERE id = 'DEMO-MED-001'").run()).toThrow(/revision increment/i);
  });

  it("rejects a direct order price snapshot whose immutable source does not match", () => {
    const value = database();
    seedDoctorAndVisit(value, { visitId: "price-source-guard-visit", patientSuffix: "44" });
    value.sqlite.exec(`
      INSERT INTO medication_decisions (
        id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
        signed_by, signed_by_display_name, signed_at, content_hash
      ) VALUES (
        'price-source-guard-decision', 'price-source-guard-visit', 1, 'ORDER', NULL, NULL, NULL,
        'price-doctor', 'พญ. ราคาทดสอบ', '${NOW}', '${"b".repeat(64)}'
      );
      INSERT INTO medication_order_items (
        id, medication_decision_id, position, medication_id, medication_revision,
        display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th
      ) VALUES (
        'price-source-guard-item', 'price-source-guard-decision', 0, 'DEMO-MED-001', 1,
        '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'ทดสอบ source guard'
      );
    `);

    expect(() => value.sqlite.prepare(`
      INSERT INTO medication_order_price_snapshots (
        id, medication_order_item_id, medication_id, medication_revision,
        unit_price_baht_snapshot, currency, captured_at
      ) VALUES ('price-source-guard-invalid', 'price-source-guard-item', 'DEMO-MED-001', 1, 6, 'THB', ?)
    `).run(NOW)).toThrow(/source is invalid/i);
    expect(value.sqlite.prepare("SELECT count(*) FROM medication_order_price_snapshots WHERE medication_order_item_id = 'price-source-guard-item'").pluck().get())
      .toBe(0);
  });

  it("creates exactly one order snapshot per signed ORDER item and none for NO_MEDICATION", async () => {
    const pricing = await loadPricing();
    expect(pricing).not.toBeNull();
    if (!pricing) return;

    const value = database();
    const ids = sequence("price-sign");
    seedDoctorAndVisit(value, { visitId: "price-order-visit", patientSuffix: "1" });
    seedOrderDraft(value, { id: "price-order-draft", visitId: "price-order-visit", medicationIds: ["DEMO-MED-001", "DEMO-MED-002"] });
    const signed = signOrder(value, "price-order-visit", ids);

    expect(value.sqlite.prepare(`
      SELECT item.medication_id, snapshot.medication_revision, snapshot.unit_price_baht_snapshot, snapshot.currency
      FROM medication_order_price_snapshots AS snapshot
      INNER JOIN medication_order_items AS item ON item.id = snapshot.medication_order_item_id
      WHERE item.medication_decision_id = ?
      ORDER BY item.position
    `).all(signed.id)).toEqual([
      { medication_id: "DEMO-MED-001", medication_revision: 1, unit_price_baht_snapshot: 5, currency: "THB" },
      { medication_id: "DEMO-MED-002", medication_revision: 1, unit_price_baht_snapshot: 10, currency: "THB" },
    ]);
    expect(value.sqlite.prepare(`
      SELECT count(*) FROM medication_order_price_snapshots
      WHERE medication_order_item_id IN (SELECT id FROM medication_order_items WHERE medication_decision_id = ?)
    `).pluck().get(signed.id)).toBe(2);

    seedDoctorAndVisit(value, { visitId: "price-no-medication-visit", patientSuffix: "2" });
    seedNoMedicationDraft(value, "price-no-medication-draft", "price-no-medication-visit");
    signOrder(value, "price-no-medication-visit", ids);
    expect(value.sqlite.prepare("SELECT count(*) FROM medication_order_price_snapshots").pluck().get()).toBe(2);
  });

  it("keeps signed order prices immutable after price-master edits and snapshots ORDER revisions", async () => {
    const pricing = await loadPricing();
    expect(pricing).not.toBeNull();
    if (!pricing) return;

    const value = database();
    const ids = sequence("price-revision");
    seedDoctorAndVisit(value, { visitId: "price-revision-visit", patientSuffix: "4" });
    seedOrderDraft(value, { id: "price-revision-draft", visitId: "price-revision-visit", medicationIds: ["DEMO-MED-001"] });
    const medicationService = createMedicationService({ database: value, clock: () => new Date(NOW), idFactory: ids });
    const initial = runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => medicationService.signDecisionDraft(tx, doctor(), "price-revision-visit", 1),
    });
    const initialSnapshot = value.sqlite.prepare(`
      SELECT id, unit_price_baht_snapshot, currency FROM medication_order_price_snapshots
      WHERE medication_order_item_id IN (SELECT id FROM medication_order_items WHERE medication_decision_id = ?)
    `).get(initial.id);
    expect(initialSnapshot).toMatchObject({ unit_price_baht_snapshot: 5, currency: "THB" });

    value.sqlite.prepare("UPDATE medications SET unit_price_baht = 19, revision = 2 WHERE id = 'DEMO-MED-001'").run();
    expect(value.sqlite.prepare(`
      SELECT unit_price_baht_snapshot FROM medication_order_price_snapshots WHERE id = ?
    `).get((initialSnapshot as { id: string }).id)).toEqual({ unit_price_baht_snapshot: 5 });

    const revision = runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => medicationService.signDecisionRevision(tx, doctor(), "price-revision-visit", 1, {
        kind: "ORDER",
        items: [{ medicationId: "DEMO-MED-001", medicationRevision: 2, quantity: 1, directionsTh: "รับประทานตามสั่ง" }],
      }, "ปรับราคาและสั่งยาใหม่"),
    });
    expect(value.sqlite.prepare(`
      SELECT decision.version, snapshot.medication_revision, snapshot.unit_price_baht_snapshot
      FROM medication_order_price_snapshots AS snapshot
      INNER JOIN medication_order_items AS item ON item.id = snapshot.medication_order_item_id
      INNER JOIN medication_decisions AS decision ON decision.id = item.medication_decision_id
      WHERE decision.visit_id = 'price-revision-visit'
      ORDER BY decision.version
    `).all()).toEqual([
      { version: 1, medication_revision: 1, unit_price_baht_snapshot: 5 },
      { version: revision.version, medication_revision: 2, unit_price_baht_snapshot: 19 },
    ]);
    expect(() => value.sqlite.prepare("UPDATE medication_order_price_snapshots SET unit_price_baht_snapshot = 99").run())
      .toThrow(/append-only/i);
    expect(() => value.sqlite.prepare("DELETE FROM medication_order_price_snapshots").run()).toThrow(/append-only/i);
  });

  it("copies the exact signed order price to one immutable snapshot for each multi-lot dispense line", async () => {
    const pricing = await loadPricing();
    expect(pricing).not.toBeNull();
    if (!pricing) return;

    const value = database();
    const ids = sequence("price-handoff");
    seedDoctorAndVisit(value, { visitId: "price-handoff-visit", patientSuffix: "3", status: "AWAITING_HANDOFF" });
    seedOrderDraft(value, { id: "price-handoff-draft", visitId: "price-handoff-visit", medicationIds: ["DEMO-MED-001"] });
    const signed = signOrder(value, "price-handoff-visit", ids);
    const orderItem = value.sqlite.prepare("SELECT id FROM medication_order_items WHERE medication_decision_id = ?").get(signed.id) as { id: string };
    seedReadyHandoff(value, { decisionId: signed.id, orderItemId: orderItem.id });

    const inventory = createInventoryService({ database: value, clock: () => new Date(NOW), idFactory: ids });
    const fulfillment = createFulfillmentService({ database: value, inventory, clock: () => new Date(NOW), idFactory: ids });
    runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => fulfillment.handoffForVisit(tx, doctor(), "price-handoff-visit", 1, {
        decisionId: signed.id,
        decisionVersion: 1,
        labelVersionId: "price-label",
        releaseId: "price-release",
        reservationId: "price-reservation",
      }),
    });

    expect(value.sqlite.prepare(`
      SELECT line.lot_id, snapshot.order_price_snapshot_id, snapshot.medication_id, snapshot.unit_price_baht_snapshot, snapshot.currency
      FROM fulfillment_dispense_price_snapshots AS snapshot
      INNER JOIN fulfillment_dispense_lines AS line ON line.id = snapshot.fulfillment_dispense_line_id
      ORDER BY line.lot_id
    `).all()).toEqual([
      { lot_id: "price-lot-a", order_price_snapshot_id: expect.any(String), medication_id: "DEMO-MED-001", unit_price_baht_snapshot: 5, currency: "THB" },
      { lot_id: "price-lot-b", order_price_snapshot_id: expect.any(String), medication_id: "DEMO-MED-001", unit_price_baht_snapshot: 5, currency: "THB" },
    ]);
    expect(value.sqlite.prepare("SELECT status FROM visits WHERE id = 'price-handoff-visit'").get()).toEqual({ status: "AWAITING_CHARGE" });
    expect(() => value.sqlite.prepare("UPDATE fulfillment_dispense_price_snapshots SET unit_price_baht_snapshot = 99").run())
      .toThrow(/append-only/i);
    expect(() => value.sqlite.prepare("DELETE FROM fulfillment_dispense_price_snapshots").run()).toThrow(/append-only/i);
  });

  it("rolls back signed ORDER and multi-lot handoff evidence when snapshot persistence aborts", () => {
    const value = database();
    const ids = sequence("price-snapshot-abort");
    seedDoctorAndVisit(value, { visitId: "price-snapshot-abort-order", patientSuffix: "45" });
    seedOrderDraft(value, {
      id: "price-snapshot-abort-order-draft",
      visitId: "price-snapshot-abort-order",
      medicationIds: ["DEMO-MED-001"],
    });

    const abortingMedication = createMedicationService({
      database: value,
      clock: () => new Date(NOW),
      idFactory: ids,
      afterPriceSnapshotWrite: (stage) => {
        if (stage === "ORDER") throw new Error("abort after order price snapshot");
      },
    });
    expect(() => runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => abortingMedication.signDecisionDraft(tx, doctor(), "price-snapshot-abort-order", 1),
    })).toThrow("abort after order price snapshot");
    expect(value.sqlite.prepare("SELECT count(*) FROM medication_decisions WHERE visit_id = 'price-snapshot-abort-order'").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT count(*) FROM medication_order_items WHERE medication_decision_id LIKE 'price-snapshot-abort%'").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT count(*) FROM medication_order_price_snapshots").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT status FROM visits WHERE id = 'price-snapshot-abort-order'").get()).toEqual({ status: "AWAITING_PREPARATION" });

    seedDoctorAndVisit(value, { visitId: "price-handoff-visit", patientSuffix: "46", status: "AWAITING_HANDOFF" });
    seedOrderDraft(value, {
      id: "price-snapshot-abort-handoff-draft",
      visitId: "price-handoff-visit",
      medicationIds: ["DEMO-MED-001"],
    });
    const signingMedication = createMedicationService({ database: value, clock: () => new Date(NOW), idFactory: ids });
    const signed = runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => signingMedication.signDecisionDraft(tx, doctor(), "price-handoff-visit", 1),
    });
    const orderItem = value.sqlite.prepare("SELECT id FROM medication_order_items WHERE medication_decision_id = ?").get(signed.id) as { id: string };
    seedReadyHandoff(value, { decisionId: signed.id, orderItemId: orderItem.id });
    const inventory = createInventoryService({ database: value, clock: () => new Date(NOW), idFactory: ids });
    const abortingFulfillment = createFulfillmentService({
      database: value,
      inventory,
      clock: () => new Date(NOW),
      idFactory: ids,
      afterPriceSnapshotWrite: (stage) => {
        if (stage === "DISPENSE") throw new Error("abort after dispense price snapshot");
      },
    });
    expect(() => runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => abortingFulfillment.handoffForVisit(tx, doctor(), "price-handoff-visit", 1, {
        decisionId: signed.id,
        decisionVersion: 1,
        labelVersionId: "price-label",
        releaseId: "price-release",
        reservationId: "price-reservation",
      }),
    })).toThrow("abort after dispense price snapshot");
    expect(value.sqlite.prepare("SELECT count(*) FROM fulfillment_dispenses WHERE visit_id = 'price-handoff-visit'").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT count(*) FROM fulfillment_dispense_lines").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT count(*) FROM fulfillment_dispense_price_snapshots").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT count(*) FROM inventory_stock_movements WHERE movement_type = 'DISPENSE'").pluck().get()).toBe(0);
    expect(value.sqlite.prepare("SELECT status FROM visits WHERE id = 'price-handoff-visit'").get()).toEqual({ status: "AWAITING_HANDOFF" });
  });
});
