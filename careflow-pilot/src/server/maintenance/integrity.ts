import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { assertKnownPilotDatabase, migrationFolder, type DatabaseHandle } from "../db/client.js";
import * as schema from "../db/schema.js";
import { assertFinanceEvidenceIntegrity } from "../modules/finance/service.js";
import { createNoteService } from "../modules/note/service.js";
import { hashEvidence } from "../modules/platform/evidence.js";
import { assertVisitClosureIntegrity } from "../workflows/visit-completion.js";
import { createMedicationService } from "../modules/medication/service.js";
import { assertFulfillmentIntegrity } from "../modules/fulfillment/integrity.js";

function objects(sqlite: Database.Database) {
  return sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY type, name").all();
}
export function schemaFingerprint(sqlite: Database.Database): string { return createHash("sha256").update(JSON.stringify(objects(sqlite))).digest("hex"); }

export function assertDatabaseIntegrity(sqlite: Database.Database, allowPendingMigrations = false): void {
  assertKnownPilotDatabase(sqlite, allowPendingMigrations);
  if (sqlite.pragma("integrity_check", { simple: true }) !== "ok" || sqlite.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Database integrity verification failed");
  if (sqlite.prepare("SELECT synthetic_only FROM clinic_config WHERE id = 'clinic'").pluck().get() !== 1) throw new Error("Synthetic-only marker missing");
  const canonical = new Database(":memory:");
  const appliedCount = sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get() as number;
  if (appliedCount < 26) throw new Error("Unsupported cloud backup schema baseline");
  try {
    canonical.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
    for (const migration of readMigrationFiles({ migrationsFolder: migrationFolder() }).slice(0, appliedCount)) {
      for (const statement of migration.sql) canonical.exec(statement);
    }
    if (schemaFingerprint(sqlite) !== schemaFingerprint(canonical)) throw new Error("Database schema verification failed");
  }
  finally { canonical.close(); }
  const checks = [
    "SELECT 1 FROM inventory_stock_movements GROUP BY lot_id HAVING sum(quantity_delta) < 0 LIMIT 1",
    `SELECT 1 FROM inventory_lots l WHERE COALESCE((SELECT sum(a.quantity) FROM inventory_reservation_allocations a JOIN inventory_reservations r ON r.id=a.reservation_id WHERE a.lot_id=l.id AND r.status='ACTIVE'),0) > COALESCE((SELECT sum(m.quantity_delta) FROM inventory_stock_movements m WHERE m.lot_id=l.id),0) LIMIT 1`,
    `SELECT 1 FROM fulfillment_dispense_lines d WHERE d.quantity <> -COALESCE((SELECT sum(m.quantity_delta) FROM inventory_stock_movements m WHERE m.source_type='DISPENSE' AND m.source_id=d.id AND m.lot_id=d.lot_id),0) LIMIT 1`,
    `SELECT 1 FROM inventory_reservations r LEFT JOIN fulfillment_dispenses d ON d.id=r.consumed_dispense_id WHERE r.status='CONSUMED' AND (d.id IS NULL OR d.reservation_id<>r.id) LIMIT 1`,
    `SELECT 1 FROM visits v LEFT JOIN visit_closures c ON c.visit_id=v.id WHERE v.status='CLOSED' AND c.id IS NULL LIMIT 1`,
  ];
  for (const query of checks) if (sqlite.prepare(query).get()) throw new Error("Business-chain verification failed");
  const database: DatabaseHandle = { sqlite, db: drizzle(sqlite, { schema }), close: () => undefined };
  assertFulfillmentIntegrity(sqlite);
  assertFinanceEvidenceIntegrity(database);
  assertVisitClosureIntegrity(database);
  const notes = createNoteService({ database });
  for (const row of sqlite.prepare("SELECT id FROM clinical_notes").all() as { id: string }[]) {
    const note = notes.getSignedNoteById(row.id); if (!note) throw new Error("Signed note missing");
    const { contentHash, ...evidence } = note;
    if (contentHash !== hashEvidence(evidence)) throw new Error("Clinical evidence verification failed");
    for (const amendment of notes.listAmendments(row.id)) {
      const { contentHash: amendmentHash, ...amendmentEvidence } = amendment;
      if (amendmentHash !== hashEvidence(amendmentEvidence)) throw new Error("Clinical amendment verification failed");
    }
  }
  const medications = createMedicationService({ database });
  for (const row of sqlite.prepare("SELECT id FROM medication_decisions").all() as { id: string }[]) {
    const decision = medications.getSignedDecisionById(row.id); if (!decision) throw new Error("Signed medication decision missing");
    const { contentHash, ...evidence } = decision;
    if (contentHash !== hashEvidence(evidence)) throw new Error("Medication evidence verification failed");
  }
}
