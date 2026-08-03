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

function primaryKeyColumns(value: TestDatabase, table: string): string[] {
  return (value.sqlite.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string; pk: number }>)
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function uniqueIndexNames(value: TestDatabase, table: string): string[] {
  return (value.sqlite.prepare(`PRAGMA index_list('${table}')`).all() as Array<{
    name: string;
    origin: string;
    unique: number;
  }>)
    .filter((index) => index.unique === 1 && index.origin !== "pk")
    .map((index) => index.name)
    .sort();
}

function indexColumns(value: TestDatabase, index: string): string[] {
  return (value.sqlite.prepare(`PRAGMA index_info('${index}')`).all() as Array<{
    name: string;
    seqno: number;
  }>)
    .sort((left, right) => left.seqno - right.seqno)
    .map((column) => column.name);
}

function foreignKeyRules(value: TestDatabase, table: string): Array<Record<string, string>> {
  return (value.sqlite.prepare(`PRAGMA foreign_key_list('${table}')`).all() as Array<{
    table: string;
    from: string;
    to: string;
    on_update: string;
    on_delete: string;
  }>)
    .map((foreignKey) => ({
      table: foreignKey.table,
      from: foreignKey.from,
      to: foreignKey.to,
      onUpdate: foreignKey.on_update,
      onDelete: foreignKey.on_delete,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
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

    const expectedChecks: Record<string, string[]> = {
      patient_allergy_revisions: [
        'CONSTRAINT "patient_allergy_revisions_revision_check" CHECK("patient_allergy_revisions"."revision" >= 1)',
        'CONSTRAINT "patient_allergy_revisions_state_check" CHECK("patient_allergy_revisions"."state" IN (\'UNKNOWN\', \'NONE_KNOWN\', \'PRESENT\'))',
        'CONSTRAINT "patient_allergy_revisions_source_text_check" CHECK(length("patient_allergy_revisions"."source_text") BETWEEN 1 AND 500)',
        'CONSTRAINT "patient_allergy_revisions_reason_check" CHECK(length("patient_allergy_revisions"."reason") BETWEEN 1 AND 500)',
      ],
      patient_allergy_items: [
        'CONSTRAINT "patient_allergy_items_position_check" CHECK("patient_allergy_items"."position" >= 0)',
        'CONSTRAINT "patient_allergy_items_substance_check" CHECK(length("patient_allergy_items"."substance") BETWEEN 1 AND 200)',
        'CONSTRAINT "patient_allergy_items_reaction_check" CHECK(length("patient_allergy_items"."reaction") BETWEEN 1 AND 300)',
        'CONSTRAINT "patient_allergy_items_severity_check" CHECK("patient_allergy_items"."severity" IN (\'UNKNOWN\', \'MILD\', \'MODERATE\', \'SEVERE\'))',
        'CONSTRAINT "patient_allergy_items_note_check" CHECK("patient_allergy_items"."note" IS NULL OR length("patient_allergy_items"."note") <= 500)',
      ],
      clinical_note_drafts: [
        'CONSTRAINT "clinical_note_drafts_revision_check" CHECK("clinical_note_drafts"."revision" >= 1)',
        'CONSTRAINT "clinical_note_drafts_subjective_check" CHECK(length("clinical_note_drafts"."subjective") BETWEEN 0 AND 4000)',
        'CONSTRAINT "clinical_note_drafts_objective_check" CHECK(length("clinical_note_drafts"."objective") BETWEEN 0 AND 4000)',
        'CONSTRAINT "clinical_note_drafts_assessment_check" CHECK(length("clinical_note_drafts"."assessment") BETWEEN 0 AND 4000)',
        'CONSTRAINT "clinical_note_drafts_plan_check" CHECK(length("clinical_note_drafts"."plan") BETWEEN 0 AND 4000)',
      ],
      clinical_note_draft_diagnoses: [
        'CONSTRAINT "clinical_note_draft_diagnoses_position_check" CHECK("clinical_note_draft_diagnoses"."position" >= 0)',
        'CONSTRAINT "clinical_note_draft_diagnoses_text_check" CHECK(length("clinical_note_draft_diagnoses"."diagnosis_text") BETWEEN 1 AND 300)',
      ],
      clinical_notes: [
        'CONSTRAINT "clinical_notes_version_check" CHECK("clinical_notes"."version" >= 1)',
        'CONSTRAINT "clinical_notes_subjective_check" CHECK(length("clinical_notes"."subjective") BETWEEN 1 AND 4000)',
        'CONSTRAINT "clinical_notes_objective_check" CHECK(length("clinical_notes"."objective") BETWEEN 1 AND 4000)',
        'CONSTRAINT "clinical_notes_assessment_check" CHECK(length("clinical_notes"."assessment") BETWEEN 1 AND 4000)',
        'CONSTRAINT "clinical_notes_plan_check" CHECK(length("clinical_notes"."plan") BETWEEN 1 AND 4000)',
        'CONSTRAINT "clinical_notes_source_draft_revision_check" CHECK("clinical_notes"."source_draft_revision" >= 1)',
        'CONSTRAINT "clinical_notes_content_hash_check" CHECK(length("clinical_notes"."content_hash") = 64 AND "clinical_notes"."content_hash" NOT GLOB \'*[^0-9a-f]*\')',
      ],
      clinical_note_diagnoses: [
        'CONSTRAINT "clinical_note_diagnoses_position_check" CHECK("clinical_note_diagnoses"."position" >= 0)',
        'CONSTRAINT "clinical_note_diagnoses_text_check" CHECK(length("clinical_note_diagnoses"."diagnosis_text") BETWEEN 1 AND 300)',
      ],
      clinical_note_amendments: [
        'CONSTRAINT "clinical_note_amendments_version_check" CHECK("clinical_note_amendments"."version" >= 1)',
        'CONSTRAINT "clinical_note_amendments_content_check" CHECK(length("clinical_note_amendments"."content") BETWEEN 1 AND 4000)',
        'CONSTRAINT "clinical_note_amendments_reason_check" CHECK(length("clinical_note_amendments"."reason") BETWEEN 1 AND 500)',
        'CONSTRAINT "clinical_note_amendments_content_hash_check" CHECK(length("clinical_note_amendments"."content_hash") = 64 AND "clinical_note_amendments"."content_hash" NOT GLOB \'*[^0-9a-f]*\')',
      ],
      medications: [
        'CONSTRAINT "medications_id_check" CHECK(length("medications"."id") = 12 AND "medications"."id" GLOB \'DEMO-MED-[0-9][0-9][0-9]\')',
        'CONSTRAINT "medications_display_name_check" CHECK(length("medications"."display_name") BETWEEN 1 AND 200)',
        'CONSTRAINT "medications_strength_text_check" CHECK(length("medications"."strength_text") BETWEEN 1 AND 100)',
        'CONSTRAINT "medications_dosage_form_text_check" CHECK(length("medications"."dosage_form_text") BETWEEN 1 AND 100)',
        'CONSTRAINT "medications_canonical_unit_check" CHECK(length("medications"."canonical_unit") BETWEEN 1 AND 100)',
        'CONSTRAINT "medications_active_check" CHECK("medications"."active" IN (0, 1))',
        'CONSTRAINT "medications_revision_check" CHECK("medications"."revision" >= 1)',
      ],
      medication_decision_drafts: [
        'CONSTRAINT "medication_decision_drafts_revision_check" CHECK("medication_decision_drafts"."revision" >= 1)',
        'CONSTRAINT "medication_decision_drafts_kind_check" CHECK("medication_decision_drafts"."kind" IN (\'UNDECIDED\', \'ORDER\', \'NO_MEDICATION\'))',
        'CONSTRAINT "medication_decision_drafts_no_medication_reason_check" CHECK("medication_decision_drafts"."no_medication_reason" IS NULL OR length("medication_decision_drafts"."no_medication_reason") <= 500)',
      ],
      medication_order_draft_items: [
        'CONSTRAINT "medication_order_draft_items_position_check" CHECK("medication_order_draft_items"."position" >= 0)',
        'CONSTRAINT "medication_order_draft_items_medication_revision_check" CHECK("medication_order_draft_items"."medication_revision" >= 1)',
        'CONSTRAINT "medication_order_draft_items_quantity_check" CHECK("medication_order_draft_items"."quantity" BETWEEN 1 AND 9999)',
        'CONSTRAINT "medication_order_draft_items_directions_th_check" CHECK(length("medication_order_draft_items"."directions_th") BETWEEN 1 AND 500)',
      ],
      medication_decisions: [
        'CONSTRAINT "medication_decisions_version_check" CHECK("medication_decisions"."version" >= 1)',
        'CONSTRAINT "medication_decisions_kind_check" CHECK("medication_decisions"."kind" IN (\'ORDER\', \'NO_MEDICATION\'))',
        'CONSTRAINT "medication_decisions_no_medication_reason_check" CHECK("medication_decisions"."no_medication_reason" IS NULL OR length("medication_decisions"."no_medication_reason") BETWEEN 1 AND 500)',
        'CONSTRAINT "medication_decisions_revision_reason_check" CHECK("medication_decisions"."revision_reason" IS NULL OR length("medication_decisions"."revision_reason") BETWEEN 1 AND 500)',
        'CONSTRAINT "medication_decisions_content_hash_check" CHECK(length("medication_decisions"."content_hash") = 64 AND "medication_decisions"."content_hash" NOT GLOB \'*[^0-9a-f]*\')',
      ],
      medication_order_items: [
        'CONSTRAINT "medication_order_items_position_check" CHECK("medication_order_items"."position" >= 0)',
        'CONSTRAINT "medication_order_items_medication_revision_check" CHECK("medication_order_items"."medication_revision" >= 1)',
        'CONSTRAINT "medication_order_items_display_name_snapshot_check" CHECK(length("medication_order_items"."display_name_snapshot") BETWEEN 1 AND 200)',
        'CONSTRAINT "medication_order_items_strength_snapshot_check" CHECK(length("medication_order_items"."strength_snapshot") BETWEEN 1 AND 100)',
        'CONSTRAINT "medication_order_items_dosage_form_snapshot_check" CHECK(length("medication_order_items"."dosage_form_snapshot") BETWEEN 1 AND 100)',
        'CONSTRAINT "medication_order_items_unit_snapshot_check" CHECK(length("medication_order_items"."unit_snapshot") BETWEEN 1 AND 100)',
        'CONSTRAINT "medication_order_items_quantity_check" CHECK("medication_order_items"."quantity" BETWEEN 1 AND 9999)',
        'CONSTRAINT "medication_order_items_directions_th_check" CHECK(length("medication_order_items"."directions_th") BETWEEN 1 AND 500)',
      ],
    };
    for (const [table, checks] of Object.entries(expectedChecks)) {
      const sql = tableSql(value, table);
      for (const check of checks) expect(sql).toContain(check);
    }
    expect(tableSql(value, "clinical_notes"))
      .toContain("`signed_by_display_name` text DEFAULT 'legacy signer snapshot unavailable' NOT NULL");
    expect(tableSql(value, "medication_decisions"))
      .toContain("`signed_by_display_name` text DEFAULT 'legacy signer snapshot unavailable' NOT NULL");

    const expectedForeignKeys: Record<string, Array<Record<string, string>>> = {
      patient_allergy_revisions: [
        { table: "patients", from: "patient_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "reviewed_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      patient_allergy_items: [
        { table: "patient_allergy_revisions", from: "allergy_revision_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      clinical_note_drafts: [
        { table: "visits", from: "visit_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "created_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "updated_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      clinical_note_draft_diagnoses: [
        { table: "clinical_note_drafts", from: "draft_id", to: "id", onUpdate: "NO ACTION", onDelete: "CASCADE" },
      ],
      clinical_notes: [
        { table: "visits", from: "visit_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "signed_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      clinical_note_diagnoses: [
        { table: "clinical_notes", from: "clinical_note_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      clinical_note_amendments: [
        { table: "clinical_notes", from: "clinical_note_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "signed_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      medications: [],
      medication_decision_drafts: [
        { table: "visits", from: "visit_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "created_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "updated_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      medication_order_draft_items: [
        { table: "medication_decision_drafts", from: "decision_draft_id", to: "id", onUpdate: "NO ACTION", onDelete: "CASCADE" },
        { table: "medications", from: "medication_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      medication_decisions: [
        { table: "visits", from: "visit_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "medication_decisions", from: "supersedes_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "staff_accounts", from: "signed_by", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
      medication_order_items: [
        { table: "medication_decisions", from: "medication_decision_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
        { table: "medications", from: "medication_id", to: "id", onUpdate: "NO ACTION", onDelete: "NO ACTION" },
      ],
    };
    for (const [table, foreignKeys] of Object.entries(expectedForeignKeys)) {
      expect(primaryKeyColumns(value, table)).toEqual(["id"]);
      expect(foreignKeyRules(value, table)).toEqual(
        foreignKeys.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      );
    }

    const expectedUniqueIndexes: Record<string, Record<string, string[]>> = {
      patient_allergy_revisions: {
        patient_allergy_revisions_patient_revision_unique: ["patient_id", "revision"],
      },
      patient_allergy_items: {
        patient_allergy_items_revision_position_unique: ["allergy_revision_id", "position"],
      },
      clinical_note_drafts: {
        clinical_note_drafts_visit_id_unique: ["visit_id"],
      },
      clinical_note_draft_diagnoses: {
        clinical_note_draft_diagnoses_draft_position_unique: ["draft_id", "position"],
      },
      clinical_notes: {
        clinical_notes_visit_version_unique: ["visit_id", "version"],
      },
      clinical_note_diagnoses: {
        clinical_note_diagnoses_note_position_unique: ["clinical_note_id", "position"],
      },
      clinical_note_amendments: {
        clinical_note_amendments_note_version_unique: ["clinical_note_id", "version"],
      },
      medications: {},
      medication_decision_drafts: {
        medication_decision_drafts_visit_id_unique: ["visit_id"],
      },
      medication_order_draft_items: {
        medication_order_draft_items_draft_position_unique: ["decision_draft_id", "position"],
      },
      medication_decisions: {
        medication_decisions_visit_version_unique: ["visit_id", "version"],
      },
      medication_order_items: {
        medication_order_items_decision_position_unique: ["medication_decision_id", "position"],
      },
    };
    for (const [table, indexes] of Object.entries(expectedUniqueIndexes)) {
      expect(uniqueIndexNames(value, table)).toEqual(Object.keys(indexes).sort());
      for (const [index, columns] of Object.entries(indexes)) {
        expect(indexColumns(value, index)).toEqual(columns);
      }
    }
    expect(indexNames(value)).toContain("clinical_note_drafts_visit_id_unique");
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
      INSERT INTO clinical_notes (
        id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
        signed_by, signed_at, content_hash, signed_by_display_name
      ) VALUES ('note-001', 'visit-001', 1, 'subjective', 'objective', 'assessment', 'plan', 1, 'doctor-001', '${now}', '${hash}', 'พญ. ทดสอบ');
      INSERT INTO clinical_note_diagnoses VALUES ('note-diagnosis-001', 'note-001', 0, 'diagnosis');
      INSERT INTO clinical_note_amendments VALUES ('note-amendment-001', 'note-001', 1, 'amendment', 'reason', 'doctor-001', '${now}', '${hash}');
      INSERT INTO medication_decision_drafts VALUES ('decision-draft-001', 'visit-001', 1, 'ORDER', NULL, 'doctor-001', 'doctor-001', '${now}', '${now}');
      INSERT INTO medication_order_draft_items VALUES ('order-draft-item-001', 'decision-draft-001', 0, 'DEMO-MED-001', 1, 1, 'ทดสอบ');
      INSERT INTO medication_decisions (
        id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
        signed_by, signed_at, content_hash, signed_by_display_name
      ) VALUES ('decision-001', 'visit-001', 1, 'ORDER', NULL, NULL, NULL, 'doctor-001', '${now}', '${hash}', 'พญ. ทดสอบ');
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
