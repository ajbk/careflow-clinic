import { execFileSync } from "node:child_process";
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
  } finally {
    sqlite.close();
  }
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
