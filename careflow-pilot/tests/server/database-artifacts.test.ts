import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../../src/server/db/client.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function temporaryDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "careflow-artifact-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, databasePath: join(directory, "careflow.sqlite") };
}

function copyMigrationsThrough0008(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0008");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0009_fulfillment_completion.sql"));
  rmSync(join(oldPath, "0010_fulfillment_hardening.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 9);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0010(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0010");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0011_dispense_ledger.sql"));
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 11);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0014(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0014");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0015_inventory_adjustment_source_guard.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 15);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0015(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0015");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0016_finance_pricing_snapshots.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 16);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

const immutableMigrationHashesThrough0015 = {
  "0000_platform.sql": "77dbb1cce19d455be9bb06d4dc5d64de0425b0435f9c70ac63a413fc4ce8c9e6",
  "0001_patient.sql": "55af6b78670f63296ab2e6da9cce84a04613dfd31e5c3cba8534eb5a52e7d96f",
  "0002_visit_intake.sql": "74ef1bbd67666b7666cf999823a646bf1ba0810a07c4ec35e9026113edaf4c20",
  "0003_clinical_record.sql": "ad5663157aceb440cbaa2d3d70b91296196884cdba4bc0816fd60d2aa7dfb16f",
  "0004_fearless_catseye.sql": "fc85b6b75e9500ddf9e3e688751b7282659a51f239afa82cad89fda773edc069",
  "0005_append_evidence_snapshots.sql": "270d0f4ebbdf68f4ffd385a2dbc500a3dfcc22ec09c3053d7342b07c4772f6af",
  "0006_inventory_foundation.sql": "97246e729ad1a302513a1de24ca70609ac2ef7d6514cc6b2d6e9ce40943183c1",
  "0007_fulfillment_reservation.sql": "65dcd9e5e8e904ca39230864af4f0edb419ad78d4c04a30f2cf4ca4e37bbc330",
  "0008_milky_manta.sql": "f4f2919a62f2ae81f93336f801475c34f9ed8a061feb3e9393a555fcc9119e6c",
  "0009_fulfillment_completion.sql": "8895add94c8f87d2b081d53c740427c47e75871ce550ed4273d776dcee3437f8",
  "0010_fulfillment_hardening.sql": "3c2a6e18107578ffed005a6342a503fb75fc90aa8cfff9301d9b8514c0c21ad8",
  "0011_dispense_ledger.sql": "cb347daa1fd3c8405f23ba24a518fd70518fdfa86dc18b6da1ed361e032903d3",
  "0012_inventory_revision.sql": "d5b3d9ec4594a71a1a231c722fe4768ab2a2919206469e9d6ba8c3005b61e0d2",
  "0013_stock_movement_source_lot_unique.sql": "55df75b25fedb334628f8215d13375bdb2701d70c844f5ccff10fc59fa4ada2d",
  "0014_inventory_integrity.sql": "d9f3c1612286f53ca0fee1ec2cee954b1d08b128a9ef3153204620d8e6196b03",
  "0015_inventory_adjustment_source_guard.sql": "d3e98f9e0c0bea611a3198a5d892d0fd321ceeee36ec62c901b7f653f64300c2",
} as const;

function seedPopulated0015PricingEvidence(sqlite: Database.Database): void {
  const now = "2026-08-10T00:00:00.000Z";
  const hash = "b".repeat(64);
  sqlite.exec(`
    INSERT INTO staff_accounts (id, clinic_id, username, display_name, role, password_hash, must_change_password, active, revision, last_password_changed_at, created_at, updated_at)
    VALUES ('pricing-upgrade-doctor', 'clinic', 'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', 'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}');
    INSERT INTO patients (id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at)
    VALUES
      ('pricing-upgrade-patient-order', 'clinic', 'DEMO-000090', 'ผู้ป่วยทดสอบ 000090', '0000000090', '1990-01-01', 'unknown', 1, '${now}', '${now}'),
      ('pricing-upgrade-patient-no-med', 'clinic', 'DEMO-000091', 'ผู้ป่วยทดสอบ 000091', '0000000091', '1990-01-01', 'unknown', 1, '${now}', '${now}');
    INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by)
    VALUES
      ('pricing-upgrade-visit-order', 'clinic', 'pricing-upgrade-patient-order', 'AWAITING_CHARGE', 'อัปเกรด ORDER', 7, '${now}', '${now}', 'pricing-upgrade-doctor'),
      ('pricing-upgrade-visit-no-med', 'clinic', 'pricing-upgrade-patient-no-med', 'AWAITING_CHARGE', 'อัปเกรด NO MEDICATION', 3, '${now}', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO medication_decisions (id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id, signed_by, signed_at, content_hash, signed_by_display_name)
    VALUES
      ('pricing-upgrade-decision-order', 'pricing-upgrade-visit-order', 1, 'ORDER', NULL, NULL, NULL, 'pricing-upgrade-doctor', '${now}', '${hash}', 'แพทย์อัปเกรดราคา'),
      ('pricing-upgrade-decision-no-med', 'pricing-upgrade-visit-no-med', 1, 'NO_MEDICATION', 'ไม่จำเป็นต้องใช้ยา', NULL, NULL, 'pricing-upgrade-doctor', '${now}', '${hash}', 'แพทย์อัปเกรดราคา');
    INSERT INTO medication_order_items (id, medication_decision_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th)
    VALUES ('pricing-upgrade-order-item', 'pricing-upgrade-decision-order', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 5, 'รับประทานตามสั่ง');
    INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
    VALUES ('pricing-upgrade-receipt', 'clinic', 'ผู้จำหน่ายอัปเกรดราคา', '', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO inventory_lots (id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by)
    VALUES
      ('pricing-upgrade-lot-a', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-PRICE-A', '2027-08-31', 'ผู้จำหน่ายอัปเกรดราคา', 'AVAILABLE', '${now}', 'pricing-upgrade-doctor'),
      ('pricing-upgrade-lot-b', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-PRICE-B', '2027-08-31', 'ผู้จำหน่ายอัปเกรดราคา', 'AVAILABLE', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
    VALUES
      ('pricing-upgrade-receipt-line-a', 'pricing-upgrade-receipt', 'pricing-upgrade-lot-a', 2, 'เม็ด'),
      ('pricing-upgrade-receipt-line-b', 'pricing-upgrade-receipt', 'pricing-upgrade-lot-b', 3, 'เม็ด');
    INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
    VALUES
      ('pricing-upgrade-receipt-movement-a', 'clinic', 'pricing-upgrade-lot-a', 'RECEIPT', 2, 'RECEIPT', 'pricing-upgrade-receipt', '', '${now}', 'pricing-upgrade-doctor'),
      ('pricing-upgrade-receipt-movement-b', 'clinic', 'pricing-upgrade-lot-b', 'RECEIPT', 3, 'RECEIPT', 'pricing-upgrade-receipt', '', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by)
    VALUES ('pricing-upgrade-reservation', 'clinic', 'pricing-upgrade-visit-order', 'pricing-upgrade-decision-order', 1, 'ACTIVE', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO inventory_reservation_allocations (id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at)
    VALUES
      ('pricing-upgrade-allocation-a', 'pricing-upgrade-reservation', 'pricing-upgrade-order-item', 'pricing-upgrade-lot-a', 0, 2, 'DEMO-MED-001', 'UPGRADE-PRICE-A', '2027-08-31', 'เม็ด', '${now}'),
      ('pricing-upgrade-allocation-b', 'pricing-upgrade-reservation', 'pricing-upgrade-order-item', 'pricing-upgrade-lot-b', 1, 3, 'DEMO-MED-001', 'UPGRADE-PRICE-B', '2027-08-31', 'เม็ด', '${now}');
    INSERT INTO fulfillment_label_versions (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version, created_at, created_by, patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot)
    VALUES ('pricing-upgrade-label', 'clinic', 'pricing-upgrade-visit-order', 'pricing-upgrade-decision-order', 1, 1, '${now}', 'pricing-upgrade-doctor', 'DEMO-000090', 'ผู้ป่วยทดสอบ 000090', 'คลินิกชนบท CareFlow Pilot');
    INSERT INTO fulfillment_label_items (id, label_version_id, medication_order_item_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot, directions_th_snapshot, internal_barcode_snapshot)
    VALUES ('pricing-upgrade-label-item', 'pricing-upgrade-label', 'pricing-upgrade-order-item', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 5, 'เม็ด', 'รับประทานตามสั่ง', 'CF-DEMO-001');
    INSERT INTO fulfillment_label_print_events (id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot)
    VALUES ('pricing-upgrade-print', 'pricing-upgrade-label', 1, '${now}', 'pricing-upgrade-doctor', 'test', '80x100mm');
    INSERT INTO fulfillment_preparations (id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version, label_version_id, revision, status, minimum_print_sequence, created_at, created_by)
    VALUES ('pricing-upgrade-preparation', 'clinic', 'pricing-upgrade-visit-order', 'pricing-upgrade-reservation', 'pricing-upgrade-decision-order', 1, 'pricing-upgrade-label', 1, 'ACTIVE', 1, '${now}', 'pricing-upgrade-doctor');
    UPDATE fulfillment_preparations
    SET status = 'COMPLETED', revision = 2, completed_at = '${now}', completed_by = 'pricing-upgrade-doctor'
    WHERE id = 'pricing-upgrade-preparation';
    INSERT INTO fulfillment_preparation_confirmations (id, preparation_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity, method, barcode_snapshot, manual_reason, confirmed_at, confirmed_by)
    VALUES
      ('pricing-upgrade-confirmation-a', 'pricing-upgrade-preparation', 'pricing-upgrade-allocation-a', 'pricing-upgrade-order-item', 'DEMO-MED-001', 'pricing-upgrade-lot-a', 2, 'BARCODE', 'CF-DEMO-001', NULL, '${now}', 'pricing-upgrade-doctor'),
      ('pricing-upgrade-confirmation-b', 'pricing-upgrade-preparation', 'pricing-upgrade-allocation-b', 'pricing-upgrade-order-item', 'DEMO-MED-001', 'pricing-upgrade-lot-b', 3, 'BARCODE', 'CF-DEMO-001', NULL, '${now}', 'pricing-upgrade-doctor');
    INSERT INTO fulfillment_releases (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by)
    VALUES ('pricing-upgrade-release', 'clinic', 'pricing-upgrade-visit-order', 'pricing-upgrade-decision-order', 1, 'pricing-upgrade-label', 'pricing-upgrade-print', 'pricing-upgrade-preparation', 2, 'pricing-upgrade-reservation', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO fulfillment_dispenses (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, preparation_id, release_id, reservation_id, handed_off_at, handed_off_by)
    VALUES ('pricing-upgrade-dispense', 'clinic', 'pricing-upgrade-visit-order', 'pricing-upgrade-decision-order', 1, 'pricing-upgrade-label', 'pricing-upgrade-preparation', 'pricing-upgrade-release', 'pricing-upgrade-reservation', '${now}', 'pricing-upgrade-doctor');
    INSERT INTO fulfillment_dispense_lines (id, dispense_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number_snapshot, expiry_date_snapshot, directions_th_snapshot)
    VALUES
      ('pricing-upgrade-dispense-line-a', 'pricing-upgrade-dispense', 'pricing-upgrade-allocation-a', 'pricing-upgrade-order-item', 'DEMO-MED-001', 'pricing-upgrade-lot-a', 2, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-PRICE-A', '2027-08-31', 'รับประทานตามสั่ง'),
      ('pricing-upgrade-dispense-line-b', 'pricing-upgrade-dispense', 'pricing-upgrade-allocation-b', 'pricing-upgrade-order-item', 'DEMO-MED-001', 'pricing-upgrade-lot-b', 3, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-PRICE-B', '2027-08-31', 'รับประทานตามสั่ง');
    INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
    VALUES
      ('pricing-upgrade-dispense-movement-a', 'clinic', 'pricing-upgrade-lot-a', 'DISPENSE', -2, 'DISPENSE', 'pricing-upgrade-dispense-line-a', '', '${now}', 'pricing-upgrade-doctor'),
      ('pricing-upgrade-dispense-movement-b', 'clinic', 'pricing-upgrade-lot-b', 'DISPENSE', -3, 'DISPENSE', 'pricing-upgrade-dispense-line-b', '', '${now}', 'pricing-upgrade-doctor');
    UPDATE inventory_reservations
    SET status = 'CONSUMED', consumed_at = '${now}', consumed_by = 'pricing-upgrade-doctor', consumed_dispense_id = 'pricing-upgrade-dispense'
    WHERE id = 'pricing-upgrade-reservation';
  `);
}

function seedPopulated0008Database(sqlite: Database.Database): void {
  const now = "2026-08-09T00:00:00.000Z";
  const hash = "a".repeat(64);
  sqlite.exec(`
    INSERT INTO staff_accounts (id, clinic_id, username, display_name, role, password_hash, must_change_password, active, revision, last_password_changed_at, created_at, updated_at)
    VALUES ('upgrade-doctor', 'clinic', 'upgrade-doctor', 'แพทย์ทดสอบ 000099', 'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}');
    INSERT INTO patients (id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at)
    VALUES ('upgrade-patient', 'clinic', 'DEMO-000099', 'ผู้ป่วยทดสอบ 000099', '0000000099', '1990-01-01', 'unknown', 1, '${now}', '${now}');
    INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, created_by)
    VALUES ('upgrade-visit', 'clinic', 'upgrade-patient', 'AWAITING_PREPARATION', 'อัปเกรด', 3, '${now}', 'upgrade-doctor');
    INSERT INTO medication_decisions (id, visit_id, version, kind, signed_by, signed_at, content_hash, signed_by_display_name)
    VALUES ('upgrade-decision', 'upgrade-visit', 1, 'ORDER', 'upgrade-doctor', '${now}', '${hash}', 'แพทย์ทดสอบ');
    INSERT INTO medication_order_items (id, medication_decision_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th)
    VALUES ('upgrade-order-item', 'upgrade-decision', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 3, 'ทดสอบ');
    INSERT INTO inventory_lots (id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by)
    VALUES ('upgrade-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-LOT', '2026-12-31', 'ผู้ขายทดสอบ', 'AVAILABLE', '${now}', 'upgrade-doctor');
    INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
    VALUES ('upgrade-receipt', 'clinic', 'ผู้ขายทดสอบ', 'อัปเกรด', '${now}', 'upgrade-doctor');
    INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
    VALUES ('upgrade-receipt-line', 'upgrade-receipt', 'upgrade-lot', 5, 'เม็ด');
    INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
    VALUES ('upgrade-movement', 'clinic', 'upgrade-lot', 'RECEIPT', 5, 'RECEIPT', 'upgrade-receipt', 'อัปเกรด', '${now}', 'upgrade-doctor');
    INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by)
    VALUES ('upgrade-reservation', 'clinic', 'upgrade-visit', 'upgrade-decision', 1, 'ACTIVE', '${now}', 'upgrade-doctor');
    INSERT INTO inventory_reservation_allocations (id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at)
    VALUES ('upgrade-allocation', 'upgrade-reservation', 'upgrade-order-item', 'upgrade-lot', 0, 3, 'DEMO-MED-001', 'UPGRADE-LOT', '2026-12-31', 'เม็ด', '${now}');
  `);
}

it("migrates a populated 0008 database to current fulfillment persistence with foreign keys enabled", () => {
  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0008(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0008Database(sqlite);
    const before = {
      medication: sqlite.prepare("SELECT id, revision FROM medications WHERE id = 'DEMO-MED-001'").get(),
      orderItem: sqlite.prepare("SELECT id, medication_revision, quantity FROM medication_order_items WHERE id = 'upgrade-order-item'").get(),
      reservation: sqlite.prepare("SELECT id, status FROM inventory_reservations WHERE id = 'upgrade-reservation'").get(),
      allocation: sqlite.prepare("SELECT id, quantity FROM inventory_reservation_allocations WHERE id = 'upgrade-allocation'").get(),
      lot: sqlite.prepare("SELECT id, medication_revision FROM inventory_lots WHERE id = 'upgrade-lot'").get(),
      movementTotal: sqlite.prepare("SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM inventory_stock_movements WHERE lot_id = 'upgrade-lot'").get(),
    };
    migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT id, revision FROM medications WHERE id = 'DEMO-MED-001'").get()).toEqual(before.medication);
    expect(sqlite.prepare("SELECT id, medication_revision, quantity FROM medication_order_items WHERE id = 'upgrade-order-item'").get()).toEqual(before.orderItem);
    expect(sqlite.prepare("SELECT id, status FROM inventory_reservations WHERE id = 'upgrade-reservation'").get()).toEqual(before.reservation);
    expect(sqlite.prepare("SELECT id, quantity FROM inventory_reservation_allocations WHERE id = 'upgrade-allocation'").get()).toEqual(before.allocation);
    expect(sqlite.prepare("SELECT id, medication_revision FROM inventory_lots WHERE id = 'upgrade-lot'").get()).toEqual(before.lot);
    expect(sqlite.prepare("SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM inventory_stock_movements WHERE lot_id = 'upgrade-lot'").get()).toEqual(before.movementTotal);
    expect(sqlite.prepare(`
      SELECT
        (SELECT COALESCE(SUM(quantity_delta), 0) FROM inventory_stock_movements WHERE lot_id = 'upgrade-lot') AS on_hand,
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_reservation_allocations AS allocation
          INNER JOIN inventory_reservations AS reservation ON reservation.id = allocation.reservation_id
          WHERE allocation.lot_id = 'upgrade-lot' AND reservation.status = 'ACTIVE') AS reserved,
        (SELECT COALESCE(SUM(quantity_delta), 0) FROM inventory_stock_movements WHERE lot_id = 'upgrade-lot')
          - (SELECT COALESCE(SUM(quantity), 0) FROM inventory_reservation_allocations AS allocation
            INNER JOIN inventory_reservations AS reservation ON reservation.id = allocation.reservation_id
            WHERE allocation.lot_id = 'upgrade-lot' AND reservation.status = 'ACTIVE') AS available
    `).get()).toEqual({ on_hand: 5, reserved: 3, available: 2 });
    expect(sqlite.prepare("SELECT internal_barcode FROM medications WHERE id = 'DEMO-MED-001'").pluck().get()).toBe("CF-DEMO-001");
    expect(sqlite.prepare("SELECT count(*) FROM fulfillment_label_versions WHERE medication_decision_id = 'upgrade-decision'").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT count(*) FROM fulfillment_label_items WHERE medication_order_item_id = 'upgrade-order-item'").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT status, revision FROM fulfillment_preparations WHERE reservation_id = 'upgrade-reservation'").get()).toEqual({ status: "ACTIVE", revision: 1 });
  } finally {
    sqlite.close();
  }
});

it("migrates a populated 0010 ledger to DISPENSE support without disabling foreign keys or changing receipt rows", () => {
  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0010(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0008Database(sqlite);
    const before = sqlite.prepare("SELECT id, lot_id, movement_type, quantity_delta, source_type, source_id FROM inventory_stock_movements WHERE id = 'upgrade-movement'").get();
    migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT id, lot_id, movement_type, quantity_delta, source_type, source_id FROM inventory_stock_movements WHERE id = 'upgrade-movement'").get()).toEqual(before);
    expect(sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'upgrade-lot'").get()).toEqual({ revision: 1 });
    expect(() => sqlite.prepare("UPDATE inventory_lots SET revision = 0 WHERE id = 'upgrade-lot'").run()).toThrow(/revision must be positive/i);
    expect(() => sqlite.prepare("UPDATE inventory_stock_movements SET quantity_delta = 4 WHERE id = 'upgrade-movement'").run()).toThrow(/append-only/i);
    expect(() => sqlite.prepare("INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id) VALUES ('duplicate-movement', 'clinic', 'upgrade-lot', 'RECEIPT', 5, 'RECEIPT', 'upgrade-receipt', 'duplicate', '2026-08-09T00:00:00.000Z', 'upgrade-doctor')").run()).toThrow(/unique/i);
  } finally {
    sqlite.close();
  }
});

it("keeps 0014 immutable and upgrades populated inventory rows with the additive 0015 correction guard", () => {
  const migrationPath = join(process.cwd(), "drizzle", "0014_inventory_integrity.sql");
  expect(createHash("sha256").update(readFileSync(migrationPath)).digest("hex")).toBe(
    "d9f3c1612286f53ca0fee1ec2cee954b1d08b128a9ef3153204620d8e6196b03",
  );
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  expect(journal.entries).toHaveLength(18);
  expect(journal.entries[14]).toMatchObject({ idx: 14, tag: "0014_inventory_integrity" });
  expect(journal.entries[15]).toMatchObject({ idx: 15, tag: "0015_inventory_adjustment_source_guard" });
  expect(journal.entries[16]).toMatchObject({ idx: 16, tag: "0016_finance_pricing_snapshots" });
  expect(journal.entries[17]).toMatchObject({ idx: 17, tag: "0017_charge_collection_ledger" });

  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0014(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0008Database(sqlite);
    sqlite.exec(`
      INSERT INTO inventory_lots (id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by)
      VALUES ('upgrade-other-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'UPGRADE-OTHER-LOT', '2027-01-31', 'ผู้ขายทดสอบ', 'AVAILABLE', '2026-08-09T00:00:00.000Z', 'upgrade-doctor');
      INSERT INTO inventory_receipts (id, clinic_id, supplier_name, note, received_at, received_by)
      VALUES ('upgrade-other-receipt', 'clinic', 'ผู้ขายทดสอบ', 'อัปเกรดล็อตที่สอง', '2026-08-09T00:00:00.000Z', 'upgrade-doctor');
      INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
      VALUES ('upgrade-other-receipt-line', 'upgrade-other-receipt', 'upgrade-other-lot', 2, 'เม็ด');
      INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
      VALUES ('upgrade-other-movement', 'clinic', 'upgrade-other-lot', 'RECEIPT', 2, 'RECEIPT', 'upgrade-other-receipt', 'อัปเกรดล็อตที่สอง', '2026-08-09T00:00:00.000Z', 'upgrade-doctor');
    `);
    const before = {
      lot: sqlite.prepare("SELECT id, revision FROM inventory_lots WHERE id = 'upgrade-lot'").get(),
      movement: sqlite
        .prepare("SELECT id, lot_id, quantity_delta, source_type, source_id FROM inventory_stock_movements WHERE id = 'upgrade-movement'")
        .get(),
      trigger: sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'inventory_adjustments_correction_source_guard'")
        .get(),
    };
    expect(before.trigger).toBeUndefined();

    migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(18);
    expect(sqlite.prepare("SELECT id, revision FROM inventory_lots WHERE id = 'upgrade-lot'").get()).toEqual(before.lot);
    expect(
      sqlite
        .prepare("SELECT id, lot_id, quantity_delta, source_type, source_id FROM inventory_stock_movements WHERE id = 'upgrade-movement'")
        .get(),
    ).toEqual(before.movement);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'inventory_adjustments_correction_source_guard'")
        .get(),
    ).toEqual({ name: "inventory_adjustments_correction_source_guard" });
    expect(() =>
      sqlite
        .prepare(`
          INSERT INTO inventory_adjustments (id, clinic_id, lot_id, corrects_movement_id, quantity_delta, reason, occurred_at, actor_id)
          VALUES ('upgrade-invalid-cross-lot-adjustment', 'clinic', 'upgrade-lot', 'upgrade-other-movement', 1, 'ข้ามล็อต', '2026-08-09T00:00:00.000Z', 'upgrade-doctor')
        `)
        .run(),
    ).toThrow(/correction|invalid/i);
  } finally {
    sqlite.close();
  }
});

it("upgrades populated 0015 ORDER, NO_MEDICATION, multi-lot DISPENSE, and AWAITING_CHARGE evidence with deterministic price snapshots", () => {
  for (const [file, expectedHash] of Object.entries(immutableMigrationHashesThrough0015)) {
    expect(createHash("sha256").update(readFileSync(join(process.cwd(), "drizzle", file))).digest("hex")).toBe(expectedHash);
  }
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  expect(journal.entries.slice(0, 16).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
    { idx: 0, tag: "0000_platform" },
    { idx: 1, tag: "0001_patient" },
    { idx: 2, tag: "0002_visit_intake" },
    { idx: 3, tag: "0003_clinical_record" },
    { idx: 4, tag: "0004_fearless_catseye" },
    { idx: 5, tag: "0005_append_evidence_snapshots" },
    { idx: 6, tag: "0006_inventory_foundation" },
    { idx: 7, tag: "0007_fulfillment_reservation" },
    { idx: 8, tag: "0008_milky_manta" },
    { idx: 9, tag: "0009_fulfillment_completion" },
    { idx: 10, tag: "0010_fulfillment_hardening" },
    { idx: 11, tag: "0011_dispense_ledger" },
    { idx: 12, tag: "0012_inventory_revision" },
    { idx: 13, tag: "0013_stock_movement_source_lot_unique" },
    { idx: 14, tag: "0014_inventory_integrity" },
    { idx: 15, tag: "0015_inventory_adjustment_source_guard" },
  ]);

  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0015(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0015PricingEvidence(sqlite);
    const oldMigrationRecords = sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all();
    const sourceTables = [
      "patients",
      "visits",
      "medication_decisions",
      "medication_order_items",
      "inventory_lots",
      "inventory_reservation_allocations",
      "inventory_stock_movements",
      "fulfillment_dispenses",
      "fulfillment_dispense_lines",
    ];
    const before = Object.fromEntries(sourceTables.map((table) => [
      table,
      Buffer.from(JSON.stringify(sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())),
    ]));

    migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 16))
      .toEqual(oldMigrationRecords);
    const migrationCount = sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get();
    expect(migrationCount).toBe(18);
    if (migrationCount !== 18) return;
    for (const table of sourceTables) {
      expect(Buffer.from(JSON.stringify(sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))).toEqual(before[table]);
    }
    expect(sqlite.prepare(`
      SELECT snapshot.id, snapshot.medication_order_item_id, snapshot.medication_id, snapshot.medication_revision,
        snapshot.unit_price_baht_snapshot, snapshot.currency, snapshot.captured_at
      FROM medication_order_price_snapshots AS snapshot
      ORDER BY snapshot.id
    `).all()).toEqual([{
      id: "price-order-pricing-upgrade-order-item",
      medication_order_item_id: "pricing-upgrade-order-item",
      medication_id: "DEMO-MED-001",
      medication_revision: 1,
      unit_price_baht_snapshot: 5,
      currency: "THB",
      captured_at: "2026-08-10T00:00:00.000Z",
    }]);
    expect(sqlite.prepare(`
      SELECT snapshot.id, snapshot.fulfillment_dispense_line_id, snapshot.order_price_snapshot_id,
        snapshot.medication_id, snapshot.unit_price_baht_snapshot, snapshot.currency, snapshot.captured_at
      FROM fulfillment_dispense_price_snapshots AS snapshot
      ORDER BY snapshot.fulfillment_dispense_line_id
    `).all()).toEqual([
      {
        id: "price-dispense-pricing-upgrade-dispense-line-a",
        fulfillment_dispense_line_id: "pricing-upgrade-dispense-line-a",
        order_price_snapshot_id: "price-order-pricing-upgrade-order-item",
        medication_id: "DEMO-MED-001",
        unit_price_baht_snapshot: 5,
        currency: "THB",
        captured_at: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "price-dispense-pricing-upgrade-dispense-line-b",
        fulfillment_dispense_line_id: "pricing-upgrade-dispense-line-b",
        order_price_snapshot_id: "price-order-pricing-upgrade-order-item",
        medication_id: "DEMO-MED-001",
        unit_price_baht_snapshot: 5,
        currency: "THB",
        captured_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
    expect(sqlite.prepare(`
      SELECT count(*)
      FROM medication_order_price_snapshots AS snapshot
      INNER JOIN medication_order_items AS item ON item.id = snapshot.medication_order_item_id
      WHERE item.medication_decision_id = 'pricing-upgrade-decision-no-med'
    `).pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT count(*) FROM finance_charges").pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT count(*) FROM finance_charge_lines").pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT count(*) FROM finance_charge_adjustments").pluck().get()).toBe(0);
    expect(sqlite.prepare("SELECT count(*) FROM finance_payments").pluck().get()).toBe(0);
  } finally {
    sqlite.close();
  }
});

it("adds only the immutable 0017 charge-collection ledger artifacts after the frozen migration history", () => {
  const migrationsPath = join(process.cwd(), "drizzle");
  expect(existsSync(join(migrationsPath, "0017_charge_collection_ledger.sql"))).toBe(true);
  expect(existsSync(join(migrationsPath, "meta", "0017_snapshot.json"))).toBe(true);
  const journal = JSON.parse(readFileSync(join(migrationsPath, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  expect(journal.entries).toHaveLength(18);
  expect(journal.entries[16]).toMatchObject({ idx: 16, tag: "0016_finance_pricing_snapshots" });
  expect(journal.entries[17]).toMatchObject({ idx: 17, tag: "0017_charge_collection_ledger" });
});

describe.each(["-wal", "-shm"])("pre-existing SQLite %s artifact", (suffix) => {
  it("rejects a symbolic link without touching its target or creating the database", () => {
    const { directory, databasePath } = temporaryDatabase();
    const unrelatedPath = join(directory, `unrelated${suffix}`);
    const artifactPath = `${databasePath}${suffix}`;
    writeFileSync(unrelatedPath, "must-not-change", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(unrelatedPath, 0o644);
    const beforeMode = statSync(unrelatedPath).mode & 0o777;
    const beforeBytes = readFileSync(unrelatedPath);
    symlinkSync(unrelatedPath, artifactPath);

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(lstatSync(artifactPath).isSymbolicLink()).toBe(true);
    expect(statSync(unrelatedPath).mode & 0o777).toBe(beforeMode);
    expect(readFileSync(unrelatedPath)).toEqual(beforeBytes);
  });

  it("rejects a directory before creating the database", () => {
    const { databasePath } = temporaryDatabase();
    const artifactPath = `${databasePath}${suffix}`;
    mkdirSync(artifactPath, { mode: 0o700 });

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(statSync(artifactPath).isDirectory()).toBe(true);
  });

  it("rejects a hard-link alias without touching either name or creating the database", () => {
    const { directory, databasePath } = temporaryDatabase();
    const unrelatedPath = join(directory, `unrelated-hardlink${suffix}`);
    const artifactPath = `${databasePath}${suffix}`;
    writeFileSync(unrelatedPath, "must-not-change", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(unrelatedPath, 0o644);
    const beforeMode = statSync(unrelatedPath).mode & 0o777;
    const beforeBytes = readFileSync(unrelatedPath);
    linkSync(unrelatedPath, artifactPath);

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(statSync(artifactPath).nlink).toBe(2);
    expect(statSync(unrelatedPath).mode & 0o777).toBe(beforeMode);
    expect(readFileSync(unrelatedPath)).toEqual(beforeBytes);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a non-regular artifact before creating the database",
    () => {
      const { databasePath } = temporaryDatabase();
      const artifactPath = `${databasePath}${suffix}`;
      execFileSync("mkfifo", [artifactPath]);

      expect(() => {
        const handle = openDatabase(databasePath);
        handle.close();
      }).toThrow("unsafe SQLite artifact");

      expect(existsSync(databasePath)).toBe(false);
      expect(lstatSync(artifactPath).isFIFO()).toBe(true);
    },
  );
});
