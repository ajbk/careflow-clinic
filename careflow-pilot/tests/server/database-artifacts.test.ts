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

function copyMigrationsThrough0018(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0018");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0019_post_close_reservation_guards.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 19);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0019(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0019");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0020_post_close_replace_guards.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 20);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0020(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0020");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0021_protected_insert_conflict_guards.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 21);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

function copyMigrationsThrough0021(target: string): string {
  const source = join(process.cwd(), "drizzle");
  const oldPath = join(target, "drizzle-0021");
  cpSync(source, oldPath, { recursive: true });
  rmSync(join(oldPath, "0022_closed_visit_insert_guard.sql"), { force: true });
  const journalPath = join(oldPath, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ idx: number }> };
  journal.entries = journal.entries.filter((entry) => entry.idx < 22);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return oldPath;
}

const immutableMigrationHashesThrough0022 = {
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
  "0016_finance_pricing_snapshots.sql": "642b751216a26a0ab0736ddcc812dd70177cba69402c5eb674bd1ae296a28d48",
  "0017_charge_collection_ledger.sql": "a393193c46b255b16e6af37cd6ccf7015083660a9089222ce84cd229690f3d38",
  "0018_visit_closure_integrity.sql": "68059f8e06e2051415c632c68efdc3b77aa1ec58beda227d73d32387f8c0ee0a",
  "0019_post_close_reservation_guards.sql": "31c6be4917adbe0d0758ff615ecdbde680649137ae9da5031b9f16c330d0f5e1",
  "0020_post_close_replace_guards.sql": "d346745b4810751cbc8306ddcf424f61932e144f9e4576139ac3dd0ddb106128",
  "0021_protected_insert_conflict_guards.sql": "96155e3424b40627db36eb2b6bb280c4d87e1382af48581280065a4782c69395",
  "0022_closed_visit_insert_guard.sql": "3b90a32c0b0d6870bbbd94deb0438423ca628f263c3de0f35d6341f6bd0c9691",
} as const;

const immutableMigrationSnapshotHashesThrough0022 = {
  "0000_snapshot.json": "61925e834bd4f002e75d36d2dfe8517c7ac30cfde5f43c1de874ac305559bed6",
  "0001_snapshot.json": "b8f94f95c24f38b16179369fd1b93475a9c0e925a08b5444f1e70dc7f379322c",
  "0002_snapshot.json": "b2387cf5b7f9e4334c2d7699004d867f52c13edb0ea21fa6fca5c6c00387269f",
  "0003_snapshot.json": "d838e51259deaeb5bb50e5b0f95057345826c91bcd7b8edbba7fc072f79cf826",
  "0004_snapshot.json": "400b542a468b497ce1d02a57acb5140265161188b9c3cfdc8f394701d703cb12",
  "0006_snapshot.json": "a4526e4ddcd06d0fceeec24acbd87a4c41c562cc590d7196e2df41496bddfc03",
  "0007_snapshot.json": "83c73558b01f50ef90eae19f48cbee561037683da0579d13b9f612f8575aac30",
  "0008_snapshot.json": "81e1636fc8edfc816b2159961dd4fe3313520d0d230bfde9d3112b7b384d29dc",
  "0009_snapshot.json": "0f2e79028134367be74e80f3b736ad837eaa876826b6c7d80a488c3e00148668",
  "0010_snapshot.json": "0c2ff933793d25a498d592f63d7a6820ef68b2c43ba7ee07a8be3c6043ef2822",
  "0011_snapshot.json": "2c916efceaeef639b257786a4f1593b8fd1e4a74aed6a030187b912e87690cca",
  "0012_snapshot.json": "40a9405c868b0970104e28e588de3faa07fb26815007522dbac6f1bd59aefdda",
  "0013_snapshot.json": "7188c9349aca7de7327c679adc67493445e51ac3e96a43ed707d4f9be916cca0",
  "0014_snapshot.json": "8e9bb07c6b796746b24f907dab13e5fb4f9704a76ff12257ceceb8cc72640866",
  "0015_snapshot.json": "a1a5d84d0ec6ae46ebfce19d4752717b4742628148fc27605a23b842c08fbd75",
  "0016_snapshot.json": "fc1b64e51a5a27bee58879473d5608a6b6471e91ed3654f8669ece2a4af27c79",
  "0017_snapshot.json": "711d49d079ed9bff7cdb96945769e07be506d7ce5ed8f2bf45b0abe7aee7668d",
  "0018_snapshot.json": "dc4d4dcb7b4f0c8c69880961aaa970d3e6080670c3581a0d960018a0a0612003",
  "0019_snapshot.json": "35e76769c409004c834576039582ddebc134b688c5848a13fd44a9d5b245e19b",
  "0020_snapshot.json": "0751a33f012a9fb417ed1f51127fb19a03dae4979ef4272dd527b7ff8a09064d",
  "0021_snapshot.json": "53f896f144497ea735c9bd510d1fa97447323094909545a15f3bab106307a600",
  "0022_snapshot.json": "260ea9613c7f75e94df6f854efa5919bf500a1ff593b50a6a7eeba491fc6fd82",
} as const;

const operationalConflictTables = new Set(["clinic_counters", "sessions"]);

interface ProtectedConflictKey {
  table: string;
  name: string;
  columns: string[];
  partial: boolean;
}

function protectedConflictInventory(sqlite: Database.Database): {
  tables: string[];
  keys: ProtectedConflictKey[];
} {
  const tables = (sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).pluck().all() as string[]).filter((table) => !operationalConflictTables.has(table));
  const keys: ProtectedConflictKey[] = [];
  for (const table of tables) {
    const primaryColumns = sqlite.prepare(
      "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
    ).pluck().all(table) as string[];
    keys.push({ table, name: `${table} primary key`, columns: primaryColumns, partial: false });
    const indexes = sqlite.prepare(`
      SELECT name, partial FROM pragma_index_list(?)
      WHERE [unique] = 1 AND name NOT LIKE 'sqlite_autoindex_%'
      ORDER BY name
    `).all(table) as Array<{ name: string; partial: number }>;
    for (const index of indexes) {
      keys.push({
        table,
        name: index.name,
        columns: sqlite.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").pluck().all(index.name) as string[],
        partial: index.partial === 1,
      });
    }
  }
  return { tables, keys };
}

function seedPopulated0018ClosedReservation(sqlite: Database.Database): void {
  const now = "2026-08-10T00:00:00.000Z";
  const hash = "c".repeat(64);
  sqlite.exec(`
    INSERT INTO staff_accounts (
      id, clinic_id, username, display_name, role, password_hash, must_change_password,
      active, revision, last_password_changed_at, created_at, updated_at
    ) VALUES (
      'closure-upgrade-doctor', 'clinic', 'closure-upgrade-doctor', 'พญ. อัปเกรด Closure',
      'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}'
    );
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'closure-upgrade-patient', 'clinic', 'DEMO-000098', 'ผู้ป่วยทดสอบ 000098',
      '0000000098', '1990-01-01', 'unknown', 1, '${now}', '${now}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES (
      'closure-upgrade-visit', 'clinic', 'closure-upgrade-patient', 'AWAITING_CHARGE',
      'ทดสอบอัปเกรด Closure', 7, '${now}', '${now}', 'closure-upgrade-doctor'
    );
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'closure-upgrade-note', 'closure-upgrade-visit', 1, 'S', 'O', 'A', 'P', 1,
      'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('closure-upgrade-diagnosis', 'closure-upgrade-note', 0, 'ทดสอบ');
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, no_medication_reason, signed_by,
      signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'closure-upgrade-decision', 'closure-upgrade-visit', 1, 'NO_MEDICATION',
      'ไม่มีข้อบ่งใช้ยา', 'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'
    );
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot,
      quantity, directions_th
    ) VALUES (
      'closure-upgrade-order-item', 'closure-upgrade-decision', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'ทดสอบ guard'
    );
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, display_name_snapshot,
      strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
      supplier_name, status, created_at, created_by
    ) VALUES (
      'closure-upgrade-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
      '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'CLOSURE-UPGRADE-LOT', '2027-08-10',
      'ผู้ขายทดสอบ', 'AVAILABLE', '${now}', 'closure-upgrade-doctor'
    );
    INSERT INTO finance_charges (
      id, clinic_id, visit_id, source_kind, medication_decision_id,
      medication_decision_version, fulfillment_dispense_id, clinic_pricing_revision,
      consultation_fee_baht_snapshot, currency, line_count, finalized_by,
      finalized_by_display_name, finalized_at, content_hash
    ) VALUES (
      'closure-upgrade-charge', 'clinic', 'closure-upgrade-visit', 'NO_MEDICATION',
      'closure-upgrade-decision', 1, NULL, 1, 100, 'THB', 1,
      'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'
    );
    INSERT INTO finance_charge_lines (
      id, charge_id, position, line_type, description_snapshot, quantity,
      unit_price_baht, line_total_baht, medication_order_item_id, fulfillment_dispense_line_id
    ) VALUES (
      'closure-upgrade-charge-line', 'closure-upgrade-charge', 0, 'CONSULTATION',
      'ค่าตรวจ', 1, 100, 100, NULL, NULL
    );
    UPDATE visits SET status = 'AWAITING_PAYMENT', revision = 8
    WHERE id = 'closure-upgrade-visit';
    INSERT INTO finance_payments (
      id, charge_id, visit_id, method, amount_baht, manual_reference,
      confirmed_by, confirmed_by_display_name, confirmed_at, content_hash
    ) VALUES (
      'closure-upgrade-payment', 'closure-upgrade-charge', 'closure-upgrade-visit',
      'CASH', 100, NULL, 'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'
    );
    UPDATE visits SET status = 'READY_TO_CLOSE', revision = 9
    WHERE id = 'closure-upgrade-visit';
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      status, created_at, created_by
    ) VALUES (
      'closure-upgrade-reservation', 'clinic', 'closure-upgrade-visit',
      'closure-upgrade-decision', 1, 'ACTIVE', '${now}', 'closure-upgrade-doctor'
    );
    INSERT INTO inventory_reservation_allocations (
      id, reservation_id, medication_order_item_id, lot_id, position, quantity,
      medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
    ) VALUES (
      'closure-upgrade-allocation', 'closure-upgrade-reservation',
      'closure-upgrade-order-item', 'closure-upgrade-lot', 0, 1, 'DEMO-MED-001',
      'CLOSURE-UPGRADE-LOT', '2027-08-10', 'เม็ด', '${now}'
    );
    UPDATE inventory_reservations SET
      status = 'RELEASED', released_at = '${now}', released_by = 'closure-upgrade-doctor',
      release_reason = 'ยกเลิกก่อนปิด Visit'
    WHERE id = 'closure-upgrade-reservation';
    INSERT INTO visit_closures (
      id, clinic_id, visit_id, visit_revision, charge_id, payment_id, waiver_adjustment_id,
      clinic_name_snapshot, patient_id_snapshot, patient_hn_snapshot,
      patient_display_name_snapshot, patient_birth_date_snapshot, patient_sex_snapshot,
      doctor_id_snapshot, doctor_display_name_snapshot, closed_at, content_hash
    ) VALUES (
      'closure-upgrade-closure', 'clinic', 'closure-upgrade-visit', 9,
      'closure-upgrade-charge', 'closure-upgrade-payment', NULL,
      'คลินิกชนบท CareFlow Pilot', 'closure-upgrade-patient', 'DEMO-000098',
      'ผู้ป่วยทดสอบ 000098', '1990-01-01', 'unknown',
      'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'
    );
    UPDATE visits SET status = 'CLOSED', revision = 10, closed_at = '${now}'
    WHERE id = 'closure-upgrade-visit';
  `);
}

function seedOpenReplacementTargets(sqlite: Database.Database): void {
  const now = "2026-08-10T00:00:00.000Z";
  const hash = "e".repeat(64);
  sqlite.exec(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES
      ('replace-open-patient-reservation', 'clinic', 'DEMO-000096', 'ผู้ป่วยทดสอบ 000096',
       '0000000096', '1990-01-01', 'unknown', 1, '${now}', '${now}'),
      ('replace-open-patient-allocation', 'clinic', 'DEMO-000097', 'ผู้ป่วยทดสอบ 000097',
       '0000000097', '1990-01-01', 'unknown', 1, '${now}', '${now}');
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
    ) VALUES
      ('replace-open-visit-reservation', 'clinic', 'replace-open-patient-reservation',
       'AWAITING_PREPARATION', 'ทดสอบแทน reservation', 1, '${now}', '${now}', 'closure-upgrade-doctor'),
      ('replace-open-visit-allocation', 'clinic', 'replace-open-patient-allocation',
       'AWAITING_PREPARATION', 'ทดสอบแทน allocation', 1, '${now}', '${now}', 'closure-upgrade-doctor');
    INSERT INTO medication_decisions (
      id, visit_id, version, kind, signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES
      ('replace-open-decision-reservation', 'replace-open-visit-reservation', 1, 'ORDER',
       'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}'),
      ('replace-open-decision-allocation', 'replace-open-visit-allocation', 1, 'ORDER',
       'closure-upgrade-doctor', 'พญ. อัปเกรด Closure', '${now}', '${hash}');
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot,
      quantity, directions_th
    ) VALUES (
      'replace-open-order-item', 'replace-open-decision-allocation', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'ทดสอบ guard'
    );
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
      status, created_at, created_by
    ) VALUES (
      'replace-open-reservation', 'clinic', 'replace-open-visit-allocation',
      'replace-open-decision-allocation', 1, 'ACTIVE', '${now}', 'closure-upgrade-doctor'
    );
  `);
}

it("inventories every protected SQLite PK/UNIQUE key and installs one systematic conflict guard per table", () => {
  const { databasePath } = temporaryDatabase();
  const sqlite = new Database(databasePath);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
    const inventory = protectedConflictInventory(sqlite);
    expect(inventory.tables).toHaveLength(46);
    expect(inventory.keys).toHaveLength(90);
    expect(inventory.keys.filter((key) => key.name.endsWith("primary key"))).toHaveLength(46);
    expect(inventory.keys.filter((key) => !key.name.endsWith("primary key"))).toHaveLength(44);

    const guardRows = sqlite.prepare(`
      SELECT name, tbl_name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE '%_protected_insert_conflict_guard'
      ORDER BY name
    `).all() as Array<{ name: string; tbl_name: string; sql: string }>;
    expect(guardRows).toHaveLength(46);
    expect(guardRows.map((row) => row.tbl_name).sort()).toEqual(inventory.tables);
    expect(guardRows.some((row) => operationalConflictTables.has(row.tbl_name))).toBe(false);

    for (const key of inventory.keys) {
      const triggerSql = guardRows.find((row) => row.tbl_name === key.table)?.sql ?? "";
      const predicate = key.columns
        .map((column) => `existing.\`${column}\` = NEW.\`${column}\``)
        .join(" AND ");
      expect(triggerSql, `${key.table}: ${key.name}`).toContain(predicate);
    }

    const partialPredicates = {
      finance_charge_lines: ["existing.`line_type` = 'CONSULTATION'", "NEW.`line_type` = 'CONSULTATION'"],
      inventory_reservations: ["existing.`status` = 'ACTIVE'", "NEW.`status` = 'ACTIVE'"],
      medications: ["existing.`active` = 1", "NEW.`active` = 1"],
      visits: ["existing.`status` <> 'CLOSED'", "NEW.`status` <> 'CLOSED'"],
    } as const;
    for (const [table, predicates] of Object.entries(partialPredicates)) {
      const triggerSql = guardRows.find((row) => row.tbl_name === table)?.sql ?? "";
      for (const predicate of predicates) expect(triggerSql).toContain(predicate);
    }
  } finally {
    sqlite.close();
  }
});

it("upgrades a fresh 22-migration predecessor to 23 with identity, schema, FK, and trigger health intact", () => {
  const migrationsPath = join(process.cwd(), "drizzle");
  const snapshot0021 = JSON.parse(readFileSync(join(migrationsPath, "meta", "0021_snapshot.json"), "utf8")) as {
    id: string;
    version: string;
    dialect: string;
    tables: unknown;
    views: unknown;
    enums: unknown;
    _meta: unknown;
    internal: unknown;
  };
  const snapshot0022 = JSON.parse(readFileSync(join(migrationsPath, "meta", "0022_snapshot.json"), "utf8")) as
    typeof snapshot0021 & { prevId: string };
  expect(snapshot0022.prevId).toBe(snapshot0021.id);
  for (const key of ["version", "dialect", "tables", "views", "enums", "_meta", "internal"] as const) {
    expect(snapshot0022[key]).toEqual(snapshot0021[key]);
  }

  const { directory, databasePath } = temporaryDatabase();
  const migrationsThrough0021 = copyMigrationsThrough0021(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsThrough0021 });
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(22);
    expect(sqlite.prepare(`
      SELECT count(*) FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE '%_protected_insert_conflict_guard'
    `).pluck().get()).toBe(46);
    expect(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'visits_closed_insert_guard'",
    ).get()).toBeUndefined();
    const oldMigrationRows = sqlite.prepare(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id",
    ).all();
    const oldStructuralSchema = sqlite.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all();

    migrate(db, { migrationsFolder: migrationsPath });

    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(23);
    expect(sqlite.prepare(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id",
    ).all().slice(0, 22)).toEqual(oldMigrationRows);
    expect(sqlite.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
      ORDER BY type, name
    `).all()).toEqual(oldStructuralSchema);
    expect(sqlite.prepare(`
      SELECT count(*) FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE '%_protected_insert_conflict_guard'
    `).pluck().get()).toBe(46);
    expect(sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'visits_closed_insert_guard'",
    ).get()).toEqual({ name: "visits_closed_insert_guard" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

function seedOpenConsultingVisitForClosedInsertGuard(sqlite: Database.Database): void {
  const now = "2026-08-10T00:00:00.000Z";
  sqlite.exec(`
    INSERT INTO staff_accounts (
      id, clinic_id, username, display_name, role, password_hash, must_change_password,
      active, revision, last_password_changed_at, created_at, updated_at
    ) VALUES (
      'closed-insert-doctor', 'clinic', 'closed-insert-doctor', 'แพทย์ทดสอบ Closed Insert',
      'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}'
    );
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (
      'closed-insert-patient', 'clinic', 'DEMO-000087', 'ผู้ป่วยทดสอบ 000087',
      '0000000087', '1990-01-01', 'unknown', 1, '${now}', '${now}'
    );
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision,
      arrived_at, started_at, closed_at, created_by
    ) VALUES (
      'closed-insert-visit', 'clinic', 'closed-insert-patient', 'CONSULTING',
      'ทดสอบห้าม INSERT เป็น CLOSED', 2, '${now}', '${now}', NULL, 'closed-insert-doctor'
    );
    INSERT INTO intake_observations (
      id, visit_id, weight_kg, recorded_by, recorded_at
    ) VALUES (
      'closed-insert-intake', 'closed-insert-visit', 60, 'closed-insert-doctor', '${now}'
    );
  `);
}

function closedInsertGuardSourceBytes(sqlite: Database.Database): Buffer {
  return Buffer.from(JSON.stringify({
    visit: sqlite.prepare("SELECT * FROM visits WHERE id = 'closed-insert-visit'").get(),
    intake: sqlite.prepare("SELECT * FROM intake_observations WHERE id = 'closed-insert-intake'").get(),
  }));
}

describe.each(["REPLACE", "INSERT OR REPLACE"] as const)(
  "CLOSED Visit insertion under %s with recursive triggers disabled",
  (insertVerb) => {
    it("rejects replacing a real open Visit PK with CLOSED without a Closure", () => {
      const { databasePath } = temporaryDatabase();
      const sqlite = new Database(databasePath);
      try {
        sqlite.pragma("foreign_keys = ON");
        migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
        seedOpenConsultingVisitForClosedInsertGuard(sqlite);
        sqlite.pragma("recursive_triggers = OFF");
        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        const before = closedInsertGuardSourceBytes(sqlite);

        expect(() => sqlite.prepare(`
          ${insertVerb} INTO visits (
            id, clinic_id, patient_id, status, chief_complaint, revision,
            arrived_at, started_at, closed_at, created_by
          ) VALUES (
            'closed-insert-visit', 'clinic', 'closed-insert-patient', 'CLOSED',
            'ห้ามข้าม Closure', 3, '2026-08-10T00:00:00.000Z',
            '2026-08-10T00:00:00.000Z', '2026-08-10T00:05:00.000Z', 'closed-insert-doctor'
          )
        `).run()).toThrow("visits cannot be inserted CLOSED");
        expect(closedInsertGuardSourceBytes(sqlite)).toEqual(before);
        expect(sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        sqlite.close();
      }
    });
  },
);

it("rejects a first nonconflicting Visit INSERT already marked CLOSED", () => {
  const { databasePath } = temporaryDatabase();
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
    seedOpenConsultingVisitForClosedInsertGuard(sqlite);
    sqlite.pragma("recursive_triggers = OFF");
    expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
    const before = closedInsertGuardSourceBytes(sqlite);

    expect(() => sqlite.prepare(`
      INSERT INTO visits (
        id, clinic_id, patient_id, status, chief_complaint, revision,
        arrived_at, started_at, closed_at, created_by
      ) VALUES (
        'first-closed-insert-visit', 'clinic', 'closed-insert-patient', 'CLOSED',
        'ห้ามสร้าง Visit ปิดโดยไม่มี Closure', 1, '2026-08-10T00:00:00.000Z',
        '2026-08-10T00:00:00.000Z', '2026-08-10T00:05:00.000Z', 'closed-insert-doctor'
      )
    `).run()).toThrow("visits cannot be inserted CLOSED");
    expect(closedInsertGuardSourceBytes(sqlite)).toEqual(before);
    expect(sqlite.prepare("SELECT count(*) FROM visit_closures").pluck().get()).toBe(0);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

describe.each(["REPLACE", "INSERT OR REPLACE"] as const)(
  "0019 closed evidence under %s with recursive triggers disabled",
  (insertVerb) => {
    it("rejects replacing a closed signed Note ID onto an open Visit", () => {
      const { databasePath } = temporaryDatabase();
      const sqlite = new Database(databasePath);
      try {
        sqlite.pragma("foreign_keys = ON");
        migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
        seedPopulated0018ClosedReservation(sqlite);
        seedOpenReplacementTargets(sqlite);
        sqlite.pragma("recursive_triggers = OFF");
        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);

        const readClosedNote = () => Buffer.from(JSON.stringify(sqlite.prepare(
          "SELECT * FROM clinical_notes WHERE id = 'closure-upgrade-note'",
        ).get()));
        const before = readClosedNote();
        const replacementSql = `
          ${insertVerb} INTO clinical_notes (
            id, visit_id, version, subjective, objective, assessment, plan,
            source_draft_revision, signed_by, signed_by_display_name, signed_at, content_hash
          ) VALUES (
            'closure-upgrade-note', 'replace-open-visit-reservation', 1,
            'replacement S', 'replacement O', 'replacement A', 'replacement P', 1,
            'closure-upgrade-doctor', 'พญ. อัปเกรด Closure',
            '2026-08-10T00:00:00.000Z', '${"f".repeat(64)}'
          )
        `;

        expect(() => sqlite.prepare(replacementSql).run()).toThrow(/clinical|Note|conflict|evidence/i);
        expect(readClosedNote()).toEqual(before);
        expect(sqlite.prepare(
          "SELECT visit_id FROM clinical_notes WHERE id = 'closure-upgrade-note'",
        ).pluck().get()).toBe("closure-upgrade-visit");
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        sqlite.close();
      }
    });

    it("rejects replacing a closed Visit reservation ID with an open Visit reservation", () => {
      const { directory, databasePath } = temporaryDatabase();
      const migrationsThrough0019 = copyMigrationsThrough0019(directory);
      const sqlite = new Database(databasePath);
      try {
        sqlite.pragma("foreign_keys = ON");
        const db = drizzle(sqlite);
        migrate(db, { migrationsFolder: migrationsThrough0019 });
        seedPopulated0018ClosedReservation(sqlite);
        seedOpenReplacementTargets(sqlite);
        sqlite.pragma("recursive_triggers = OFF");
        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        const readClosedReservation = () => Buffer.from(JSON.stringify(sqlite.prepare(
          "SELECT * FROM inventory_reservations WHERE id = 'closure-upgrade-reservation'",
        ).get()));
        const before = readClosedReservation();
        const replacementSql = `
          ${insertVerb} INTO inventory_reservations (
            id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
            status, created_at, created_by
          ) VALUES (
            'closure-upgrade-reservation', 'clinic', 'replace-open-visit-reservation',
            'replace-open-decision-reservation', 1, 'ACTIVE', '2026-08-10T00:00:00.000Z',
            'closure-upgrade-doctor'
          )
        `;
        const oldMigrationRecords = sqlite.prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id",
        ).all();

        sqlite.exec("SAVEPOINT closed_reservation_id_bypass_probe");
        sqlite.prepare(replacementSql).run();
        expect(sqlite.prepare(
          "SELECT visit_id FROM inventory_reservations WHERE id = 'closure-upgrade-reservation'",
        ).pluck().get()).toBe("replace-open-visit-reservation");
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        sqlite.exec("ROLLBACK TO closed_reservation_id_bypass_probe; RELEASE closed_reservation_id_bypass_probe;");
        expect(readClosedReservation()).toEqual(before);

        migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 20))
          .toEqual(oldMigrationRecords);

        expect(() => sqlite.prepare(replacementSql).run()).toThrow(/reservation|closed|Closure/i);
        expect(readClosedReservation()).toEqual(before);
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        sqlite.close();
      }
    });

    it("rejects replacing a closed Visit allocation ID with an open Visit allocation", () => {
      const { directory, databasePath } = temporaryDatabase();
      const migrationsThrough0019 = copyMigrationsThrough0019(directory);
      const sqlite = new Database(databasePath);
      try {
        sqlite.pragma("foreign_keys = ON");
        const db = drizzle(sqlite);
        migrate(db, { migrationsFolder: migrationsThrough0019 });
        seedPopulated0018ClosedReservation(sqlite);
        seedOpenReplacementTargets(sqlite);
        sqlite.pragma("recursive_triggers = OFF");
        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        const readClosedAllocation = () => Buffer.from(JSON.stringify(sqlite.prepare(
          "SELECT * FROM inventory_reservation_allocations WHERE id = 'closure-upgrade-allocation'",
        ).get()));
        const before = readClosedAllocation();
        const replacementSql = `
          ${insertVerb} INTO inventory_reservation_allocations (
            id, reservation_id, medication_order_item_id, lot_id, position, quantity,
            medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
          ) VALUES (
            'closure-upgrade-allocation', 'replace-open-reservation',
            'replace-open-order-item', 'closure-upgrade-lot', 0, 1, 'DEMO-MED-001',
            'CLOSURE-UPGRADE-LOT', '2027-08-10', 'เม็ด', '2026-08-10T00:00:00.000Z'
          )
        `;
        const oldMigrationRecords = sqlite.prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id",
        ).all();

        sqlite.exec("SAVEPOINT closed_allocation_id_bypass_probe");
        sqlite.prepare(replacementSql).run();
        expect(sqlite.prepare(
          "SELECT reservation_id FROM inventory_reservation_allocations WHERE id = 'closure-upgrade-allocation'",
        ).pluck().get()).toBe("replace-open-reservation");
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        sqlite.exec("ROLLBACK TO closed_allocation_id_bypass_probe; RELEASE closed_allocation_id_bypass_probe;");
        expect(readClosedAllocation()).toEqual(before);

        migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 20))
          .toEqual(oldMigrationRecords);

        expect(() => sqlite.prepare(replacementSql).run()).toThrow(/reservation|allocation|closed|Closure/i);
        expect(readClosedAllocation()).toEqual(before);
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        sqlite.close();
      }
    });
  },
);

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

function seedCompleteProtectedEvidenceAndClosePricingVisit(sqlite: Database.Database): void {
  const now = "2026-08-10T00:00:00.000Z";
  const hash = "9".repeat(64);
  sqlite.exec(`
    INSERT INTO intake_observations (
      id, visit_id, weight_kg, height_cm, temperature_c, systolic_mmhg,
      diastolic_mmhg, heart_rate_bpm, spo2_percent, recorded_by, recorded_at
    ) VALUES (
      'protected-intake', 'pricing-upgrade-visit-order', 60, 165, 37, 120,
      80, 72, 99, 'pricing-upgrade-doctor', '${now}'
    );
    INSERT INTO clinical_note_drafts (
      id, visit_id, revision, subjective, objective, assessment, plan,
      created_by, updated_by, created_at, updated_at
    ) VALUES (
      'protected-note-draft', 'pricing-upgrade-visit-order', 1, 'S', 'O', 'A', 'P',
      'pricing-upgrade-doctor', 'pricing-upgrade-doctor', '${now}', '${now}'
    );
    INSERT INTO clinical_note_draft_diagnoses (id, draft_id, position, diagnosis_text)
    VALUES ('protected-note-draft-diagnosis', 'protected-note-draft', 0, 'วินิจฉัยฉบับร่าง');
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'protected-note', 'pricing-upgrade-visit-order', 1, 'S', 'O', 'A', 'P', 1,
      'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('protected-note-diagnosis', 'protected-note', 0, 'วินิจฉัย');
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'protected-waiver-note', 'pricing-upgrade-visit-no-med', 1, 'S', 'O', 'A', 'P', 1,
      'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('protected-waiver-diagnosis', 'protected-waiver-note', 0, 'วินิจฉัย');
    INSERT INTO clinical_note_amendments (
      id, clinical_note_id, version, content, reason, signed_by,
      signed_by_display_name, signed_at, content_hash
    ) VALUES (
      'protected-note-amendment', 'protected-note', 1, 'ข้อความแก้ไข', 'เหตุผลทดสอบ',
      'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    INSERT INTO medication_decision_drafts (
      id, visit_id, revision, kind, no_medication_reason, created_by, updated_by, created_at, updated_at
    ) VALUES (
      'protected-medication-draft', 'pricing-upgrade-visit-order', 1, 'ORDER', NULL,
      'pricing-upgrade-doctor', 'pricing-upgrade-doctor', '${now}', '${now}'
    );
    INSERT INTO medication_order_draft_items (
      id, decision_draft_id, position, medication_id, medication_revision, quantity, directions_th
    ) VALUES (
      'protected-medication-draft-item', 'protected-medication-draft', 0,
      'DEMO-MED-001', 1, 1, 'รับประทานตามสั่ง'
    );
    INSERT INTO patient_allergy_revisions (
      id, patient_id, revision, state, source_text, reason, reviewed_by, reviewed_at
    ) VALUES (
      'protected-allergy-revision', 'pricing-upgrade-patient-order', 1, 'PRESENT',
      'แพ้ยาทดสอบ', 'บันทึกหลักฐาน', 'pricing-upgrade-doctor', '${now}'
    );
    INSERT INTO patient_allergy_items (
      id, allergy_revision_id, position, substance, reaction, severity, note
    ) VALUES (
      'protected-allergy-item', 'protected-allergy-revision', 0,
      'ยาทดสอบ', 'ผื่น', 'MILD', NULL
    );
    INSERT INTO inventory_adjustments (
      id, clinic_id, lot_id, corrects_movement_id, quantity_delta, reason, occurred_at, actor_id
    ) VALUES (
      'protected-adjustment', 'clinic', 'pricing-upgrade-lot-a',
      'pricing-upgrade-receipt-movement-a', -1, 'แก้ไขยอดทดสอบ', '${now}', 'pricing-upgrade-doctor'
    );
    INSERT INTO inventory_lot_status_events (
      id, clinic_id, lot_id, previous_status, next_status, reason, occurred_at, actor_id
    ) VALUES (
      'protected-lot-status', 'clinic', 'pricing-upgrade-lot-a',
      'AVAILABLE', 'QUARANTINED', 'ทดสอบหลักฐานสถานะ', '${now}', 'pricing-upgrade-doctor'
    );
    INSERT INTO fulfillment_artifact_invalidations (
      id, clinic_id, visit_id, artifact_type, artifact_id, trigger, reason,
      invalidated_at, invalidated_by, replacement_decision_id
    ) VALUES (
      'protected-invalidation', 'clinic', 'pricing-upgrade-visit-order',
      'LABEL', 'pricing-upgrade-label', 'REJECT', 'ทดสอบหลักฐานยกเลิก',
      '${now}', 'pricing-upgrade-doctor', NULL
    );
    INSERT INTO fulfillment_rejections (
      id, clinic_id, visit_id, preparation_id, reservation_id, label_version_id,
      print_sequence_at_rejection, reason, rejected_at, rejected_by
    ) VALUES (
      'protected-rejection', 'clinic', 'pricing-upgrade-visit-order',
      'pricing-upgrade-preparation', 'pricing-upgrade-reservation', 'pricing-upgrade-label',
      1, 'ทดสอบหลักฐานปฏิเสธ', '${now}', 'pricing-upgrade-doctor'
    );
    INSERT INTO finance_charges (
      id, clinic_id, visit_id, source_kind, medication_decision_id,
      medication_decision_version, fulfillment_dispense_id, clinic_pricing_revision,
      consultation_fee_baht_snapshot, currency, line_count, finalized_by,
      finalized_by_display_name, finalized_at, content_hash
    ) VALUES
      ('protected-order-charge', 'clinic', 'pricing-upgrade-visit-order', 'ORDER',
       'pricing-upgrade-decision-order', 1, 'pricing-upgrade-dispense', 1,
       100, 'THB', 3, 'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'),
      ('protected-waiver-charge', 'clinic', 'pricing-upgrade-visit-no-med', 'NO_MEDICATION',
       'pricing-upgrade-decision-no-med', 1, NULL, 1,
       100, 'THB', 1, 'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}');
    INSERT INTO finance_charge_lines (
      id, charge_id, position, line_type, description_snapshot, quantity,
      unit_price_baht, line_total_baht, medication_order_item_id, fulfillment_dispense_line_id
    ) VALUES
      ('protected-order-consultation-line', 'protected-order-charge', 0, 'CONSULTATION',
       'ค่าตรวจ', 1, 100, 100, NULL, NULL),
      ('protected-order-medication-line-a', 'protected-order-charge', 1, 'MEDICATION',
       '[DEMO] ยาทดสอบชนิด A', 2, 5, 10, 'pricing-upgrade-order-item', 'pricing-upgrade-dispense-line-a'),
      ('protected-order-medication-line-b', 'protected-order-charge', 2, 'MEDICATION',
       '[DEMO] ยาทดสอบชนิด A', 3, 5, 15, 'pricing-upgrade-order-item', 'pricing-upgrade-dispense-line-b'),
      ('protected-waiver-consultation-line', 'protected-waiver-charge', 0, 'CONSULTATION',
       'ค่าตรวจ', 1, 100, 100, NULL, NULL);
    INSERT INTO finance_charge_adjustments (
      id, charge_id, kind, amount_baht, reason, approved_by,
      approved_by_display_name, approved_at, content_hash
    ) VALUES (
      'protected-waiver', 'protected-waiver-charge', 'FULL_WAIVER', -100,
      'ยกเว้นค่าบริการทดสอบ', 'pricing-upgrade-doctor',
      'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    UPDATE visits SET status = 'AWAITING_PAYMENT', revision = 8
    WHERE id = 'pricing-upgrade-visit-order';
    INSERT INTO finance_payments (
      id, charge_id, visit_id, method, amount_baht, manual_reference,
      confirmed_by, confirmed_by_display_name, confirmed_at, content_hash
    ) VALUES (
      'protected-payment', 'protected-order-charge', 'pricing-upgrade-visit-order',
      'CASH', 125, NULL, 'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    UPDATE visits SET status = 'READY_TO_CLOSE', revision = 9
    WHERE id = 'pricing-upgrade-visit-order';
    INSERT INTO visit_closures (
      id, clinic_id, visit_id, visit_revision, charge_id, payment_id, waiver_adjustment_id,
      clinic_name_snapshot, patient_id_snapshot, patient_hn_snapshot,
      patient_display_name_snapshot, patient_birth_date_snapshot, patient_sex_snapshot,
      doctor_id_snapshot, doctor_display_name_snapshot, closed_at, content_hash
    ) VALUES (
      'protected-closure', 'clinic', 'pricing-upgrade-visit-order', 9,
      'protected-order-charge', 'protected-payment', NULL,
      'คลินิกชนบท CareFlow Pilot', 'pricing-upgrade-patient-order', 'DEMO-000090',
      'ผู้ป่วยทดสอบ 000090', '1990-01-01', 'unknown',
      'pricing-upgrade-doctor', 'แพทย์อัปเกรดราคา', '${now}', '${hash}'
    );
    UPDATE visits SET status = 'CLOSED', revision = 10, closed_at = '${now}'
    WHERE id = 'pricing-upgrade-visit-order';
    INSERT INTO audit_events (
      id, clinic_id, actor_id, actor_role, action, entity_type, entity_id,
      entity_revision, reason, occurred_at, metadata_json
    ) VALUES (
      'protected-audit', 'clinic', 'pricing-upgrade-doctor', 'doctor',
      'visit.closed', 'visit', 'pricing-upgrade-visit-order', 10,
      NULL, '${now}', '{}'
    );
    INSERT INTO idempotency_records (
      clinic_id, actor_id, key, request_hash, response_status, response_json, created_at
    ) VALUES (
      'clinic', 'pricing-upgrade-doctor', 'protected-idempotency', '${hash}', 200, '{}', '${now}'
    );
  `);
}

const closedMutableRowPredicates: Record<string, string> = {
  visits: "id = 'pricing-upgrade-visit-order'",
  intake_observations: "id = 'protected-intake'",
  clinical_note_drafts: "id = 'protected-note-draft'",
  clinical_note_draft_diagnoses: "id = 'protected-note-draft-diagnosis'",
  medication_decision_drafts: "id = 'protected-medication-draft'",
  medication_order_draft_items: "id = 'protected-medication-draft-item'",
  inventory_reservations: "id = 'pricing-upgrade-reservation'",
  fulfillment_preparations: "id = 'pricing-upgrade-preparation'",
};

function selectedProtectedRow(sqlite: Database.Database, table: string, uniqueKeyName?: string): Record<string, unknown> {
  const specialPredicate = table === "__drizzle_migrations"
    ? "id = 999"
    : table === "finance_charge_lines" && uniqueKeyName === "finance_charge_lines_dispense_line_unique"
    ? "id = 'protected-order-medication-line-a'"
    : table === "finance_charge_lines" && uniqueKeyName === "finance_charge_lines_one_consultation_per_charge"
      ? "id = 'protected-order-consultation-line'"
      : table === "medications"
        ? "id = 'DEMO-MED-001'"
        : closedMutableRowPredicates[table];
  const row = sqlite.prepare(`SELECT * FROM \`${table}\`${specialPredicate ? ` WHERE ${specialPredicate}` : ""} LIMIT 1`).get();
  if (!row) throw new Error(`Protected conflict fixture has no row in ${table}`);
  return row as Record<string, unknown>;
}

describe.each(["REPLACE", "INSERT OR REPLACE"] as const)(
  "0021 protected conflict matrix under %s with recursive triggers disabled",
  (insertVerb) => {
    it("rejects every protected same-PK and applicable secondary-UNIQUE replacement without changing evidence", () => {
      const { directory, databasePath } = temporaryDatabase();
      const migrationsThrough0015 = copyMigrationsThrough0015(directory);
      const migrationsThrough0020 = copyMigrationsThrough0020(directory);
      const migrationsThrough0021 = copyMigrationsThrough0021(directory);
      const sqlite = new Database(databasePath);
      try {
        sqlite.pragma("foreign_keys = ON");
        const db = drizzle(sqlite);
        migrate(db, { migrationsFolder: migrationsThrough0015 });
        seedPopulated0015PricingEvidence(sqlite);
        migrate(db, { migrationsFolder: migrationsThrough0020 });
        seedCompleteProtectedEvidenceAndClosePricingVisit(sqlite);
        migrate(db, { migrationsFolder: migrationsThrough0021 });
        const oldMigrationRows = sqlite.prepare(
          "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id",
        ).all();
        migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
        sqlite.pragma("recursive_triggers = OFF");
        expect(sqlite.pragma("recursive_triggers", { simple: true })).toBe(0);
        expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(23);
        expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 22))
          .toEqual(oldMigrationRows);
        sqlite.prepare(
          "INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (999, 'protected-explicit-migration-id', 9999999999999)",
        ).run();

        const inventory = protectedConflictInventory(sqlite);
        for (const table of inventory.tables) {
          const row = selectedProtectedRow(sqlite, table);
          const columns = sqlite.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").pluck().all(table) as string[];
          const before = Buffer.from(JSON.stringify(row));
          const placeholders = columns.map(() => "?").join(", ");
          const statement = sqlite.prepare(
            `${insertVerb} INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
          );
          expect(
            () => statement.run(...columns.map((column) => row[column])),
            `${table} same-PK replacement`,
          ).toThrow(table === "visits"
            ? /visits (?:cannot be inserted CLOSED|insert conflicts with protected evidence)/
            : `${table} insert conflicts with protected evidence`);
          expect(
            Buffer.from(JSON.stringify(selectedProtectedRow(sqlite, table))),
            `${table} same-PK byte stability`,
          ).toEqual(before);
        }

        const secondaryKeys = inventory.keys.filter((key) => !key.name.endsWith("primary key"));
        expect(secondaryKeys).toHaveLength(44);
        for (const key of secondaryKeys) {
          // These two partial indexes contain only open operational rows by definition;
          // their valid open-Visit behavior is covered separately below.
          if (key.name === "visits_clinic_patient_active_unique"
            || key.name === "inventory_reservations_active_visit_decision_unique") continue;
          const row = selectedProtectedRow(sqlite, key.table, key.name);
          const columns = sqlite.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").pluck().all(key.table) as string[];
          const primaryColumns = sqlite.prepare(
            "SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk",
          ).pluck().all(key.table) as string[];
          expect(primaryColumns).toEqual(["id"]);
          const replacement: Record<string, unknown> = {
            ...row,
            id: `${String(row.id)}-unique-conflict-${key.name}`,
          };
          const beforeTable = Buffer.from(JSON.stringify(sqlite.prepare(`SELECT * FROM \`${key.table}\` ORDER BY rowid`).all()));
          const statement = sqlite.prepare(
            `${insertVerb} INTO \`${key.table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          );
          expect(
            () => statement.run(...columns.map((column) => replacement[column])),
            `${key.table}: ${key.name}`,
          ).toThrow(`${key.table} insert conflicts with protected evidence`);
          expect(
            Buffer.from(JSON.stringify(sqlite.prepare(`SELECT * FROM \`${key.table}\` ORDER BY rowid`).all())),
            `${key.table}: ${key.name} byte stability`,
          ).toEqual(beforeTable);
        }

        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(sqlite.prepare(
          "SELECT id, status, revision, closed_at FROM visits WHERE id = 'pricing-upgrade-visit-order'",
        ).get()).toEqual({
          id: "pricing-upgrade-visit-order",
          status: "CLOSED",
          revision: 10,
          closed_at: "2026-08-10T00:00:00.000Z",
        });
        expect(sqlite.prepare(
          "SELECT id, visit_id, charge_id, payment_id FROM visit_closures WHERE id = 'protected-closure'",
        ).get()).toEqual({
          id: "protected-closure",
          visit_id: "pricing-upgrade-visit-order",
          charge_id: "protected-order-charge",
          payment_id: "protected-payment",
        });
      } finally {
        sqlite.close();
      }
    });
  },
);

describe.each(["REPLACE", "INSERT OR REPLACE"] as const)(
  "0021 valid open-Visit writes under %s with recursive triggers disabled",
  (insertVerb) => {
    it("allows open-only partial and same-PK Visit replacement plus all eight mutable classes before Closure", () => {
      const { databasePath } = temporaryDatabase();
      const sqlite = new Database(databasePath);
      const now = "2026-08-10T00:00:00.000Z";
      try {
        sqlite.pragma("foreign_keys = ON");
        migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
        sqlite.pragma("recursive_triggers = OFF");
        sqlite.exec(`
          INSERT INTO staff_accounts (
            id, clinic_id, username, display_name, role, password_hash, must_change_password,
            active, revision, last_password_changed_at, created_at, updated_at
          ) VALUES (
            'open-guard-doctor', 'clinic', 'open-guard-doctor', 'แพทย์ทดสอบ Guard',
            'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}'
          );
          INSERT INTO patients (
            id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
          ) VALUES (
            'open-guard-patient', 'clinic', 'DEMO-000089', 'ผู้ป่วยทดสอบ 000089',
            '0000000089', '1990-01-01', 'unknown', 1, '${now}', '${now}'
          );
          INSERT INTO visits (
            id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
          ) VALUES (
            'open-guard-visit-original', 'clinic', 'open-guard-patient', 'AWAITING_PREPARATION',
            'ทดสอบ Guard ก่อนปิด', 1, '${now}', '${now}', 'open-guard-doctor'
          );
        `);
        sqlite.prepare(`
          ${insertVerb} INTO visits (
            id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, created_by
          ) VALUES (
            'open-guard-visit', 'clinic', 'open-guard-patient', 'AWAITING_PREPARATION',
            'ทดสอบ Guard ก่อนปิด', 1, '${now}', '${now}', 'open-guard-doctor'
          )
        `).run();
        expect(sqlite.prepare("SELECT id FROM visits WHERE patient_id = 'open-guard-patient'").pluck().get())
          .toBe("open-guard-visit");
        sqlite.prepare(`
          ${insertVerb} INTO visits (
            id, clinic_id, patient_id, status, chief_complaint, revision,
            arrived_at, started_at, closed_at, created_by
          ) VALUES (
            'open-guard-visit', 'clinic', 'open-guard-patient', 'AWAITING_PREPARATION',
            'ทดสอบ Guard ก่อนปิด รุ่นที่สอง', 2, '${now}', '${now}', NULL, 'open-guard-doctor'
          )
        `).run();
        expect(sqlite.prepare(
          "SELECT status, chief_complaint, revision, closed_at FROM visits WHERE id = 'open-guard-visit'",
        ).get()).toEqual({
          status: "AWAITING_PREPARATION",
          chief_complaint: "ทดสอบ Guard ก่อนปิด รุ่นที่สอง",
          revision: 2,
          closed_at: null,
        });

        sqlite.exec(`
          INSERT INTO intake_observations (
            id, visit_id, weight_kg, recorded_by, recorded_at
          ) VALUES ('open-guard-intake', 'open-guard-visit', 60, 'open-guard-doctor', '${now}');
          INSERT INTO clinical_note_drafts (
            id, visit_id, revision, subjective, objective, assessment, plan,
            created_by, updated_by, created_at, updated_at
          ) VALUES (
            'open-guard-note-draft', 'open-guard-visit', 1, 'S', 'O', 'A', 'P',
            'open-guard-doctor', 'open-guard-doctor', '${now}', '${now}'
          );
          INSERT INTO clinical_note_draft_diagnoses (id, draft_id, position, diagnosis_text)
          VALUES ('open-guard-note-diagnosis', 'open-guard-note-draft', 0, 'วินิจฉัย');
          INSERT INTO medication_decision_drafts (
            id, visit_id, revision, kind, no_medication_reason, created_by, updated_by, created_at, updated_at
          ) VALUES (
            'open-guard-medication-draft', 'open-guard-visit', 1, 'ORDER', NULL,
            'open-guard-doctor', 'open-guard-doctor', '${now}', '${now}'
          );
          INSERT INTO medication_order_draft_items (
            id, decision_draft_id, position, medication_id, medication_revision, quantity, directions_th
          ) VALUES (
            'open-guard-medication-item', 'open-guard-medication-draft', 0,
            'DEMO-MED-001', 1, 1, 'รับประทานตามสั่ง'
          );
          INSERT INTO medication_decisions (
            id, visit_id, version, kind, signed_by, signed_by_display_name, signed_at, content_hash
          ) VALUES (
            'open-guard-decision', 'open-guard-visit', 1, 'ORDER',
            'open-guard-doctor', 'แพทย์ทดสอบ Guard', '${now}', '${"8".repeat(64)}'
          );
          INSERT INTO medication_order_items (
            id, medication_decision_id, position, medication_id, medication_revision,
            display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot,
            quantity, directions_th
          ) VALUES (
            'open-guard-order-item', 'open-guard-decision', 0, 'DEMO-MED-001', 1,
            '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1,
            'รับประทานตามสั่ง'
          );
          INSERT INTO inventory_lots (
            id, clinic_id, medication_id, medication_revision, display_name_snapshot,
            strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
            supplier_name, status, created_at, created_by
          ) VALUES (
            'open-guard-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
            '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'OPEN-GUARD-LOT', '2027-08-10',
            'ผู้ขายทดสอบ', 'AVAILABLE', '${now}', 'open-guard-doctor'
          );
          INSERT INTO inventory_reservations (
            id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
            status, created_at, created_by
          ) VALUES (
            'open-guard-reservation-original', 'clinic', 'open-guard-visit',
            'open-guard-decision', 1, 'ACTIVE', '${now}', 'open-guard-doctor'
          );
        `);
        sqlite.prepare(`
          ${insertVerb} INTO inventory_reservations (
            id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
            status, created_at, created_by
          ) VALUES (
            'open-guard-reservation', 'clinic', 'open-guard-visit',
            'open-guard-decision', 1, 'ACTIVE', '${now}', 'open-guard-doctor'
          )
        `).run();
        expect(sqlite.prepare("SELECT id FROM inventory_reservations WHERE visit_id = 'open-guard-visit'").pluck().get())
          .toBe("open-guard-reservation");

        sqlite.exec(`
          INSERT INTO fulfillment_label_versions (
            id, clinic_id, visit_id, medication_decision_id, medication_decision_version,
            version, created_at, created_by, patient_hn_snapshot,
            patient_display_name_snapshot, clinic_name_snapshot
          ) VALUES (
            'open-guard-label', 'clinic', 'open-guard-visit', 'open-guard-decision', 1,
            1, '${now}', 'open-guard-doctor', 'DEMO-000089', 'ผู้ป่วยทดสอบ 000089',
            'คลินิกชนบท CareFlow Pilot'
          );
          INSERT INTO fulfillment_label_items (
            id, label_version_id, medication_order_item_id, position, medication_id,
            medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot,
            quantity, unit_snapshot, directions_th_snapshot, internal_barcode_snapshot
          ) VALUES (
            'open-guard-label-item', 'open-guard-label', 'open-guard-order-item', 0,
            'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
            'เม็ดทดสอบ', 1, 'เม็ด', 'รับประทานตามสั่ง', 'CF-DEMO-001'
          );
          INSERT INTO fulfillment_label_print_events (
            id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot
          ) VALUES (
            'open-guard-print', 'open-guard-label', 1, '${now}',
            'open-guard-doctor', 'test', '80x100mm'
          );
          INSERT INTO fulfillment_preparations (
            id, clinic_id, visit_id, reservation_id, medication_decision_id,
            medication_decision_version, label_version_id, revision, status,
            minimum_print_sequence, created_at, created_by
          ) VALUES (
            'open-guard-preparation', 'clinic', 'open-guard-visit', 'open-guard-reservation',
            'open-guard-decision', 1, 'open-guard-label', 1, 'ACTIVE', 1,
            '${now}', 'open-guard-doctor'
          );
        `);

        for (const table of [
          "intake_observations",
          "clinical_note_draft_diagnoses",
          "medication_order_draft_items",
          "fulfillment_preparations",
        ]) {
          const openIds: Record<string, string> = {
            visits: "open-guard-visit",
            intake_observations: "open-guard-intake",
            clinical_note_drafts: "open-guard-note-draft",
            clinical_note_draft_diagnoses: "open-guard-note-diagnosis",
            medication_decision_drafts: "open-guard-medication-draft",
            medication_order_draft_items: "open-guard-medication-item",
            inventory_reservations: "open-guard-reservation",
            fulfillment_preparations: "open-guard-preparation",
          };
          const row = sqlite.prepare(`SELECT * FROM \`${table}\` WHERE id = ?`).get(openIds[table]) as Record<string, unknown>;
          const columns = sqlite.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").pluck().all(table) as string[];
          sqlite.prepare(
            `${insertVerb} INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          ).run(...columns.map((column) => row[column]));
        }

        sqlite.exec(`
          UPDATE intake_observations SET weight_kg = 61 WHERE id = 'open-guard-intake';
          UPDATE clinical_note_drafts SET revision = 2, updated_at = '${now}' WHERE id = 'open-guard-note-draft';
          UPDATE clinical_note_draft_diagnoses SET diagnosis_text = 'วินิจฉัยใหม่' WHERE id = 'open-guard-note-diagnosis';
          UPDATE medication_decision_drafts SET revision = 2, updated_at = '${now}' WHERE id = 'open-guard-medication-draft';
          UPDATE medication_order_draft_items SET quantity = 2 WHERE id = 'open-guard-medication-item';
          UPDATE inventory_reservations SET
            status = 'RELEASED', released_at = '${now}', released_by = 'open-guard-doctor',
            release_reason = 'ทดสอบการแก้ไขก่อนปิด'
          WHERE id = 'open-guard-reservation';
        `);
        expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        expect(sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = 'open-guard-visit'").pluck().get()).toBe(0);
      } finally {
        sqlite.close();
      }
    });
  },
);

it("preserves operational session/counter writes and revision-via-UPDATE master lifecycles", () => {
  const { databasePath } = temporaryDatabase();
  const sqlite = new Database(databasePath);
  const now = "2026-08-10T00:00:00.000Z";
  try {
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: join(process.cwd(), "drizzle") });
    expect(sqlite.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'sessions_protected_insert_conflict_guard',
        'clinic_counters_protected_insert_conflict_guard'
      )
    `).all()).toEqual([]);
    sqlite.exec(`
      INSERT INTO staff_accounts (
        id, clinic_id, username, display_name, role, password_hash, must_change_password,
        active, revision, last_password_changed_at, created_at, updated_at
      ) VALUES (
        'valid-write-doctor', 'clinic', 'valid-write-doctor', 'แพทย์ Valid Write',
        'doctor', 'hash', 0, 1, 1, '${now}', '${now}', '${now}'
      );
      INSERT INTO patients (
        id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
      ) VALUES (
        'valid-write-patient', 'clinic', 'DEMO-000088', 'ผู้ป่วยทดสอบ 000088',
        '0000000088', '1990-01-01', 'unknown', 1, '${now}', '${now}'
      );
      INSERT INTO inventory_lots (
        id, clinic_id, medication_id, medication_revision, display_name_snapshot,
        strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
        supplier_name, status, created_at, created_by
      ) VALUES (
        'valid-write-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A',
        '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'VALID-WRITE-LOT', '2027-08-10',
        'ผู้ขายทดสอบ', 'AVAILABLE', '${now}', 'valid-write-doctor'
      );
      INSERT INTO medications (
        id, display_name, strength_text, dosage_form_text, canonical_unit,
        internal_barcode, active, revision, unit_price_baht, created_at, updated_at
      ) VALUES (
        'DEMO-MED-005', '[DEMO] ยาทดสอบชนิด E', '100 หน่วยทดสอบ',
        'เม็ดทดสอบ', 'เม็ด', 'CF-DEMO-005', 1, 1, 20, '${now}', '${now}'
      );
      INSERT INTO sessions (token_hash, staff_id, created_at, last_seen_at, expires_at)
      VALUES ('valid-write-session', 'valid-write-doctor', '${now}', '${now}', '2026-08-11T00:00:00.000Z');
      UPDATE sessions SET last_seen_at = '2026-08-10T00:01:00.000Z'
      WHERE token_hash = 'valid-write-session';
      UPDATE clinic_counters SET value = value + 1 WHERE key = 'synthetic_patient';
      INSERT INTO platform_metadata (key, value) VALUES ('valid_write_probe', 'created');
      UPDATE platform_metadata SET value = 'updated' WHERE key = 'valid_write_probe';
      INSERT INTO idempotency_records (
        clinic_id, actor_id, key, request_hash, response_status, response_json, created_at
      ) VALUES (
        'clinic', 'valid-write-doctor', 'valid-write-idempotency', '${"7".repeat(64)}', 201, '{}', '${now}'
      );
      UPDATE idempotency_records SET response_json = '{"safe":true}'
      WHERE actor_id = 'valid-write-doctor' AND key = 'valid-write-idempotency';
      UPDATE clinic_config SET
        consultation_fee_baht = 101, pricing_revision = 2, updated_at = '${now}'
      WHERE id = 'clinic';
      UPDATE medications SET
        unit_price_baht = 6, revision = 2, updated_at = '${now}'
      WHERE id = 'DEMO-MED-001';
      UPDATE patients SET revision = 2, updated_at = '${now}'
      WHERE id = 'valid-write-patient';
      UPDATE staff_accounts SET display_name = 'แพทย์ Valid Write 2', revision = 2, updated_at = '${now}'
      WHERE id = 'valid-write-doctor';
      UPDATE inventory_lots SET revision = 2 WHERE id = 'valid-write-lot';
    `);
    expect(sqlite.prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'").pluck().get()).toBe(1);
    expect(sqlite.prepare("SELECT last_seen_at FROM sessions WHERE token_hash = 'valid-write-session'").pluck().get())
      .toBe("2026-08-10T00:01:00.000Z");
    expect(sqlite.prepare("SELECT consultation_fee_baht, pricing_revision FROM clinic_config WHERE id = 'clinic'").get())
      .toEqual({ consultation_fee_baht: 101, pricing_revision: 2 });
    expect(sqlite.prepare("SELECT unit_price_baht, revision FROM medications WHERE id = 'DEMO-MED-001'").get())
      .toEqual({ unit_price_baht: 6, revision: 2 });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

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
    expect(() => sqlite.prepare("INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id) VALUES ('duplicate-movement', 'clinic', 'upgrade-lot', 'RECEIPT', 5, 'RECEIPT', 'upgrade-receipt', 'duplicate', '2026-08-09T00:00:00.000Z', 'upgrade-doctor')").run()).toThrow(/unique|protected evidence/i);
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
  expect(journal.entries).toHaveLength(23);
  expect(journal.entries[14]).toMatchObject({ idx: 14, tag: "0014_inventory_integrity" });
  expect(journal.entries[15]).toMatchObject({ idx: 15, tag: "0015_inventory_adjustment_source_guard" });
  expect(journal.entries[16]).toMatchObject({ idx: 16, tag: "0016_finance_pricing_snapshots" });
  expect(journal.entries[17]).toMatchObject({ idx: 17, tag: "0017_charge_collection_ledger" });
  expect(journal.entries[18]).toMatchObject({ idx: 18, tag: "0018_visit_closure_integrity" });
  expect(journal.entries[19]).toMatchObject({ idx: 19, tag: "0019_post_close_reservation_guards" });
  expect(journal.entries[20]).toMatchObject({ idx: 20, tag: "0020_post_close_replace_guards" });
  expect(journal.entries[21]).toMatchObject({ idx: 21, tag: "0021_protected_insert_conflict_guards" });
  expect(journal.entries[22]).toMatchObject({ idx: 22, tag: "0022_closed_visit_insert_guard" });

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
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(23);
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

it("keeps every 0000–0022 SQL and snapshot identity immutable while upgrading populated evidence", () => {
  for (const [file, expectedHash] of Object.entries(immutableMigrationHashesThrough0022)) {
    expect(createHash("sha256").update(readFileSync(join(process.cwd(), "drizzle", file))).digest("hex")).toBe(expectedHash);
  }
  for (const [file, expectedHash] of Object.entries(immutableMigrationSnapshotHashesThrough0022)) {
    expect(createHash("sha256").update(readFileSync(join(process.cwd(), "drizzle", "meta", file))).digest("hex")).toBe(expectedHash);
  }
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
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
    { idx: 16, tag: "0016_finance_pricing_snapshots" },
    { idx: 17, tag: "0017_charge_collection_ledger" },
    { idx: 18, tag: "0018_visit_closure_integrity" },
    { idx: 19, tag: "0019_post_close_reservation_guards" },
    { idx: 20, tag: "0020_post_close_replace_guards" },
    { idx: 21, tag: "0021_protected_insert_conflict_guards" },
    { idx: 22, tag: "0022_closed_visit_insert_guard" },
  ]);

  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0015(directory);
  const migrationsThrough0021 = copyMigrationsThrough0021(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0015PricingEvidence(sqlite);
    migrate(db, { migrationsFolder: migrationsThrough0021 });
    const oldMigrationRecords = sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all();
    expect(oldMigrationRecords).toHaveLength(22);
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
    expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 22))
      .toEqual(oldMigrationRecords);
    const migrationCount = sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get();
    expect(migrationCount).toBe(23);
    if (migrationCount !== 23) return;
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

it("retains the additive 0018 immutable Visit Closure artifacts in current history", () => {
  const migrationsPath = join(process.cwd(), "drizzle");
  expect(existsSync(join(migrationsPath, "0018_visit_closure_integrity.sql"))).toBe(true);
  expect(existsSync(join(migrationsPath, "meta", "0018_snapshot.json"))).toBe(true);
  const journal = JSON.parse(readFileSync(join(migrationsPath, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  expect(journal.entries).toHaveLength(23);
  expect(journal.entries[16]).toMatchObject({ idx: 16, tag: "0016_finance_pricing_snapshots" });
  expect(journal.entries[17]).toMatchObject({ idx: 17, tag: "0017_charge_collection_ledger" });
  expect(journal.entries[18]).toMatchObject({ idx: 18, tag: "0018_visit_closure_integrity" });
  expect(journal.entries[19]).toMatchObject({ idx: 19, tag: "0019_post_close_reservation_guards" });
  expect(journal.entries[20]).toMatchObject({ idx: 20, tag: "0020_post_close_replace_guards" });
  expect(journal.entries[21]).toMatchObject({ idx: 21, tag: "0021_protected_insert_conflict_guards" });
  expect(journal.entries[22]).toMatchObject({ idx: 22, tag: "0022_closed_visit_insert_guard" });

  const { databasePath } = temporaryDatabase();
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder: migrationsPath });
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(23);
    expect(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'visit_closures'").pluck().get())
      .toContain("visit_closures_resolution_shape_check");
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'visit_closures_visit_id_unique'").get())
      .toEqual({ name: "visit_closures_visit_id_unique" });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'visit_closures_block_update'").get())
      .toEqual({ name: "visit_closures_block_update" });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'visits_closed_transition_guard'").get())
      .toEqual({ name: "visits_closed_transition_guard" });
  } finally {
    sqlite.close();
  }
});

it("keeps 0018–0021 immutable while upgrading populated Closure evidence through additive 0022", () => {
  const migrationsPath = join(process.cwd(), "drizzle");
  expect(createHash("sha256").update(readFileSync(join(migrationsPath, "0018_visit_closure_integrity.sql"))).digest("hex"))
    .toBe("68059f8e06e2051415c632c68efdc3b77aa1ec58beda227d73d32387f8c0ee0a");
  expect(createHash("sha256").update(readFileSync(join(migrationsPath, "meta", "0018_snapshot.json"))).digest("hex"))
    .toBe("dc4d4dcb7b4f0c8c69880961aaa970d3e6080670c3581a0d960018a0a0612003");
  expect(createHash("sha256").update(readFileSync(join(migrationsPath, "0019_post_close_reservation_guards.sql"))).digest("hex"))
    .toBe("31c6be4917adbe0d0758ff615ecdbde680649137ae9da5031b9f16c330d0f5e1");
  expect(createHash("sha256").update(readFileSync(join(migrationsPath, "meta", "0019_snapshot.json"))).digest("hex"))
    .toBe("35e76769c409004c834576039582ddebc134b688c5848a13fd44a9d5b245e19b");
  expect(existsSync(join(migrationsPath, "0019_post_close_reservation_guards.sql"))).toBe(true);
  expect(existsSync(join(migrationsPath, "meta", "0019_snapshot.json"))).toBe(true);
  expect(existsSync(join(migrationsPath, "0020_post_close_replace_guards.sql"))).toBe(true);
  expect(existsSync(join(migrationsPath, "meta", "0020_snapshot.json"))).toBe(true);
  const snapshot0019 = JSON.parse(readFileSync(join(migrationsPath, "meta", "0019_snapshot.json"), "utf8")) as {
    id: string;
    version: string;
    dialect: string;
    tables: unknown;
    views: unknown;
    enums: unknown;
    _meta: unknown;
    internal: unknown;
  };
  const snapshot0020 = JSON.parse(readFileSync(join(migrationsPath, "meta", "0020_snapshot.json"), "utf8")) as
    typeof snapshot0019 & { prevId: string };
  expect(snapshot0020.prevId).toBe(snapshot0019.id);
  for (const key of ["version", "dialect", "tables", "views", "enums", "_meta", "internal"] as const) {
    expect(snapshot0020[key]).toEqual(snapshot0019[key]);
  }
  const migration0020 = readFileSync(join(migrationsPath, "0020_post_close_replace_guards.sql"), "utf8");
  expect(migration0020).toContain("inventory_reservations_closed_id_conflict_guard");
  expect(migration0020).toContain("existing_reservation.id = NEW.id");
  expect(migration0020).toContain("inventory_reservation_allocations_closed_id_conflict_guard");
  expect(migration0020).toContain("existing_allocation.id = NEW.id");

  const { directory, databasePath } = temporaryDatabase();
  const oldMigrations = copyMigrationsThrough0018(directory);
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: oldMigrations });
    seedPopulated0018ClosedReservation(sqlite);
    const oldMigrationRecords = sqlite.prepare(
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id",
    ).all();
    const before = {
      visit: sqlite.prepare("SELECT * FROM visits WHERE id = 'closure-upgrade-visit'").get(),
      closure: sqlite.prepare("SELECT * FROM visit_closures WHERE id = 'closure-upgrade-closure'").get(),
      reservation: sqlite.prepare("SELECT * FROM inventory_reservations WHERE id = 'closure-upgrade-reservation'").get(),
      allocation: sqlite.prepare(
        "SELECT * FROM inventory_reservation_allocations WHERE id = 'closure-upgrade-allocation'",
      ).get(),
    };

    migrate(db, { migrationsFolder: migrationsPath });

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(23);
    expect(sqlite.prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id").all().slice(0, 19))
      .toEqual(oldMigrationRecords);
    expect(sqlite.prepare("SELECT * FROM visits WHERE id = 'closure-upgrade-visit'").get()).toEqual(before.visit);
    expect(sqlite.prepare("SELECT * FROM visit_closures WHERE id = 'closure-upgrade-closure'").get()).toEqual(before.closure);
    expect(sqlite.prepare("SELECT * FROM inventory_reservations WHERE id = 'closure-upgrade-reservation'").get())
      .toEqual(before.reservation);
    expect(sqlite.prepare(
      "SELECT * FROM inventory_reservation_allocations WHERE id = 'closure-upgrade-allocation'",
    ).get()).toEqual(before.allocation);
    expect(sqlite.prepare(`
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
