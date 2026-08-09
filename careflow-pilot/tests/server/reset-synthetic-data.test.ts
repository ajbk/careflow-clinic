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
      INSERT INTO patient_allergy_revisions VALUES ('reset-allergy-revision', '${patientId}', 1, 'NONE_KNOWN', 'source', 'reason', 'reset-assistant-001', '${now}');
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
      VALUES ('reset-receipt', 'clinic', 'ผู้จำหน่ายรีเซ็ต', 'ทดสอบ', '${now}', 'reset-assistant-001');
      INSERT INTO inventory_lots (
        id, clinic_id, medication_id, medication_revision, display_name_snapshot, strength_snapshot,
        dosage_form_snapshot, unit_snapshot, lot_number, expiry_date, supplier_name, status, created_at, created_by
      ) VALUES (
        'reset-lot', 'clinic', 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ',
        'เม็ดทดสอบ', 'เม็ด', 'RESET-2608', '2027-08-31', 'ผู้จำหน่ายรีเซ็ต', 'AVAILABLE', '${now}', 'reset-assistant-001'
      );
      INSERT INTO inventory_receipt_lines (id, receipt_id, lot_id, quantity, unit_snapshot)
      VALUES ('reset-receipt-line', 'reset-receipt', 'reset-lot', 12, 'เม็ด');
      INSERT INTO inventory_stock_movements (
        id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id
      ) VALUES ('reset-movement', 'clinic', 'reset-lot', 'RECEIPT', 12, 'RECEIPT', 'reset-receipt', 'ทดสอบ', '${now}', 'reset-assistant-001');
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
    seedFulfillmentAuditEvidence(fixture.databasePath);
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
        "medication_decisions",
        "inventory_stock_movements",
        "inventory_receipt_lines",
        "inventory_receipts",
        "inventory_reservation_allocations",
        "inventory_reservations",
        "inventory_lots",
      ]) {
        expect(database.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
      }
      expect(database.prepare("SELECT id, display_name, active, revision FROM medications ORDER BY id").all()).toEqual([
        { id: "DEMO-MED-001", display_name: "[DEMO] ยาทดสอบชนิด A", active: 1, revision: 1 },
        { id: "DEMO-MED-002", display_name: "[DEMO] ยาทดสอบชนิด B", active: 1, revision: 1 },
        { id: "DEMO-MED-003", display_name: "[DEMO] ยาทดสอบชนิด C", active: 1, revision: 1 },
        { id: "DEMO-MED-004", display_name: "[DEMO] ยาทดสอบชนิด D", active: 1, revision: 1 },
      ]);
      expect(database.prepare("SELECT value FROM clinic_counters WHERE key = 'synthetic_patient'").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM staff_accounts").pluck().get()).toBe(1);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'account.%'").pluck().get()).toBe(fixture.accountAuditCount);
      expect(database.prepare("SELECT count(*) FROM audit_events WHERE action LIKE 'patient.%' OR action LIKE 'visit.%' OR action LIKE 'allergy.%' OR action LIKE 'note.%' OR action LIKE 'medication.%' OR action LIKE 'inventory.%' OR action LIKE 'label.%' OR action LIKE 'preparation.%' OR action LIKE 'fulfillment.%' OR action LIKE 'dispense.%'").pluck().get()).toBe(0);
      expect(Number(fixture.accountAuditCount)).toBeGreaterThan(0);
      expect(() => database.prepare("DELETE FROM audit_events WHERE action LIKE 'account.%'").run()).toThrow("append-only");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
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
