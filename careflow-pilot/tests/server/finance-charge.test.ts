import { afterEach, describe, expect, it } from "vitest";
import type { Actor } from "../../src/shared/contracts.js";
import { runAuditedTransaction, type AppTransaction } from "../../src/server/modules/platform/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "a".repeat(64);
const cleanups: Array<() => void> = [];

interface FinalizeChargeCommand {
  expectedRevisions: { visit: number; clinicPricing: number };
  payload: { settlementIntent: "COLLECT" };
}

interface CheckoutLine {
  id: string | null;
  position: number;
  lineType: "CONSULTATION" | "MEDICATION";
  descriptionSnapshot: string;
  quantity: number;
  unitPriceBaht: number;
  lineTotalBaht: number;
  medicationOrderItemId: string | null;
  fulfillmentDispenseLineId: string | null;
}

interface CheckoutDto {
  visit: { id: string; status: string; revision: number };
  charge: { id: string; contentHash: string } | null;
  lines: CheckoutLine[];
  grossTotalBaht: number;
  adjustmentTotalBaht: number;
  netDueBaht: number;
  collectionState: string;
  allowedActions: string[];
}

interface FinanceService {
  getCheckout(actor: Actor, visitId: string): CheckoutDto;
  finalizeCharge(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    command: FinalizeChargeCommand,
  ): CheckoutDto;
  readResolution(tx: AppTransaction, visitId: string): unknown;
}

interface FinanceModule {
  createFinanceService(input: {
    database: TestDatabase;
    pricing: { deriveChargeQuote: (tx: AppTransaction, visitId: string, expectedClinicPricingRevision: number) => unknown };
    clock: () => Date;
    idFactory: () => string;
  }): FinanceService;
}

interface PricingModule {
  deriveChargeQuote(
    tx: AppTransaction,
    visitId: string,
    expectedClinicPricingRevision: number,
  ): unknown;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function database(): TestDatabase {
  const value = createTestDatabase();
  cleanups.push(value.cleanup);
  return value;
}

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function doctor(): Actor {
  return { id: "finance-doctor", role: "doctor", displayName: "พญ. การเงินทดสอบ" };
}

async function loadFinance(): Promise<FinanceModule | null> {
  try {
    const modulePath = new URL("../../src/server/modules/finance/service.js", import.meta.url).href;
    return await import(/* @vite-ignore */ modulePath) as FinanceModule;
  } catch {
    return null;
  }
}

async function loadPricing(): Promise<PricingModule | null> {
  try {
    const modulePath = new URL("../../src/server/modules/finance/pricing.js", import.meta.url).href;
    return await import(/* @vite-ignore */ modulePath) as PricingModule;
  } catch {
    return null;
  }
}

function seedStaffPatientVisit(
  value: TestDatabase,
  input: { visitId: string; patientSuffix: string; revision?: number },
): void {
  const actor = doctor();
  const patientNumber = input.patientSuffix.padStart(6, "0");
  const phoneSuffix = input.patientSuffix.padStart(4, "0");
  value.sqlite.exec(`
    INSERT OR IGNORE INTO staff_accounts (
      id, clinic_id, username, display_name, role, password_hash, must_change_password,
      active, revision, last_password_changed_at, created_at, updated_at
    ) VALUES (
      '${actor.id}', 'clinic', 'finance-doctor', '${actor.displayName}', 'doctor', 'hash', 0,
      1, 1, '${NOW}', '${NOW}', '${NOW}'
    );
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'finance-patient-${input.patientSuffix}', 'clinic', 'DEMO-${patientNumber}',
      'ผู้ป่วยทดสอบ ${patientNumber}', '000000${phoneSuffix}', '1990-01-01', 'unknown', 1, '${NOW}', '${NOW}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      '${input.visitId}', 'clinic', 'finance-patient-${input.patientSuffix}', 'AWAITING_CHARGE',
      'ทดสอบการคิดเงิน', ${input.revision ?? 7}, '${NOW}', '${NOW}', '${actor.id}'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-note-${input.patientSuffix}', '${input.visitId}', 1, 'subjective', 'objective',
      'assessment', 'plan', 1, '${actor.id}', '${actor.displayName}', '${NOW}', '${HASH}'
    );
  `);
}

function seedOrderSource(
  value: TestDatabase,
  input: { visitId: string; patientSuffix: string; includeDispensePrices?: boolean },
): void {
  const actor = doctor();
  const suffix = input.patientSuffix;
  seedStaffPatientVisit(value, { visitId: input.visitId, patientSuffix: suffix });
  value.sqlite.exec(`
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-decision-${suffix}', '${input.visitId}', 1, 'ORDER', NULL, NULL, NULL,
      '${actor.id}', '${actor.displayName}', '${NOW}', '${HASH}'
    );
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision, display_name_snapshot,
      strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th
    ) VALUES (
      'finance-order-item-${suffix}', 'finance-decision-${suffix}', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 5, 'รับประทานตามสั่ง'
    );
    INSERT INTO medication_order_price_snapshots (
      id, medication_order_item_id, medication_id, medication_revision, unit_price_baht_snapshot, currency, captured_at
    ) VALUES (
      'finance-order-price-${suffix}', 'finance-order-item-${suffix}', 'DEMO-MED-001', 1, 5, 'THB', '${NOW}'
    );
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot,
      dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by
    ) VALUES
      ('finance-lot-a-${suffix}', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'FINANCE-A-${suffix}', '2027-08-31', 'ผู้จำหน่ายทดสอบ', 'AVAILABLE', '${NOW}', '${actor.id}'),
      ('finance-lot-b-${suffix}', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'FINANCE-B-${suffix}', '2027-08-31', 'ผู้จำหน่ายทดสอบ', 'AVAILABLE', '${NOW}', '${actor.id}');
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by
    ) VALUES (
      'finance-reservation-${suffix}', 'clinic', '${input.visitId}', 'finance-decision-${suffix}', 1, 'ACTIVE', '${NOW}', '${actor.id}'
    );
    INSERT INTO inventory_reservation_allocations (
      id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id,
      lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
    ) VALUES
      ('finance-allocation-a-${suffix}', 'finance-reservation-${suffix}', 'finance-order-item-${suffix}', 'finance-lot-a-${suffix}', 0, 2, 'DEMO-MED-001', 'FINANCE-A-${suffix}', '2027-08-31', 'เม็ด', '${NOW}'),
      ('finance-allocation-b-${suffix}', 'finance-reservation-${suffix}', 'finance-order-item-${suffix}', 'finance-lot-b-${suffix}', 1, 3, 'DEMO-MED-001', 'FINANCE-B-${suffix}', '2027-08-31', 'เม็ด', '${NOW}');
    INSERT INTO fulfillment_label_versions (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version, created_at, created_by,
      patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot
    ) VALUES (
      'finance-label-${suffix}', 'clinic', '${input.visitId}', 'finance-decision-${suffix}', 1, 1, '${NOW}', '${actor.id}',
      'DEMO-${suffix.padStart(6, "0")}', 'ผู้ป่วยทดสอบ ${suffix.padStart(6, "0")}', 'คลินิกชนบท CareFlow Pilot'
    );
    INSERT INTO fulfillment_label_items (
      id, label_version_id, medication_order_item_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot, directions_th_snapshot,
      internal_barcode_snapshot
    ) VALUES (
      'finance-label-item-${suffix}', 'finance-label-${suffix}', 'finance-order-item-${suffix}', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 5, 'เม็ด', 'รับประทานตามสั่ง', 'CF-DEMO-001'
    );
    INSERT INTO fulfillment_label_print_events (
      id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot
    ) VALUES ('finance-print-${suffix}', 'finance-label-${suffix}', 1, '${NOW}', '${actor.id}', 'test', '80x100mm');
    INSERT INTO fulfillment_preparations (
      id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version, label_version_id,
      revision, status, minimum_print_sequence, created_at, created_by
    ) VALUES (
      'finance-preparation-${suffix}', 'clinic', '${input.visitId}', 'finance-reservation-${suffix}', 'finance-decision-${suffix}', 1,
      'finance-label-${suffix}', 1, 'ACTIVE', 1, '${NOW}', '${actor.id}'
    );
    UPDATE fulfillment_preparations
    SET status = 'COMPLETED', revision = 2, completed_at = '${NOW}', completed_by = '${actor.id}'
    WHERE id = 'finance-preparation-${suffix}';
    INSERT INTO fulfillment_releases (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id,
      label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by
    ) VALUES (
      'finance-release-${suffix}', 'clinic', '${input.visitId}', 'finance-decision-${suffix}', 1, 'finance-label-${suffix}',
      'finance-print-${suffix}', 'finance-preparation-${suffix}', 2, 'finance-reservation-${suffix}', '${NOW}', '${actor.id}'
    );
    INSERT INTO fulfillment_dispenses (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id,
      preparation_id, release_id, reservation_id, handed_off_at, handed_off_by
    ) VALUES (
      'finance-dispense-${suffix}', 'clinic', '${input.visitId}', 'finance-decision-${suffix}', 1, 'finance-label-${suffix}',
      'finance-preparation-${suffix}', 'finance-release-${suffix}', 'finance-reservation-${suffix}', '${NOW}', '${actor.id}'
    );
    INSERT INTO fulfillment_dispense_lines (
      id, dispense_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number_snapshot,
      expiry_date_snapshot, directions_th_snapshot
    ) VALUES
      ('finance-dispense-line-a-${suffix}', 'finance-dispense-${suffix}', 'finance-allocation-a-${suffix}', 'finance-order-item-${suffix}', 'DEMO-MED-001', 'finance-lot-a-${suffix}', 2, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'FINANCE-A-${suffix}', '2027-08-31', 'รับประทานตามสั่ง'),
      ('finance-dispense-line-b-${suffix}', 'finance-dispense-${suffix}', 'finance-allocation-b-${suffix}', 'finance-order-item-${suffix}', 'DEMO-MED-001', 'finance-lot-b-${suffix}', 3, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'FINANCE-B-${suffix}', '2027-08-31', 'รับประทานตามสั่ง');
  `);

  if (input.includeDispensePrices !== false) {
    value.sqlite.exec(`
      INSERT INTO fulfillment_dispense_price_snapshots (
        id, fulfillment_dispense_line_id, order_price_snapshot_id, medication_id, unit_price_baht_snapshot, currency, captured_at
      ) VALUES
        ('finance-dispense-price-a-${suffix}', 'finance-dispense-line-a-${suffix}', 'finance-order-price-${suffix}', 'DEMO-MED-001', 5, 'THB', '${NOW}'),
        ('finance-dispense-price-b-${suffix}', 'finance-dispense-line-b-${suffix}', 'finance-order-price-${suffix}', 'DEMO-MED-001', 5, 'THB', '${NOW}');
    `);
  }
}

function seedNoMedicationSource(value: TestDatabase, input: { visitId: string; patientSuffix: string }): void {
  const actor = doctor();
  seedStaffPatientVisit(value, input);
  value.sqlite.exec(`
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'finance-decision-${input.patientSuffix}', '${input.visitId}', 1, 'NO_MEDICATION', 'ไม่มีข้อบ่งใช้ยา', NULL, NULL,
      '${actor.id}', '${actor.displayName}', '${NOW}', '${HASH}'
    );
  `);
}

function command(visitRevision = 7): FinalizeChargeCommand {
  return {
    expectedRevisions: { visit: visitRevision, clinicPricing: 1 },
    payload: { settlementIntent: "COLLECT" },
  };
}

function countRows(value: TestDatabase, table: string): number {
  const row = value.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

describe("immutable finance charge finalization", () => {
  it("derives one immutable charge line per actual ORDER dispense line and a consultation line", async () => {
    const financeModule = await loadFinance();
    const pricing = await loadPricing();
    expect(financeModule).not.toBeNull();
    expect(pricing?.deriveChargeQuote).toBeTypeOf("function");
    if (!financeModule || !pricing) return;

    const value = database();
    seedOrderSource(value, { visitId: "finance-order-visit", patientSuffix: "1" });
    const service = financeModule.createFinanceService({
      database: value,
      pricing,
      clock: () => new Date(NOW),
      idFactory: sequence("finance-charge"),
    });

    const preview = service.getCheckout(doctor(), "finance-order-visit");
    expect(preview.charge).toBeNull();
    expect(preview.lines.map((line) => ({
      lineType: line.lineType,
      quantity: line.quantity,
      unitPriceBaht: line.unitPriceBaht,
      lineTotalBaht: line.lineTotalBaht,
      fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
    }))).toEqual([
      { lineType: "CONSULTATION", quantity: 1, unitPriceBaht: 100, lineTotalBaht: 100, fulfillmentDispenseLineId: null },
      { lineType: "MEDICATION", quantity: 2, unitPriceBaht: 5, lineTotalBaht: 10, fulfillmentDispenseLineId: "finance-dispense-line-a-1" },
      { lineType: "MEDICATION", quantity: 3, unitPriceBaht: 5, lineTotalBaht: 15, fulfillmentDispenseLineId: "finance-dispense-line-b-1" },
    ]);
    expect(preview.grossTotalBaht).toBe(125);

    const finalized = runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => service.finalizeCharge(tx, doctor(), "finance-order-visit", command()),
    });
    expect(finalized).toMatchObject({
      visit: { id: "finance-order-visit", status: "AWAITING_PAYMENT", revision: 8 },
      grossTotalBaht: 125,
      adjustmentTotalBaht: 0,
      netDueBaht: 125,
      collectionState: "AWAITING_COLLECTION",
    });
    expect(value.sqlite.prepare(`
      SELECT source_kind, medication_decision_id, medication_decision_version, fulfillment_dispense_id,
        clinic_pricing_revision, consultation_fee_baht_snapshot, currency, line_count
      FROM finance_charges
    `).get()).toEqual({
      source_kind: "ORDER",
      medication_decision_id: "finance-decision-1",
      medication_decision_version: 1,
      fulfillment_dispense_id: "finance-dispense-1",
      clinic_pricing_revision: 1,
      consultation_fee_baht_snapshot: 100,
      currency: "THB",
      line_count: 3,
    });
    expect(value.sqlite.prepare(`
      SELECT position, line_type, quantity, unit_price_baht, line_total_baht, fulfillment_dispense_line_id
      FROM finance_charge_lines ORDER BY position
    `).all()).toEqual([
      { position: 0, line_type: "CONSULTATION", quantity: 1, unit_price_baht: 100, line_total_baht: 100, fulfillment_dispense_line_id: null },
      { position: 1, line_type: "MEDICATION", quantity: 2, unit_price_baht: 5, line_total_baht: 10, fulfillment_dispense_line_id: "finance-dispense-line-a-1" },
      { position: 2, line_type: "MEDICATION", quantity: 3, unit_price_baht: 5, line_total_baht: 15, fulfillment_dispense_line_id: "finance-dispense-line-b-1" },
    ]);
  });

  it("finalizes NO_MEDICATION from signed evidence with consultation only", async () => {
    const financeModule = await loadFinance();
    const pricing = await loadPricing();
    expect(financeModule).not.toBeNull();
    if (!financeModule || !pricing) return;

    const value = database();
    seedNoMedicationSource(value, { visitId: "finance-no-medication-visit", patientSuffix: "2" });
    const service = financeModule.createFinanceService({
      database: value,
      pricing,
      clock: () => new Date(NOW),
      idFactory: sequence("finance-no-medication-charge"),
    });

    const finalized = runAuditedTransaction({
      db: value.db,
      actor: doctor(),
      work: (tx) => service.finalizeCharge(tx, doctor(), "finance-no-medication-visit", command()),
    });
    expect(finalized.lines).toEqual([
      expect.objectContaining({
        lineType: "CONSULTATION",
        quantity: 1,
        unitPriceBaht: 100,
        lineTotalBaht: 100,
        medicationOrderItemId: null,
        fulfillmentDispenseLineId: null,
      }),
    ]);
    expect(finalized.grossTotalBaht).toBe(100);
    expect(value.sqlite.prepare("SELECT source_kind, fulfillment_dispense_id, line_count FROM finance_charges").get())
      .toEqual({ source_kind: "NO_MEDICATION", fulfillment_dispense_id: null, line_count: 1 });
  });

  it("rejects incomplete price evidence before it creates a partial charge", async () => {
    const financeModule = await loadFinance();
    const pricing = await loadPricing();
    expect(financeModule).not.toBeNull();
    if (!financeModule || !pricing) return;

    const value = database();
    seedOrderSource(value, {
      visitId: "finance-missing-price-visit",
      patientSuffix: "3",
      includeDispensePrices: false,
    });
    const service = financeModule.createFinanceService({
      database: value,
      pricing,
      clock: () => new Date(NOW),
      idFactory: sequence("finance-missing-price-charge"),
    });

    try {
      runAuditedTransaction({
        db: value.db,
        actor: doctor(),
        work: (tx) => service.finalizeCharge(tx, doctor(), "finance-missing-price-visit", command()),
      });
      throw new Error("expected finance finalization to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "PRICE_SNAPSHOT_MISSING" });
    }
    expect(countRows(value, "finance_charges")).toBe(0);
    expect(countRows(value, "finance_charge_lines")).toBe(0);
  });

  it("keeps charge evidence append-only, source-bound, and deterministically hashed without a stored gross total", async () => {
    const financeModule = await loadFinance();
    const pricing = await loadPricing();
    expect(financeModule).not.toBeNull();
    if (!financeModule || !pricing) return;

    const first = database();
    const second = database();
    seedOrderSource(first, { visitId: "finance-hash-visit", patientSuffix: "4" });
    seedOrderSource(second, { visitId: "finance-hash-visit", patientSuffix: "4" });
    const buildService = (value: TestDatabase) => financeModule.createFinanceService({
      database: value,
      pricing,
      clock: () => new Date(NOW),
      idFactory: sequence("finance-fixed"),
    });
    const firstService = buildService(first);
    const secondService = buildService(second);

    runAuditedTransaction({
      db: first.db,
      actor: doctor(),
      work: (tx) => firstService.finalizeCharge(tx, doctor(), "finance-hash-visit", command()),
    });
    runAuditedTransaction({
      db: second.db,
      actor: doctor(),
      work: (tx) => secondService.finalizeCharge(tx, doctor(), "finance-hash-visit", command()),
    });
    const firstHash = first.sqlite.prepare("SELECT content_hash FROM finance_charges").pluck().get();
    const secondHash = second.sqlite.prepare("SELECT content_hash FROM finance_charges").pluck().get();
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
    expect(firstHash).toBe(secondHash);
    expect((first.sqlite.prepare("PRAGMA table_info(finance_charges)").all() as Array<{ name: string }>)
      .map((column) => column.name))
      .not.toContain("gross_total_baht");
    expect(() => first.sqlite.prepare("UPDATE finance_charges SET id = id").run())
      .toThrow(/append-only/i);
    expect(() => first.sqlite.prepare("DELETE FROM finance_charge_lines").run())
      .toThrow(/append-only/i);
    const chargeId = first.sqlite.prepare("SELECT id FROM finance_charges").pluck().get() as string;
    expect(() => first.sqlite.prepare(`
      INSERT INTO finance_charge_lines (
        id, charge_id, position, line_type, description_snapshot, quantity, unit_price_baht, line_total_baht,
        medication_order_item_id, fulfillment_dispense_line_id
      ) VALUES (
        'finance-invalid-extra-line', ?, 3, 'MEDICATION', 'wrong source', 1, 5, 4,
        'finance-order-item-4', 'finance-dispense-line-a-4'
      )
    `).run(chargeId)).toThrow(/line total|source|constraint/i);
  });
});
