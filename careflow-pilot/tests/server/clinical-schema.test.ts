import { afterEach, describe, expect, it } from "vitest";
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

function applicationTables(value: TestDatabase): string[] {
  return value.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .pluck()
    .all() as string[];
}

function tableSql(value: TestDatabase, table: string): string {
  return value.sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .pluck()
    .get(table) as string;
}

function indexNames(value: TestDatabase): string[] {
  return value.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .pluck()
    .all() as string[];
}

function seedClinicalReferences(value: TestDatabase): void {
  const now = "2026-08-03T00:00:00.000Z";
  value.sqlite.prepare(`INSERT INTO staff_accounts (
    id, clinic_id, username, display_name, role, password_hash,
    must_change_password, active, revision, last_password_changed_at, created_at, updated_at
  ) VALUES ('doctor-001', 'clinic', 'doctor-001', 'แพทย์ทดสอบ', 'doctor', 'hash', 0, 1, 1, ?, ?, ?)`).run(now, now, now);
  value.sqlite.prepare(`INSERT INTO patients (
    id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
  ) VALUES ('patient-001', 'clinic', 'DEMO-000001', 'ผู้ป่วยทดสอบ 000001', '0000000001', '1990-01-01', 'unknown', 1, ?, ?)`).run(now, now);
  value.sqlite.prepare(`INSERT INTO visits (
    id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, created_by
  ) VALUES ('visit-001', 'clinic', 'patient-001', 'WAITING', 'ทดสอบ', 1, ?, 'doctor-001')`).run(now);
}

describe("clinical evidence schema", () => {
  it("creates every clinical evidence table with its versioned constraints and foreign keys", () => {
    const value = database();

    expect(applicationTables(value)).toEqual([
      "__drizzle_migrations",
      "audit_events",
      "clinic_config",
      "clinic_counters",
      "clinical_note_amendments",
      "clinical_note_diagnoses",
      "clinical_note_draft_diagnoses",
      "clinical_note_drafts",
      "clinical_notes",
      "idempotency_records",
      "intake_observations",
      "medication_decision_drafts",
      "medication_decisions",
      "medication_order_draft_items",
      "medication_order_items",
      "medications",
      "patient_allergy_items",
      "patient_allergy_revisions",
      "patients",
      "platform_metadata",
      "sessions",
      "staff_accounts",
      "visits",
    ]);

    expect(tableSql(value, "patient_allergy_revisions")).toContain("patient_allergy_revisions_revision_check");
    expect(tableSql(value, "patient_allergy_revisions")).toContain("patient_allergy_revisions_state_check");
    expect(tableSql(value, "patient_allergy_revisions")).toContain("FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)");
    expect(tableSql(value, "patient_allergy_revisions")).toContain("FOREIGN KEY (`reviewed_by`) REFERENCES `staff_accounts`(`id`)");
    expect(tableSql(value, "patient_allergy_items")).toContain("patient_allergy_items_severity_check");
    expect(tableSql(value, "patient_allergy_items")).toContain("FOREIGN KEY (`allergy_revision_id`) REFERENCES `patient_allergy_revisions`(`id`)");
    expect(tableSql(value, "clinical_note_drafts")).toContain("clinical_note_drafts_revision_check");
    expect(indexNames(value)).toContain("clinical_note_drafts_visit_id_unique");
    expect(tableSql(value, "clinical_note_draft_diagnoses")).toContain("ON DELETE cascade");
    expect(tableSql(value, "clinical_notes")).toContain("clinical_notes_content_hash_check");
    expect(tableSql(value, "clinical_notes")).toContain("clinical_notes_source_draft_revision_check");
    expect(tableSql(value, "clinical_note_diagnoses")).toContain("clinical_note_diagnoses_position_check");
    expect(tableSql(value, "clinical_note_amendments")).toContain("clinical_note_amendments_content_hash_check");
    expect(tableSql(value, "medications")).toContain("medications_id_check");
    expect(tableSql(value, "medications")).toContain("medications_active_check");
    expect(tableSql(value, "medication_decision_drafts")).toContain("medication_decision_drafts_kind_check");
    expect(tableSql(value, "medication_order_draft_items")).toContain("ON DELETE cascade");
    expect(tableSql(value, "medication_decisions")).toContain("medication_decisions_kind_check");
    expect(tableSql(value, "medication_decisions")).toContain("medication_decisions_content_hash_check");
    expect(tableSql(value, "medication_order_items")).toContain("medication_order_items_quantity_check");
  });

  it("blocks direct updates and deletes on every signed or historical clinical record while drafts remain editable", () => {
    const value = database();
    seedClinicalReferences(value);
    const now = "2026-08-03T00:00:00.000Z";
    const hash = "a".repeat(64);
    value.sqlite.exec(`
      INSERT INTO patient_allergy_revisions VALUES ('allergy-revision-001', 'patient-001', 1, 'NONE_KNOWN', 'source', 'reason', 'doctor-001', '${now}');
      INSERT INTO patient_allergy_items VALUES ('allergy-item-001', 'allergy-revision-001', 0, 'substance', 'reaction', 'MILD', NULL);
      INSERT INTO clinical_note_drafts VALUES ('note-draft-001', 'visit-001', 1, '', '', '', '', 'doctor-001', 'doctor-001', '${now}', '${now}');
      INSERT INTO clinical_note_draft_diagnoses VALUES ('note-draft-diagnosis-001', 'note-draft-001', 0, 'draft diagnosis');
      INSERT INTO clinical_notes VALUES ('note-001', 'visit-001', 1, 'subjective', 'objective', 'assessment', 'plan', 1, 'doctor-001', '${now}', '${hash}');
      INSERT INTO clinical_note_diagnoses VALUES ('note-diagnosis-001', 'note-001', 0, 'diagnosis');
      INSERT INTO clinical_note_amendments VALUES ('note-amendment-001', 'note-001', 1, 'amendment', 'reason', 'doctor-001', '${now}', '${hash}');
      INSERT INTO medication_decision_drafts VALUES ('decision-draft-001', 'visit-001', 1, 'ORDER', NULL, 'doctor-001', 'doctor-001', '${now}', '${now}');
      INSERT INTO medication_order_draft_items VALUES ('order-draft-item-001', 'decision-draft-001', 0, 'DEMO-MED-001', 1, 1, 'ทดสอบ');
      INSERT INTO medication_decisions VALUES ('decision-001', 'visit-001', 1, 'ORDER', NULL, NULL, NULL, 'doctor-001', '${now}', '${hash}');
      INSERT INTO medication_order_items VALUES ('order-item-001', 'decision-001', 0, 'DEMO-MED-001', 1, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 1, 'ทดสอบ');
    `);

    value.sqlite.prepare("UPDATE clinical_note_drafts SET subjective = 'editable'").run();
    expect(value.sqlite.prepare("SELECT subjective FROM clinical_note_drafts").pluck().get()).toBe("editable");

    for (const table of [
      "clinical_notes",
      "clinical_note_diagnoses",
      "clinical_note_amendments",
      "medication_decisions",
      "medication_order_items",
      "patient_allergy_revisions",
      "patient_allergy_items",
    ]) {
      expect(() => value.sqlite.prepare(`UPDATE ${table} SET id = id`).run()).toThrow(`${table} are append-only`);
      expect(() => value.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow(`${table} are append-only`);
    }
  });

  it("seeds only repository-versioned synthetic medications", () => {
    const value = database();

    expect(value.sqlite.prepare(
      "SELECT id, display_name, active, revision FROM medications ORDER BY id",
    ).all()).toEqual([
      { id: "DEMO-MED-001", display_name: "[DEMO] ยาทดสอบชนิด A", active: 1, revision: 1 },
      { id: "DEMO-MED-002", display_name: "[DEMO] ยาทดสอบชนิด B", active: 1, revision: 1 },
      { id: "DEMO-MED-003", display_name: "[DEMO] ยาทดสอบชนิด C", active: 1, revision: 1 },
      { id: "DEMO-MED-004", display_name: "[DEMO] ยาทดสอบชนิด D", active: 1, revision: 1 },
    ]);
  });
});
