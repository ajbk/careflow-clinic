import { chmodSync, existsSync, lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { assertKnownPilotDatabase, migrationFolder } from "../db/client.js";
import * as schema from "../db/schema.js";
import {
  MAINTENANCE_LOCK_SUFFIX,
  maintenanceLockPath,
  resolveDatabaseTarget,
} from "../host-lock.js";

export const RESET_CONFIRMATION = "RESET-SYNTHETIC-PILOT";
export { MAINTENANCE_LOCK_SUFFIX };

// These prefixes are the complete synthetic clinical trail. Account and
// maintenance audit records are deliberately outside this predicate and are
// preserved across a reset.
const syntheticAuditPredicate = [
  "action LIKE 'patient.%'",
  "action LIKE 'visit.%'",
  "action LIKE 'allergy.%'",
  "action LIKE 'note.%'",
  "action LIKE 'medication.%'",
  "action LIKE 'inventory.%'",
  "action LIKE 'label.%'",
  "action LIKE 'preparation.%'",
  "action LIKE 'fulfillment.%'",
  "action LIKE 'dispense.%'",
  "action LIKE 'charge.%'",
  "action LIKE 'payment.%'",
].join(" OR ");

const expectedTables = new Set([
  "__drizzle_migrations",
  "audit_events",
  "clinical_note_amendments",
  "clinical_note_diagnoses",
  "clinical_note_draft_diagnoses",
  "clinical_note_drafts",
  "clinical_notes",
  "clinic_config",
  "clinic_counters",
  "finance_charge_adjustments",
  "finance_charge_lines",
  "finance_charges",
  "finance_payments",
  "fulfillment_artifact_invalidations",
  "fulfillment_dispense_price_snapshots",
  "fulfillment_dispense_lines",
  "fulfillment_dispenses",
  "fulfillment_label_items",
  "fulfillment_label_print_events",
  "fulfillment_label_versions",
  "fulfillment_preparation_confirmations",
  "fulfillment_preparations",
  "fulfillment_rejections",
  "fulfillment_releases",
  "idempotency_records",
  "intake_observations",
  "inventory_lots",
  "inventory_adjustments",
  "inventory_lot_status_events",
  "inventory_receipt_lines",
  "inventory_receipts",
  "inventory_reservation_allocations",
  "inventory_reservations",
  "inventory_stock_movements",
  "medication_decision_drafts",
  "medication_decisions",
  "medication_order_draft_items",
  "medication_order_items",
  "medication_order_price_snapshots",
  "medications",
  "patient_allergy_items",
  "patient_allergy_revisions",
  "patients",
  "platform_metadata",
  "sessions",
  "staff_accounts",
  "visits",
  "visit_closures",
]);

const auditTriggerSql = {
  update: `CREATE TRIGGER \`audit_events_block_update\`
BEFORE UPDATE ON \`audit_events\`
BEGIN
\tSELECT RAISE(ABORT, 'audit_events are append-only');
END;`,
  delete: `CREATE TRIGGER \`audit_events_block_delete\`
BEFORE DELETE ON \`audit_events\`
BEGIN
\tSELECT RAISE(ABORT, 'audit_events are append-only');
END;`,
} as const;

const appendOnlyTables = [
  "clinical_notes",
  "clinical_note_diagnoses",
  "clinical_note_amendments",
  "medication_decisions",
  "medication_order_items",
  "medication_order_price_snapshots",
  "patient_allergy_revisions",
  "patient_allergy_items",
  "inventory_receipts",
  "inventory_receipt_lines",
  "inventory_stock_movements",
  "inventory_adjustments",
  "inventory_lot_status_events",
  "inventory_reservation_allocations",
  "fulfillment_label_items",
  "fulfillment_label_print_events",
  "fulfillment_preparation_confirmations",
  "fulfillment_artifact_invalidations",
  "fulfillment_releases",
  "fulfillment_rejections",
  "fulfillment_dispenses",
  "fulfillment_dispense_lines",
  "fulfillment_dispense_price_snapshots",
  "fulfillment_label_versions",
  "finance_charges",
  "finance_charge_lines",
  "finance_charge_adjustments",
  "finance_payments",
  "visit_closures",
] as const;

function appendOnlyTriggerSql(table: (typeof appendOnlyTables)[number], operation: "update" | "delete"): string {
  const indent = table === "inventory_reservation_allocations" || table === "inventory_stock_movements" || table === "inventory_adjustments" || table === "inventory_lot_status_events" || table === "visit_closures" || table.startsWith("fulfillment_") || table.startsWith("finance_") ? "  " : "\t";
  return `CREATE TRIGGER \`${table}_block_${operation}\`
BEFORE ${operation.toUpperCase()} ON \`${table}\`
BEGIN
${indent}SELECT RAISE(ABORT, '${table} are append-only');
END;`;
}

const clinicalTriggerNames = appendOnlyTables.flatMap((table) => [
  `${table}_block_update`,
  `${table}_block_delete`,
]);

const preparationDeleteTriggerSql = `CREATE TRIGGER \`fulfillment_preparations_block_delete\`
BEFORE DELETE ON \`fulfillment_preparations\`
BEGIN
  SELECT RAISE(ABORT, 'fulfillment_preparations are append-only');
END;`;

const knownAppendOnlyTriggerNames = [
  "audit_events_block_update",
  "audit_events_block_delete",
  ...clinicalTriggerNames,
  "fulfillment_preparations_block_delete",
] as const;

export interface ResetSyntheticDependencies {
  argv: readonly string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface MaintenanceLock {
  path: string;
  release: () => void;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertSafeDatabaseArtifacts(databasePath: string): void {
  for (const artifact of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    try {
      const stat = lstatSync(artifact);
      if (stat.isSymbolicLink()) fail("database artifacts must not be symbolic links");
      if (!stat.isFile()) fail("database artifacts must be regular files");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertExistingRegularDatabase(inputPath: string): void {
  try {
    const stat = lstatSync(inputPath);
    if (stat.isSymbolicLink()) fail("database target must not be a symbolic link");
    if (!stat.isFile()) fail("database target must be a file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("database file does not exist");
    throw error;
  }
}

function acquireMaintenanceLock(databasePath: string): MaintenanceLock {
  const path = maintenanceLockPath(databasePath);
  try {
    mkdirSync(path, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(path, 0o700);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      fail("CareFlow synthetic reset is already running");
    }
    throw error;
  }
  let released = false;
  return {
    path,
    release: () => {
      if (released) return;
      rmdirSync(path);
      released = true;
    },
  };
}

function assertNoHostLock(lockPath: string): void {
  if (existsSync(lockPath)) fail("CareFlow Clinic Host is running; stop it before reset");
}

function listApplicationTables(sqlite: Database.Database): string[] {
  return sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
}

interface SchemaObject {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

function schemaObjects(sqlite: Database.Database): SchemaObject[] {
  return sqlite
    .prepare(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
    .map((row) => {
      const value = row as { type: string; name: string; tbl_name: string; sql: string | null };
      return { type: value.type, name: value.name, tbl_name: value.tbl_name, sql: value.sql ?? "" };
    });
}

function assertCanonicalSchema(sqlite: Database.Database): void {
  const canonical = new Database(":memory:");
  try {
    migrate(drizzle(canonical, { schema }), { migrationsFolder: migrationFolder() });
    if (JSON.stringify(schemaObjects(sqlite)) !== JSON.stringify(schemaObjects(canonical))) {
      fail("CareFlow database schema does not match the Pilot migrations");
    }
  } finally {
    canonical.close();
  }
}

function assertPilotIdentity(sqlite: Database.Database): void {
  assertKnownPilotDatabase(sqlite);
  assertCanonicalSchema(sqlite);
  const tables = listApplicationTables(sqlite);
  if (tables.some((name) => !expectedTables.has(name)) || tables.length !== expectedTables.size) {
    fail("Database contains unknown application tables");
  }
  const clinic = sqlite
    .prepare("SELECT synthetic_only FROM clinic_config WHERE id = 'clinic'")
    .get() as { synthetic_only?: number } | undefined;
  if (!clinic || clinic.synthetic_only !== 1) {
    fail("Synthetic-only clinic marker is required");
  }
}

function assertForeignKeys(sqlite: Database.Database): void {
  const errors = sqlite.prepare("PRAGMA foreign_key_check").all();
  if (errors.length > 0) fail("foreign_key_check failed after synthetic reset");
}

function restoreAuditTriggers(sqlite: Database.Database): void {
  sqlite.exec(auditTriggerSql.update);
  sqlite.exec(auditTriggerSql.delete);
}

function restoreClinicalTriggers(sqlite: Database.Database): void {
  for (const table of appendOnlyTables) {
    sqlite.exec(appendOnlyTriggerSql(table, "update"));
    sqlite.exec(appendOnlyTriggerSql(table, "delete"));
  }
  sqlite.exec(preparationDeleteTriggerSql);
}

function dropKnownAppendOnlyTriggers(sqlite: Database.Database): void {
  sqlite.exec(knownAppendOnlyTriggerNames.map((name) => `DROP TRIGGER IF EXISTS ${name};`).join(" "));
}

function verifyReset(sqlite: Database.Database): void {
  const targets = [
    ["sessions", "count(*)"],
    ["idempotency_records", "count(*)"],
    ["clinical_note_amendments", "count(*)"],
    ["clinical_note_diagnoses", "count(*)"],
    ["clinical_note_draft_diagnoses", "count(*)"],
    ["clinical_note_drafts", "count(*)"],
    ["clinical_notes", "count(*)"],
    ["intake_observations", "count(*)"],
    ["inventory_stock_movements", "count(*)"],
    ["inventory_adjustments", "count(*)"],
    ["inventory_lot_status_events", "count(*)"],
    ["fulfillment_dispense_lines", "count(*)"],
    ["fulfillment_dispense_price_snapshots", "count(*)"],
    ["finance_payments", "count(*)"],
    ["finance_charge_adjustments", "count(*)"],
    ["finance_charge_lines", "count(*)"],
    ["finance_charges", "count(*)"],
    ["visit_closures", "count(*)"],
    ["fulfillment_dispenses", "count(*)"],
    ["fulfillment_releases", "count(*)"],
    ["fulfillment_rejections", "count(*)"],
    ["fulfillment_artifact_invalidations", "count(*)"],
    ["fulfillment_preparation_confirmations", "count(*)"],
    ["fulfillment_preparations", "count(*)"],
    ["fulfillment_label_print_events", "count(*)"],
    ["fulfillment_label_items", "count(*)"],
    ["fulfillment_label_versions", "count(*)"],
    ["inventory_reservation_allocations", "count(*)"],
    ["inventory_reservations", "count(*)"],
    ["inventory_receipt_lines", "count(*)"],
    ["inventory_receipts", "count(*)"],
    ["inventory_lots", "count(*)"],
    ["medication_decision_drafts", "count(*)"],
    ["medication_decisions", "count(*)"],
    ["medication_order_draft_items", "count(*)"],
    ["medication_order_items", "count(*)"],
    ["medication_order_price_snapshots", "count(*)"],
    ["patient_allergy_items", "count(*)"],
    ["patient_allergy_revisions", "count(*)"],
    ["visits", "count(*)"],
    ["patients", "count(*)"],
  ] as const;
  for (const [table, expression] of targets) {
    const count = sqlite.prepare(`SELECT ${expression} AS count FROM ${table}`).get() as { count: number };
    if (Number(count.count) !== 0) fail(`Synthetic reset left rows in ${table}`);
  }
  const counter = sqlite
    .prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'")
    .pluck()
    .get();
  if (Number(counter) !== 0) fail("Synthetic patient counter was not reset");
  const triggerNames = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_events_block_%' ORDER BY name")
    .pluck()
    .all() as string[];
  if (triggerNames.join(",") !== "audit_events_block_delete,audit_events_block_update") {
    fail("Audit append-only triggers were not restored");
  }
  const clinicalTriggerNamesAfterReset = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_block_%' AND name NOT LIKE '%_after_closure_block_%' AND name <> 'audit_events_block_update' AND name <> 'audit_events_block_delete' ORDER BY name")
    .pluck()
    .all() as string[];
  if (clinicalTriggerNamesAfterReset.join(",") !== [...clinicalTriggerNames, "fulfillment_preparations_block_delete"].sort().join(",")) {
    fail("Clinical append-only triggers were not restored");
  }
  const clinicalAuditCount = sqlite
    .prepare(`SELECT count(*) FROM audit_events WHERE ${syntheticAuditPredicate}`)
    .pluck()
    .get();
  if (Number(clinicalAuditCount) !== 0) fail("Synthetic reset left clinical Audit rows");
  const catalog = sqlite
    .prepare("SELECT id, display_name, active, revision, unit_price_baht FROM medications ORDER BY id")
    .all();
  if (JSON.stringify(catalog) !== JSON.stringify([
    { id: "DEMO-MED-001", display_name: "[DEMO] ยาทดสอบชนิด A", active: 1, revision: 1, unit_price_baht: 5 },
    { id: "DEMO-MED-002", display_name: "[DEMO] ยาทดสอบชนิด B", active: 1, revision: 1, unit_price_baht: 10 },
    { id: "DEMO-MED-003", display_name: "[DEMO] ยาทดสอบชนิด C", active: 1, revision: 1, unit_price_baht: 50 },
    { id: "DEMO-MED-004", display_name: "[DEMO] ยาทดสอบชนิด D", active: 1, revision: 1, unit_price_baht: 15 },
  ])) fail("Synthetic medication catalog changed during reset");
  const clinicPricing = sqlite
    .prepare("SELECT consultation_fee_baht, pricing_revision FROM clinic_config WHERE id = 'clinic'")
    .get();
  if (JSON.stringify(clinicPricing) !== JSON.stringify({ consultation_fee_baht: 100, pricing_revision: 1 })) {
    fail("Synthetic clinic pricing changed during reset");
  }
  assertForeignKeys(sqlite);
  const freelist = Number(sqlite.pragma("freelist_count", { simple: true }));
  if (freelist !== 0) fail("SQLite VACUUM did not reclaim all free pages");
}

function parseArguments(argv: readonly string[]): string {
  if (argv.length !== 4 || argv[0] !== "--database" || argv[2] !== "--confirm" || argv[3] !== RESET_CONFIRMATION) {
    fail(`Usage: --database /absolute/path/careflow.sqlite --confirm ${RESET_CONFIRMATION}`);
  }
  const databasePath = argv[1] ?? "";
  if (!databasePath || !isAbsolute(databasePath)) fail("--database must be an absolute path");
  return resolve(databasePath);
}

export function runResetSyntheticData(deps: ResetSyntheticDependencies): number {
  let maintenanceLock: MaintenanceLock | undefined;
  let sqlite: Database.Database | undefined;
  let transactionOpen = false;
  try {
    const inputPath = parseArguments(deps.argv);
    assertExistingRegularDatabase(inputPath);
    const target = resolveDatabaseTarget(inputPath);
    if (!existsSync(target.databasePath)) fail("database file does not exist");
    assertSafeDatabaseArtifacts(target.databasePath);
    assertNoHostLock(target.lockPath);
    maintenanceLock = acquireMaintenanceLock(target.databasePath);
    assertNoHostLock(target.lockPath);

    // Read-only validation ensures all fail-closed identity guards leave the
    // file byte-for-byte untouched before any writable handle is opened.
    const readonly = new Database(target.databasePath, { readonly: true, fileMustExist: true });
    try {
      assertPilotIdentity(readonly);
    } finally {
      readonly.close();
    }

    sqlite = new Database(target.databasePath, { fileMustExist: true });
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("secure_delete = ON");
    assertNoHostLock(target.lockPath);
    sqlite.exec("BEGIN EXCLUSIVE");
    transactionOpen = true;
    dropKnownAppendOnlyTriggers(sqlite);
    sqlite.exec("DELETE FROM sessions;");
    sqlite.exec("DELETE FROM idempotency_records;");
    sqlite.exec("DELETE FROM visit_closures;");
    sqlite.exec("DELETE FROM finance_payments;");
    sqlite.exec("DELETE FROM finance_charge_adjustments;");
    sqlite.exec("DELETE FROM finance_charge_lines;");
    sqlite.exec("DELETE FROM finance_charges;");
    sqlite.exec("DELETE FROM fulfillment_dispense_price_snapshots;");
    sqlite.exec("DELETE FROM medication_order_price_snapshots;");
    sqlite.exec("DELETE FROM fulfillment_dispense_lines;");
    sqlite.exec("DELETE FROM fulfillment_dispenses;");
    sqlite.exec("DELETE FROM fulfillment_releases;");
    sqlite.exec("DELETE FROM fulfillment_rejections;");
    sqlite.exec("DELETE FROM fulfillment_artifact_invalidations;");
    sqlite.exec("DELETE FROM fulfillment_preparation_confirmations;");
    sqlite.exec("DELETE FROM fulfillment_preparations;");
    sqlite.exec("DELETE FROM fulfillment_label_print_events;");
    sqlite.exec("DELETE FROM fulfillment_label_items;");
    sqlite.exec("DELETE FROM fulfillment_label_versions;");
    sqlite.exec("DELETE FROM inventory_adjustments;");
    sqlite.exec("DELETE FROM inventory_lot_status_events;");
    sqlite.exec("DELETE FROM inventory_stock_movements;");
    sqlite.exec("DELETE FROM inventory_reservation_allocations;");
    sqlite.exec("DELETE FROM inventory_reservations;");
    sqlite.exec("DELETE FROM inventory_receipt_lines;");
    sqlite.exec("DELETE FROM inventory_receipts;");
    sqlite.exec("DELETE FROM inventory_lots;");
    sqlite.exec("DELETE FROM medication_order_draft_items;");
    sqlite.exec("DELETE FROM medication_decision_drafts;");
    sqlite.exec("DELETE FROM medication_order_items;");
    sqlite.exec("DELETE FROM medication_decisions;");
    sqlite.exec("DELETE FROM clinical_note_draft_diagnoses;");
    sqlite.exec("DELETE FROM clinical_note_drafts;");
    sqlite.exec("DELETE FROM clinical_note_diagnoses;");
    sqlite.exec("DELETE FROM clinical_note_amendments;");
    sqlite.exec("DELETE FROM clinical_notes;");
    sqlite.exec("DELETE FROM patient_allergy_items;");
    sqlite.exec("DELETE FROM patient_allergy_revisions;");
    sqlite.exec("DELETE FROM intake_observations;");
    sqlite.exec("DELETE FROM visits;");
    sqlite.exec("DELETE FROM patients;");
    sqlite.exec(`DELETE FROM audit_events WHERE ${syntheticAuditPredicate};`);
    sqlite.exec("UPDATE clinic_counters SET value = 0 WHERE key = 'synthetic_patient';");
    restoreAuditTriggers(sqlite);
    restoreClinicalTriggers(sqlite);
    sqlite.exec("COMMIT");
    transactionOpen = false;

    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    sqlite.exec("VACUUM");
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    verifyReset(sqlite);
    sqlite.close();
    sqlite = undefined;
    maintenanceLock.release();
    maintenanceLock = undefined;
    deps.stdout("Synthetic Pilot data reset complete");
    return 0;
  } catch {
    if (transactionOpen && sqlite) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // The original error is the actionable CLI result.
      }
    }
    try {
      sqlite?.close();
    } catch {
      // Keep the command non-zero if physical cleanup itself failed.
    }
    try {
      maintenanceLock?.release();
    } catch {
      // A leftover lock is intentionally visible for safe operator recovery.
    }
    deps.stderr("Synthetic Pilot data reset failed");
    return 1;
  }
}

// Exported for tests/documentation without exposing mutable internals.
export const syntheticResetTriggerSql = Object.freeze({ ...auditTriggerSql });
