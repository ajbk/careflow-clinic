# CareFlow Clinical Record and Medication Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing read-only Doctor Consultation into a restart-persistent clinical vertical slice with source-linked Snapshot/Allergy, SOAP/Diagnosis draft and immutable signing, a versioned synthetic Medication Order or `NO_MEDICATION`, atomic finalization, amendments, and revision-safe follow-up decisions.

**Architecture:** Keep the Fastify modular monolith and one SQLite writer. Patient owns append-only Allergy history, Note owns mutable drafts and immutable signed evidence, Medication owns the synthetic catalog and decision/order evidence, Visit owns state, and an application-layer `ClinicalWorkflow` composes public module interfaces inside the existing audited/idempotent transaction boundary. React extends the supplied Stitch Consultation composition and treats server DTOs as the only authority.

**Tech Stack:** Node.js >=22.13, TypeScript 5.9, Fastify 5, SQLite WAL via better-sqlite3 13 and Drizzle 0.45, React 19 + Vite 8 + TanStack Query 5, Zod 4, Vitest 4, Testing Library/MSW, and Playwright 1.62.

## Global Constraints

- `docs/superpowers/specs/2026-08-03-careflow-clinical-record-medication-decision-design.md` is binding.
- Keep `careflow-webapp/` frozen and preserve the Stitch-derived layout, existing components/CSS tokens, responsive behavior, and exactly one synthetic Pilot banner.
- Synthetic Patient and medication data only. Do not add real identity entry, real-use claims, imports, cloud services, labs, appointments, AI, or analytics.
- Use one Clinic Host, one canonical SQLite writer, and one transaction for every cross-module clinical command.
- Every significant mutation requires a strict Zod body, named Actor, permission, idempotency key, expected revisions, UTC timestamp, and Audit Event.
- Signed Notes, Diagnoses, amendments, medication decisions, Order-item snapshots, and Allergy history are append-only and storage-enforced; drafts alone are mutable.
- `UNKNOWN`, `NONE_KNOWN`, and recorded values remain distinct. Empty strings never mean `UNKNOWN`, `NO_MEDICATION`, or “none known”.
- Assistant direct clinical calls return `403` before clinical read/write work. UI hiding is never the security boundary.
- Clinical prose never enters `localStorage`, session storage, logs, URLs, audit metadata, or client-generated identifiers.
- Domain modules expose only `index.ts`; application workflows import public interfaces, never private module files.
- Add no runtime dependency. Use Node `crypto`, existing `fast-json-stable-stringify`, and current UI primitives.
- Use `apply_patch` for handwritten files; use `npm run db:generate` only for Drizzle metadata.
- Each task follows RED → verify RED → minimal GREEN → relevant regression → commit.

## File and Responsibility Map

```text
careflow-pilot/
  drizzle/0003_clinical_record.sql + drizzle/meta/*
  src/shared/contracts.ts
  src/server/
    workflows/{clinical,clinical-routes}.ts
    modules/
      patient/{schema,service,routes,index}.ts      # Allergy ownership
      note/{schema,service,index}.ts                # Draft/signed/amendment
      medication/{schema,service,routes,index}.ts  # Catalog/decision/order
      visit/{schema,service,routes,index}.ts        # State/revision
      platform/{audit,evidence,permissions,index}.ts
    maintenance/reset-synthetic.ts
  src/client/
    features/{allergy,clinical,medications}.ts
    components/careflow/{AllergyReviewDialog,ClinicalNoteEditor,
      MedicationDecisionEditor,SignedClinicalEvidence}.tsx
    screens/{ConsultationScreen,QueueScreen,OverviewScreen}.tsx
    styles/pilot.css
  tests/server/{clinical-schema,allergy,medication,clinical-workflow}.test.ts
  tests/client/consultation.test.tsx
  tests/e2e/clinical-decision.spec.ts
```

---

### Task 1: Add Clinical Storage, Permissions, Audit Policies, and Reset Support

**Files:**
- Create: `careflow-pilot/src/server/modules/note/schema.ts`
- Create: `careflow-pilot/src/server/modules/note/index.ts`
- Create: `careflow-pilot/src/server/modules/medication/schema.ts`
- Create: `careflow-pilot/src/server/modules/medication/index.ts`
- Modify: `careflow-pilot/src/server/modules/patient/schema.ts`
- Modify: `careflow-pilot/src/server/modules/patient/index.ts`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/platform/{permissions,audit}.ts`
- Modify: `careflow-pilot/src/server/maintenance/reset-synthetic.ts`
- Create: `careflow-pilot/drizzle/0003_clinical_record.sql`
- Create: `careflow-pilot/drizzle/meta/0003_snapshot.json`
- Modify: `careflow-pilot/drizzle/meta/_journal.json`
- Create: `careflow-pilot/tests/server/clinical-schema.test.ts`
- Modify: `careflow-pilot/tests/server/{platform,reset-synthetic-data}.test.ts`

**Produces:**

```ts
export const allergyStateSchema = z.enum(["UNKNOWN", "NONE_KNOWN", "PRESENT"]);
export const allergySeveritySchema = z.enum(["UNKNOWN", "MILD", "MODERATE", "SEVERE"]);
export const medicationDecisionDraftKindSchema = z.enum(["UNDECIDED", "ORDER", "NO_MEDICATION"]);
export const medicationDecisionKindSchema = z.enum(["ORDER", "NO_MEDICATION"]);
export type AllergySeverity = z.infer<typeof allergySeveritySchema>;
export type VisitStatus = z.infer<typeof visitStatusSchema>;
```

Every new request/response TypeScript type is `z.infer<typeof exportedStrictSchema>`; interface-form snippets below define the required shape and must not become parallel handwritten wire types.

Add permissions `patient:update-allergy`, `clinical:read`, `clinical:save-draft`, `clinical:sign`, `clinical:amend`, `medication:read-catalog`, and `medication:sign-decision`. Assistant receives only `patient:update-allergy`; Doctor receives all seven.

Retain the existing required-reason `allergy.updated` policy. Add optional `note.draft-saved`, `note.signed`, `medication.decision-signed`, `visit.consultation-finalized`, plus required-reason `note.amendment-signed`, `medication.decision-revised`, and `visit.allergy-safety-changed`.

**Tables:**

```text
patient_allergy_revisions(id PK, patient_id FK, revision >=1,
  state UNKNOWN|NONE_KNOWN|PRESENT, source_text 1..500, reason 1..500,
  reviewed_by FK, reviewed_at, UNIQUE(patient_id,revision))
patient_allergy_items(id PK, allergy_revision_id FK, position >=0,
  substance 1..200, reaction 1..300,
  severity UNKNOWN|MILD|MODERATE|SEVERE, note NULL|<=500,
  UNIQUE(allergy_revision_id,position))

clinical_note_drafts(id PK, visit_id UNIQUE FK, revision >=1,
  subjective|objective|assessment|plan each 0..4000,
  created_by/updated_by FK, created_at/updated_at)
clinical_note_draft_diagnoses(id PK, draft_id FK ON DELETE CASCADE,
  position >=0, diagnosis_text 1..300, UNIQUE(draft_id,position))
clinical_notes(id PK, visit_id FK, version >=1,
  four SOAP fields each 1..4000, source_draft_revision >=1,
  signed_by FK, signed_at, content_hash 64 lowercase hex,
  UNIQUE(visit_id,version))
clinical_note_diagnoses(id PK, clinical_note_id FK, position >=0,
  diagnosis_text 1..300, UNIQUE(clinical_note_id,position))
clinical_note_amendments(id PK, clinical_note_id FK, version >=1,
  content 1..4000, reason 1..500, signed_by FK, signed_at,
  content_hash 64 lowercase hex, UNIQUE(clinical_note_id,version))

medications(id PK DEMO-MED-NNN, display_name 1..200,
  strength_text|dosage_form_text|canonical_unit 1..100,
  active 0|1, revision >=1, created_at/updated_at)
medication_decision_drafts(id PK, visit_id UNIQUE FK, revision >=1,
  kind UNDECIDED|ORDER|NO_MEDICATION, no_medication_reason NULL|<=500,
  created_by/updated_by FK, created_at/updated_at)
medication_order_draft_items(id PK, decision_draft_id FK ON DELETE CASCADE,
  position >=0, medication_id FK, medication_revision >=1,
  quantity 1..9999, directions_th 1..500,
  UNIQUE(decision_draft_id,position))
medication_decisions(id PK, visit_id FK, version >=1,
  kind ORDER|NO_MEDICATION, no_medication_reason NULL|1..500,
  revision_reason NULL|1..500, supersedes_id NULL|FK self,
  signed_by FK, signed_at,
  content_hash 64 lowercase hex, UNIQUE(visit_id,version))
medication_order_items(id PK, medication_decision_id FK, position >=0,
  medication_id FK, medication_revision >=1,
  display_name_snapshot|strength_snapshot|dosage_form_snapshot|unit_snapshot,
  quantity 1..9999, directions_th 1..500,
  UNIQUE(medication_decision_id,position))
```

- [ ] **Step 1: Write failing schema/permission/audit/reset tests**

```ts
it("seeds only repository-versioned synthetic medications", () => {
  expect(database.sqlite.prepare(
    "SELECT id, display_name, active, revision FROM medications ORDER BY id",
  ).all()).toEqual([
    { id: "DEMO-MED-001", display_name: "[DEMO] ยาทดสอบชนิด A", active: 1, revision: 1 },
    { id: "DEMO-MED-002", display_name: "[DEMO] ยาทดสอบชนิด B", active: 1, revision: 1 },
    { id: "DEMO-MED-003", display_name: "[DEMO] ยาทดสอบชนิด C", active: 1, revision: 1 },
    { id: "DEMO-MED-004", display_name: "[DEMO] ยาทดสอบชนิด D", active: 1, revision: 1 },
  ]);
});
```

Also assert all tables/checks/FKs, exact role arrays, audit reason policies, direct `UPDATE`/`DELETE` denial for every history/signed table, draft update allowance, reset removal of every patient-linked table, and catalog preservation.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/clinical-schema.test.ts tests/server/platform.test.ts tests/server/reset-synthetic-data.test.ts`

Expected: FAIL because the schema, permission, audit, trigger, and reset changes are absent.

- [ ] **Step 3: Implement Drizzle schemas and generate migration**

Create named checks/indexes/FKs exactly above and export tables only through module `index.ts`. Run:

```bash
cd careflow-pilot
npm run db:generate -- --name=clinical_record
```

Patch migration 0003 to seed four rows `DEMO-MED-001..004` with visibly synthetic names and no dosing recommendation.

Use these exact catalog snapshots so tests and the following Inventory milestone share stable identifiers:

```text
DEMO-MED-001 | [DEMO] ยาทดสอบชนิด A | 500 หน่วยทดสอบ   | เม็ดทดสอบ    | เม็ด
DEMO-MED-002 | [DEMO] ยาทดสอบชนิด B | 10 หน่วยทดสอบ    | แคปซูลทดสอบ | แคปซูล
DEMO-MED-003 | [DEMO] ยาทดสอบชนิด C | 5 หน่วยทดสอบ/มล. | ยาน้ำทดสอบ   | ขวด
DEMO-MED-004 | [DEMO] ยาทดสอบชนิด D | 1 หน่วยทดสอบ     | ซองทดสอบ     | ซอง
```

- [ ] **Step 4: Add storage immutability triggers**

For `clinical_notes`, `clinical_note_diagnoses`, `clinical_note_amendments`, `medication_decisions`, `medication_order_items`, `patient_allergy_revisions`, and `patient_allergy_items`, add named UPDATE and DELETE triggers:

```sql
CREATE TRIGGER `clinical_notes_block_update`
BEFORE UPDATE ON `clinical_notes`
BEGIN
  SELECT RAISE(ABORT, 'clinical_notes are append-only');
END;
```

Use the same exact pattern/table-specific message for all fourteen triggers.

- [ ] **Step 5: Extend guarded reset**

Add all tables to `expectedTables`. Drop only known append-only/audit triggers, delete child-to-parent drafts/evidence/Allergy before Intake/Visit/Patient, then delete audits with `WHERE action LIKE 'patient.%' OR action LIKE 'visit.%' OR action LIKE 'allergy.%' OR action LIKE 'note.%' OR action LIKE 'medication.%'`. Recreate exact triggers, verify zero patient-linked rows and four unchanged catalog rows, then retain canonical-schema/foreign-key/VACUUM checks.

- [ ] **Step 6: Run GREEN**

Run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/clinical-schema.test.ts tests/server/platform.test.ts tests/server/reset-synthetic-data.test.ts tests/server/database-artifacts.test.ts
npm run typecheck:server
npm run lint
```

Expected: all selected checks PASS; both fresh and 0002 databases migrate to 0003.

- [ ] **Step 7: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): add clinical evidence schema"
```

---

### Task 2: Implement Append-Only Allergy Review and Snapshot Base

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/patient/{service,index}.ts`
- Modify: `careflow-pilot/src/server/modules/visit/{service,index}.ts`
- Create: `careflow-pilot/src/server/workflows/{clinical,clinical-routes}.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Create: `careflow-pilot/tests/server/allergy.test.ts`

**Produces:**

```ts
export type AllergyAssessmentDto = {
  id: string | null;
  revision: number;
  state: "UNKNOWN" | "NONE_KNOWN" | "PRESENT";
  items: Array<{ substance: string; reaction: string; severity: AllergySeverity; note: string | null }>;
  sourceText: string | null;
  reason: string | null;
  reviewedBy: { id: string; displayName: string } | null;
  reviewedAt: string | null;
};
export type VisitSummaryDto = {
  id: string; status: VisitStatus; revision: number;
  arrivedAt: string; startedAt: string | null;
};
export type ReviewAllergyPayload = {
  visitId: string;
  state: "UNKNOWN" | "NONE_KNOWN" | "PRESENT";
  items: AllergyAssessmentDto["items"];
  sourceText: string;
  reason: string;
};
export type ReviewAllergyBody = CommandBody<ReviewAllergyPayload,
  { patient: number; visit: number }>;
export type AllergyReviewResultDto = {
  patient: PatientDto; allergy: AllergyAssessmentDto; visit: VisitSummaryDto;
};

export interface PatientService {
  getAllergyAssessment(patientId: string): AllergyAssessmentDto;
  reviewAllergy(tx: AuditedTransaction, actor: Actor, patientId: string,
    expectedPatientRevision: number, payload: ReviewAllergyPayload):
    { patient: PatientDto; allergy: AllergyAssessmentDto };
}

export interface ClinicalWorkflow {
  reviewAllergy(tx: AuditedTransaction, actor: Actor, patientId: string,
    body: ReviewAllergyBody): AllergyReviewResultDto;
}
```

`ReviewAllergyBody` is strict `{expectedRevisions:{patient,visit},payload:{visitId,state,items,sourceText,reason}}`. `PRESENT` requires 1–20 strict items; `UNKNOWN` and `NONE_KNOWN` require zero. No row maps to `{id:null,revision:0,state:"UNKNOWN",items:[],sourceText:null,reason:null,reviewedBy:null,reviewedAt:null}`.

**HTTP:** `POST /api/patients/:patientId/allergy-revisions`, permission `patient:update-allergy`, idempotent operation `patient.review-allergy.v1`, response `201 {data:{patient,allergy,visit},replayed}`.

- [ ] **Step 1: Write failing state/revision/role tests**

```ts
it("appends NONE_KNOWN without coercing the initial UNKNOWN", async () => {
  expect(await readAllergy()).toMatchObject({ id: null, revision: 0, state: "UNKNOWN" });
  const response = await review({
    state: "NONE_KNOWN", items: [],
    sourceText: "คำให้การผู้ป่วยทดสอบ", reason: "ทบทวนก่อนตรวจ",
  });
  expect(response.json().data).toMatchObject({
    patient: { revision: 2 },
    allergy: { revision: 1, state: "NONE_KNOWN", items: [] },
  });
});
```

Cover PRESENT, explicit reviewed UNKNOWN, state/item mismatch `422`, replay/collision, stale Patient/Visit, one required-reason audit without clinical prose, byte-stable old revision, Assistant only WAITING, Doctor WAITING/CONSULTING, and Start-vs-review race with zero stale writes.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/allergy.test.ts`

Expected: FAIL because contracts/services/workflow/route do not exist.

- [ ] **Step 3: Implement append-only Patient service**

Under the supplied transaction: assert Patient revision, allocate `max(allergy revision)+1`, insert parent/items, update Patient with exact revision predicate, and append `allergy.updated`. Never update old Allergy rows and never put substance/reaction content in audit metadata.

- [ ] **Step 4: Compose state guard and route**

Visit public guard permits `(WAITING, Assistant|Doctor)` and `(CONSULTING, Doctor)` only. `ClinicalWorkflow.reviewAllergy` calls that guard then Patient service in the same transaction. Register the route in `server/app.ts` through `clinical-routes.ts`.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/allergy.test.ts tests/server/patient.test.ts tests/server/visit.test.ts tests/server/platform.test.ts
npm run typecheck:server
```

Expected: all selected tests PASS and current Intake/Start behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(patient): add versioned allergy review"
```

---

### Task 3: Add the Searchable Synthetic Medication Catalog

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/src/server/modules/medication/{service,routes}.ts`
- Modify: `careflow-pilot/src/server/modules/medication/index.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Create: `careflow-pilot/tests/server/medication.test.ts`

**Produces:**

```ts
export type MedicationDto = {
  id: string; displayName: string; strengthText: string;
  dosageFormText: string; canonicalUnit: string; revision: number;
};
export interface MedicationService {
  searchMedications(query: string): MedicationDto[];
  assertMedicationRevision(tx: AppTransaction, id: string,
    expectedRevision: number): MedicationDto;
}
```

`medicationSchema` is strict, ID matches `/^DEMO-MED-\d{3}$/`, text limits follow Task 1, and response is `{data:MedicationDto[]}` max 20. `GET /api/medications?q=DEMO` requires `medication:read-catalog`; query is trimmed 2–80 Unicode characters.

- [ ] **Step 1: Write failing boundary tests**

```ts
it("returns active synthetic entries and escapes wildcards", async () => {
  database.sqlite.prepare("UPDATE medications SET active=0 WHERE id='DEMO-MED-004'").run();
  expect((await search("DEMO")).json().data.map((row: MedicationDto) => row.id))
    .toEqual(["DEMO-MED-001", "DEMO-MED-002", "DEMO-MED-003"]);
  expect((await search("%_")).json().data).toEqual([]);
});
```

Cover 2/80 boundaries, deterministic display-name/ID ordering, 20 cap, Assistant `403`, anonymous `401`, Doctor `200`, inactive/not-found, and stale catalog revision.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/medication.test.ts`

Expected: FAIL because catalog service/route do not exist.

- [ ] **Step 3: Implement service and route**

Escape `\\`, `%`, `_`; search only ID/display/strength/form; filter active; order display then ID; limit 20. `assertMedicationRevision` rejects inactive/missing and uses `assertExpectedRevision(current, expected, "medication.<id>")`.

- [ ] **Step 4: Run GREEN**

Run: `cd careflow-pilot && npm run test:server -- tests/server/medication.test.ts tests/server/auth.test.ts && npm run typecheck:server`

Expected: PASS; responses contain no lot, stock, barcode, or price fields.

- [ ] **Step 5: Commit**

```bash
git add careflow-pilot
git commit -m "feat(medication): add synthetic catalog search"
```

---

### Task 4: Save SOAP, Diagnosis, and Medication Decision as One Draft

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/src/server/modules/note/service.ts`
- Modify: `careflow-pilot/src/server/modules/note/index.ts`
- Modify: `careflow-pilot/src/server/modules/medication/{service,index}.ts`
- Modify: `careflow-pilot/src/server/workflows/{clinical,clinical-routes}.ts`
- Create: `careflow-pilot/tests/server/clinical-workflow.test.ts`

**Consumes:** `MedicationService.assertMedicationRevision`, Visit `CONSULTING` guard, audited/idempotent transaction.

**Produces:**

```ts
export type ClinicalNoteDraftInput = {
  subjective: string; objective: string; assessment: string; plan: string;
  diagnoses: string[];
};
export type MedicationDecisionDraftInput =
  | { kind: "UNDECIDED" }
  | { kind: "ORDER"; items: Array<{ medicationId: string;
      medicationRevision: number; quantity: number; directionsTh: string }> }
  | { kind: "NO_MEDICATION"; noMedicationReason: string };
export type ClinicalNoteDraftDto = ClinicalNoteDraftInput & {
  id: string; visitId: string; revision: number;
  updatedBy: { id: string; displayName: string }; updatedAt: string;
};
type MedicationDecisionDraftBase = {
  id: string; visitId: string; revision: number;
  updatedBy: { id: string; displayName: string }; updatedAt: string;
};
export type MedicationDecisionDraftDto = MedicationDecisionDraftBase & (
  | { kind: "UNDECIDED"; noMedicationReason: null; items: [] }
  | { kind: "ORDER"; noMedicationReason: null; items: Array<{
      medication: MedicationDto; quantity: number; directionsTh: string }> }
  | { kind: "NO_MEDICATION"; noMedicationReason: string; items: [] }
);

export interface NoteService {
  getDraft(visitId: string): ClinicalNoteDraftDto | null;
  saveDraft(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedRevision: number, input: ClinicalNoteDraftInput): ClinicalNoteDraftDto;
}
export interface MedicationService {
  getDecisionDraft(visitId: string): MedicationDecisionDraftDto | null;
  saveDecisionDraft(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedRevision: number, input: MedicationDecisionDraftInput): MedicationDecisionDraftDto;
}
```

`SaveConsultationDraftBody` is strict `{expectedRevisions:{visit>=1,noteDraft>=0,medicationDraft>=0},payload:{note,medicationDecision}}`. SOAP strings max 4000; Diagnosis 1–300, max 20; order items max 20, quantity 1–9999, Thai directions 1–500. Draft save permits blank SOAP, zero Diagnoses, empty ORDER, and blank `noMedicationReason`; Task 5 blocks incomplete finalization.

**HTTP:** `POST /api/visits/:visitId/consultation-draft`, Doctor `clinical:save-draft`, operation `clinical.save-draft.v1`, response `200 {data:{note,medicationDecision},replayed}`.

- [ ] **Step 1: Write failing atomic-draft tests**

```ts
it("saves Note and ORDER draft without changing Visit", async () => {
  const response = await saveDraft({
    expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
    payload: {
      note: { subjective: "อาการทดสอบ", objective: "ผลตรวจทดสอบ",
        assessment: "ประเมินทดสอบ", plan: "แผนทดสอบ",
        diagnoses: ["การวินิจฉัยทดสอบ"] },
      medicationDecision: { kind: "ORDER", items: [{
        medicationId: "DEMO-MED-001", medicationRevision: 1,
        quantity: 10, directionsTh: "คำแนะนำทดสอบ" }] },
    },
  });
  expect(response.json().data).toMatchObject({
    note: { revision: 1 }, medicationDecision: { revision: 1, kind: "ORDER" },
  });
  expect(currentVisit()).toMatchObject({ status: "CONSULTING", revision: 2 });
});
```

Cover first save `0→1`, update `1→2`, stale each draft, stale Visit, stale/inactive catalog, replay/collision, Assistant `403`, illegal state, incomplete draft acceptance, extra-field rejection, one no-prose `note.draft-saved` audit, and injected Medication failure rolling back Note/Audit.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/clinical-workflow.test.ts -t draft`

Expected: FAIL because draft services/command are absent.

- [ ] **Step 3: Implement revisioned draft services**

For expected `0`, assert missing and insert revision `1`; otherwise update parent with exact revision and increment once. Replace only that draft's child rows, resolve every catalog revision before writing, and return ordered children plus updated actor/time. A miss returns `REVISION_CONFLICT` with `currentRevisions.noteDraft` or `.medicationDraft`.

- [ ] **Step 4: Compose atomic command**

Workflow requires Doctor, exact `CONSULTING` Visit revision, then calls both services under the supplied transaction and appends one metadata-only `note.draft-saved`. Register the route through `executeIdempotent` scoped to Visit.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/clinical-workflow.test.ts tests/server/medication.test.ts tests/server/visit.test.ts tests/server/platform.test.ts
npm run typecheck:server
```

Expected: PASS; signed tables and Visit state remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): save consultation drafts atomically"
```

---

### Task 5: Finalize Consultation as One Immutable Transaction

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/src/server/modules/platform/evidence.ts`
- Modify: `careflow-pilot/src/server/modules/platform/index.ts`
- Modify: `careflow-pilot/src/server/modules/note/{service,index}.ts`
- Modify: `careflow-pilot/src/server/modules/medication/{service,index}.ts`
- Modify: `careflow-pilot/src/server/modules/visit/{service,index}.ts`
- Modify: `careflow-pilot/src/server/workflows/{clinical,clinical-routes}.ts`
- Modify: `careflow-pilot/tests/server/{clinical-workflow,platform}.test.ts`

**Produces:**

```ts
export function hashEvidence(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
export interface NoteService {
  signDraft(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedDraftRevision: number): SignedClinicalNoteDto;
}
export interface MedicationService {
  signDecisionDraft(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedDraftRevision: number): SignedMedicationDecisionDto;
}
export interface VisitService {
  finalizeConsultation(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedRevision: number, decisionKind: "ORDER" | "NO_MEDICATION"):
    VisitSummaryDto;
}
export type SignedMedicationDecisionDto = {
  id: string; visitId: string; version: number;
  revisionReason: string | null; supersedesId: string | null;
  signedBy: { id: string; displayName: string };
  signedAt: string; contentHash: string;
} & (
  | { kind: "ORDER"; noMedicationReason: null; items: Array<MedicationDto & {
      quantity: number; directionsTh: string }> }
  | { kind: "NO_MEDICATION"; noMedicationReason: string; items: [] }
);
```

`SignedClinicalNoteDto` contains ID/Visit/version, four trimmed non-empty SOAP fields, 1–20 ordered Diagnoses, source draft revision, signer/time, and 64-hex hash; export it with `z.infer<typeof signedClinicalNoteSchema>`. `SignedMedicationDecisionDto` is a strict union: ORDER has 1–20 immutable catalog snapshot items and `noMedicationReason:null`; `NO_MEDICATION` has a non-empty `noMedicationReason` and `items:[]`. Both expose version, `revisionReason`, supersedes ID, signer/time, and hash. Initial decisions have `revisionReason:null`; Task 6 revisions require it.

`FinalizeConsultationBody` is strict `{expectedRevisions:{visit,patient,noteDraft,medicationDraft},payload:{}}`. Patient revision is the Allergy safety token because every Allergy change increments Patient.

**HTTP:** `POST /api/visits/:visitId/finalize-consultation`, permissions `clinical:sign` and `medication:sign-decision`, operation `clinical.finalize-consultation.v1`, response `{visit,clinicalNote,medicationDecision}`.

- [ ] **Step 1: Write failing finalization tests**

```ts
it.each([
  ["ORDER", "AWAITING_PREPARATION"],
  ["NO_MEDICATION", "AWAITING_CHARGE"],
] as const)("finalizes %s atomically to %s", async (kind, status) => {
  await saveCompleteDraft(kind);
  const response = await finalize({ expectedRevisions: {
    visit: 2, patient: 1, noteDraft: 1, medicationDraft: 1,
  }, payload: {} });
  expect(response.json().data.visit).toMatchObject({ status, revision: 3 });
  expect(response.json().data.clinicalNote.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(response.json().data.medicationDecision.kind).toBe(kind);
});
```

Cover blank each SOAP field, zero Diagnosis, UNDECIDED, empty ORDER, blank no-med reason, stale Patient after Allergy, stale Visit/drafts/catalog, Assistant `403`, wrong state, replay preserving IDs/hashes, key collision, and injected failure after Note, after decision, and before Visit transition. Every injected failure leaves signed/audit rows zero and Visit `CONSULTING/2`.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/clinical-workflow.test.ts -t finaliz`

Expected: FAIL because signing/hash/transition are absent.

- [ ] **Step 3: Implement canonical signed evidence**

Hash stable objects excluding the hash itself. Note hash includes all signed content/IDs/version/draft revision/signer/time. Medication hash includes decision metadata plus ordered snapshot items. Sign services revalidate complete drafts and current catalog revisions, insert immutable rows, and append `note.signed` / `medication.decision-signed`.

- [ ] **Step 4: Implement atomic Visit transition**

Use `WHERE id=? AND status='CONSULTING' AND revision=?`; increment once and choose ORDER→`AWAITING_PREPARATION`, NO_MEDICATION→`AWAITING_CHARGE`. Workflow checks Doctor and Patient revision, signs both aggregates, transitions Visit, and appends `visit.consultation-finalized` inside the idempotent transaction.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/clinical-workflow.test.ts tests/server/platform.test.ts tests/server/visit.test.ts tests/server/medication.test.ts
npm run typecheck:server
```

Expected: both paths PASS with stable hashes, one transition, and zero partial writes.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): finalize signed consultation atomically"
```

---

### Task 6: Add Amendments, Decision Revisions, and Allergy Safety Transition

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/{note,medication,visit}/service.ts`
- Modify: `careflow-pilot/src/server/workflows/{clinical,clinical-routes}.ts`
- Modify: `careflow-pilot/tests/server/{clinical-workflow,allergy}.test.ts`

**Produces:**

```ts
export type SignedDecisionInput =
  | { kind: "ORDER"; items: Array<{ medicationId: string;
      medicationRevision: number; quantity: number; directionsTh: string }> }
  | { kind: "NO_MEDICATION"; noMedicationReason: string };
export type ClinicalNoteAmendmentDto = {
  id: string; clinicalNoteId: string; version: number;
  content: string; reason: string;
  signedBy: { id: string; displayName: string };
  signedAt: string; contentHash: string;
};
export interface NoteService {
  signAmendment(tx: AuditedTransaction, actor: Actor, noteId: string,
    expectedAmendmentVersion: number, content: string, reason: string):
    ClinicalNoteAmendmentDto;
}
export interface MedicationService {
  signDecisionRevision(tx: AuditedTransaction, actor: Actor, visitId: string,
    expectedDecisionVersion: number, input: SignedDecisionInput,
    revisionReason: string): SignedMedicationDecisionDto;
}
```

Amend body is strict `{expectedRevisions:{amendment>=0},payload:{content:1..4000,reason:1..500}}`. Decision revision body is strict `{expectedRevisions:{visit,patient,medicationDecision},payload:{revisionReason:1..500,decision: ORDER-with-items | NO_MEDICATION-with-noMedicationReason}}`.

**HTTP:** `POST /api/clinical-notes/:noteId/amendments` (`clinical:amend`, `201`), and `POST /api/visits/:visitId/medication-decision-revisions` (`medication:sign-decision`, `201`), both idempotent/scoped.

- [ ] **Step 1: Write failing append/supersede/safety tests**

```ts
it("appends an amendment without changing the original hash", async () => {
  const before = signedNoteRow();
  const response = await amend({ expectedRevisions: { amendment: 0 },
    payload: { content: "ข้อมูลเพิ่มเติมทดสอบ", reason: "เพิ่มรายละเอียด" } });
  expect(response.json().data.version).toBe(1);
  expect(signedNoteRow()).toEqual(before);
});
```

Cover amendment stale/blank/Assistant/replay/collision/order/restart and direct mutation denial. Cover decision revision in exactly `AWAITING_ORDER_REVISION`, `AWAITING_PREPARATION`, `AWAITING_CHARGE`; deny all other states; test stale Visit/Patient/decision/catalog, old hash stability, reason audit, rollback, ORDER and NO_MED next states. Cover Doctor Allergy update from AWAITING_PREPARATION atomically moving to AWAITING_ORDER_REVISION; deny Assistant and AWAITING_CHARGE; injected transition failure rolls back Allergy/audits.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/clinical-workflow.test.ts tests/server/allergy.test.ts -t "amend|revision|safety"`

Expected: FAIL because append/revision/safety behavior is absent.

- [ ] **Step 3: Implement immutable versions**

Allocate `max(version)+1` under the supplied immediate transaction, assert expected version, insert independent hash evidence, set `supersedesId`, and append required-reason audits. Never update earlier signed rows.

- [ ] **Step 4: Implement exact transitions**

Decision revision accepts only the three states above, then ORDER→AWAITING_PREPARATION or NO_MEDICATION→AWAITING_CHARGE with one Visit revision. Allergy after current signed ORDER at AWAITING_PREPARATION appends Patient history and moves Visit to AWAITING_ORDER_REVISION in the same transaction; next milestone will attach artifact invalidation/reservation release here.

- [ ] **Step 5: Run GREEN**

Run: `cd careflow-pilot && npm run test:server -- tests/server/clinical-schema.test.ts tests/server/allergy.test.ts tests/server/medication.test.ts tests/server/clinical-workflow.test.ts && npm run typecheck:server`

Expected: PASS; no old signed row changes.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): append amendments and decision revisions"
```

---

### Task 7: Expand Clinical Read Models, Queue State, Restart, and Reset Proof

**Files:**
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/server/modules/{patient,note,medication,visit}/service.ts`
- Modify: `careflow-pilot/src/server/modules/visit/routes.ts`
- Modify: `careflow-pilot/src/server/workflows/{clinical,clinical-routes}.ts`
- Modify: `careflow-pilot/src/server/maintenance/reset-synthetic.ts`
- Modify: `careflow-pilot/tests/server/{visit,restart,reset-synthetic-data}.test.ts`

**Produces:**

```ts
export type SnapshotSource = {
  type: "ALLERGY_REVIEW" | "INTAKE" | "CLINICAL_NOTE" | "MEDICATION_DECISION";
  id: string; occurredAt: string;
};
export type SnapshotFact<T> =
  | { state: "UNKNOWN"; value: null; source: null }
  | { state: "VALUE"; value: T; source: SnapshotSource };
export type PatientSnapshotDto = {
  allergy: AllergyAssessmentDto;
  activeProblems: SnapshotFact<string[]>;
  currentMedicationContext: SnapshotFact<string[]>;
  latestRelevantPlan: SnapshotFact<string>;
  pendingFollowUp: SnapshotFact<string>;
  recentVisits: Array<{ visitId: string; noteId: string; signedAt: string;
    diagnoses: string[]; plan: string }>;
};
export type VisitWorkspaceBaseDto = {
  visit: VisitSummaryDto;
  patient: PatientDto;
  intake: {
    id: string; chiefComplaint: string; vitals: IntakePayload["vitals"];
    recordedAt: string;
    recordedBy: { id: string; displayName: string };
  };
};
export type VisitWorkspaceDto = {
  visit: VisitSummaryDto; patient: PatientDto;
  intake: VisitWorkspaceBaseDto["intake"];
  patientSnapshot: PatientSnapshotDto;
  consultationDraft: { note: ClinicalNoteDraftDto | null;
    medicationDecision: MedicationDecisionDraftDto | null };
  signedClinicalNote: SignedClinicalNoteDto | null;
  amendments: ClinicalNoteAmendmentDto[];
  medicationDecision: SignedMedicationDecisionDto | null;
  allowedActions: Array<"START_CONSULTATION" | "REVIEW_ALLERGY" |
    "SAVE_DRAFT" | "FINALIZE_CONSULTATION" | "AMEND_NOTE" |
    "REVISE_MEDICATION_DECISION">;
};
```

Clinical actions: `START_CONSULTATION`, `REVIEW_ALLERGY`, `SAVE_DRAFT`, `FINALIZE_CONSULTATION`, `AMEND_NOTE`, `REVISE_MEDICATION_DECISION`. Queue actions: `START_CONSULTATION`, `REVIEW_ALLERGY`, `OPEN_CONSULTATION`.

Queue pending statuses are exactly WAITING, CONSULTING, AWAITING_ORDER_REVISION, AWAITING_PREPARATION, AWAITING_CHARGE. Each Queue item includes current Allergy. Dashboard fields are `waiting`, `consulting`, `awaitingOrderRevision`, `awaitingPreparation`, `awaitingCharge`, `updatedAt`.

- [ ] **Step 1: Write failing read/recovery tests**

```ts
it("returns explicit UNKNOWN facts with null values and sources", async () => {
  expect((await workspace()).json().data.patientSnapshot).toMatchObject({
    activeProblems: { state: "UNKNOWN", value: null, source: null },
    currentMedicationContext: { state: "UNKNOWN", value: null, source: null },
    latestRelevantPlan: { state: "UNKNOWN", value: null, source: null },
    pendingFollowUp: { state: "UNKNOWN", value: null, source: null },
  });
});
```

Cover signed Diagnosis→activeProblems, Plan→latestRelevantPlan, ORDER→currentMedicationContext, source IDs/times, recent Visit order/max 5, workspace after finalization, Assistant `403`, queue Allergy provenance/actions/order, all five dashboard counts, Thai day boundary, and closed exclusion.

Extend real-file restart to compare Note/decision hashes and versions, Allergy/Patient/Visit revisions, amendment order, and Audit IDs before/after reopen. Populate every new table before reset; verify zero patient-linked rows, unchanged catalog, and restored triggers.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:server -- tests/server/visit.test.ts tests/server/restart.test.ts tests/server/reset-synthetic-data.test.ts`

Expected: FAIL because composed reads/new states/recovery proof are incomplete.

- [ ] **Step 3: Compose workspace through public module reads**

Define `VisitWorkspaceBaseDto` as the existing Visit/Patient/Intake workspace shape without clinical evidence. Move `GET /api/visits/:visitId/workspace` registration from Visit routes to Clinical routes. `ClinicalWorkflow.getWorkspace` reads that base plus Patient/Allergy, drafts, signed Note/amendments, and current decision. Map committed evidence to Snapshot; pending follow-up stays UNKNOWN because this milestone has no structured source. Permit Doctor reads for WAITING, CONSULTING, and the three new pending states.

- [ ] **Step 4: Expand Queue and Dashboard**

Order states WAITING→CONSULTING→AWAITING_ORDER_REVISION→AWAITING_PREPARATION→AWAITING_CHARGE, then arrival/ID. Actions:

```text
WAITING Assistant: REVIEW_ALLERGY
WAITING Doctor: START_CONSULTATION, REVIEW_ALLERGY
CONSULTING or later pending Doctor: OPEN_CONSULTATION
all other role/state combinations: no action
```

Use Patient public batch Allergy reads; persist no action arrays. Count only committed Visit states; add no stock, charge amount, payment, or analytics fields.

- [ ] **Step 5: Run GREEN**

Run: `cd careflow-pilot && npm run test:server && npm run typecheck:server && npm run lint`

Expected: full server suite PASS, including restart and reset.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): expose restart-safe clinical workspace"
```

---

### Task 8: Build the Doctor Clinical Authoring Workspace

**Files:**
- Modify: `careflow-pilot/src/client/app/query-client.ts`
- Create: `careflow-pilot/src/client/features/{allergy,clinical,medications}.ts`
- Modify: `careflow-pilot/src/client/features/visit.ts`
- Create: `careflow-pilot/src/client/components/careflow/AllergyReviewDialog.tsx`
- Create: `careflow-pilot/src/client/components/careflow/ClinicalNoteEditor.tsx`
- Create: `careflow-pilot/src/client/components/careflow/MedicationDecisionEditor.tsx`
- Create: `careflow-pilot/src/client/components/careflow/SignedClinicalEvidence.tsx`
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Create: `careflow-pilot/tests/client/consultation.test.tsx`
- Modify: `careflow-pilot/tests/client/router.test.tsx`

**Produces:**

```ts
export type ConsultationFormValue = SaveConsultationDraftBody["payload"];
export type SaveDraftAttempt = CommandAttempt<
  SaveConsultationDraftBody["payload"], SaveConsultationDraftBody["expectedRevisions"]>;
export type FinalizeAttempt = CommandAttempt<Record<string, never>,
  FinalizeConsultationBody["expectedRevisions"]>;
export function createSaveDraftAttempt(workspace: VisitWorkspaceDto,
  value: ConsultationFormValue): SaveDraftAttempt;
export function createFinalizeAttempt(workspace: VisitWorkspaceDto): FinalizeAttempt;
```

Add typed hooks for workspace, save, finalize, amendment, decision revision, Allergy review, and medication search. Add query key `medicationSearch(q)`; keep `visit(id)` canonical. Successful commands update/invalidate Visit, Queue, Dashboard. Mutations do not auto-retry; uncertain same-body retry reuses one attempt key.

- [ ] **Step 1: Write failing Doctor UI tests**

```tsx
it("renders UNKNOWN Allergy and four labeled SOAP fields", async () => {
  renderRoute("/consultations/visit-42");
  expect(await screen.findByText("UNKNOWN")).toBeInTheDocument();
  expect(screen.getByLabelText("Subjective (ข้อมูลจากผู้ป่วย)")).toBeInTheDocument();
  expect(screen.getByLabelText("Objective (ผลตรวจ)")).toBeInTheDocument();
  expect(screen.getByLabelText("Assessment (การประเมิน)")).toBeInTheDocument();
  expect(screen.getByLabelText("Plan (แผนการดูแล)")).toBeInTheDocument();
});
```

Cover provenance, Allergy dialog, catalog search/selection, quantity/directions, explicit ORDER vs NO_MEDICATION and reason, no implicit decision, draft reload, field errors, pending buttons, keyboard confirmation, finalize state, signed read-only evidence, amendment/revision, same-key uncertain retry, conflict retaining text but blocking sign until reload, Assistant denial without workspace/catalog request, and no browser-storage writes.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/consultation.test.tsx tests/client/router.test.tsx`

Expected: FAIL because the screen is read-only.

- [ ] **Step 3: Implement typed feature hooks**

Decode every response through shared strict schemas. Build revisions only from workspace DTO. On conflict clear attempt, keep form values, show Thai current-revision message, and require successful refetch before sign. Never put form state in URL/storage.

- [ ] **Step 4: Build focused components**

Allergy editor exposes UNKNOWN/NONE_KNOWN/PRESENT explicitly. Note editor exposes four SOAP fields and ordered free-text Diagnoses. Medication editor exposes only “สั่งยาจากรายการทดสอบ” or NO_MEDICATION and its required inputs. Signed evidence shows signer/time/version/hash plus separate amendment/revision controls. Components accept values/callbacks/errors; no new form/global-state dependency.

- [ ] **Step 5: Recompose Stitch Consultation**

Preserve 252px Patient rail, 1120px canvas, vitals/cards, and sticky actions. Add source badges and UNKNOWN alert. Sign confirmation summarizes Diagnoses and chosen decision. After signing show truthful links to unavailable Dispensing/Checkout, or revision action for AWAITING_ORDER_REVISION.

- [ ] **Step 6: Run GREEN**

Run: `cd careflow-pilot && npm run test:client -- tests/client/consultation.test.tsx tests/client/router.test.tsx tests/client/auth.test.tsx && npm run typecheck:client && npm run lint`

Expected: PASS with 48px controls, labels/focus, mobile stack, and no horizontal-overflow CSS.

- [ ] **Step 7: Commit**

```bash
git add careflow-pilot
git commit -m "feat(clinical): enable doctor consultation authoring"
```

---

### Task 9: Connect Assistant Allergy Review and Role-Aware Pending Work

**Files:**
- Modify: `careflow-pilot/src/client/screens/{QueueScreen,OverviewScreen}.tsx`
- Modify: `careflow-pilot/src/client/features/{queue,dashboard}.ts`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Modify: `careflow-pilot/tests/client/{queue,router}.test.tsx`

**Produces:** five Queue groups: WAITING “รอพบแพทย์”, CONSULTING “กำลังตรวจ”, AWAITING_ORDER_REVISION “รอทบทวนคำสั่งยา”, AWAITING_PREPARATION “รอจัดยา”, AWAITING_CHARGE “รอคิดเงิน”. Controls render only from exact server `allowedActions`.

- [ ] **Step 1: Write failing role/pending tests**

```tsx
it("lets Assistant review WAITING Allergy without a clinical link", async () => {
  const row = within(await screen.findByRole("article", { name: /DEMO-000042/ }));
  expect(row.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" })).toBeInTheDocument();
  expect(row.queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
});
```

Cover both WAITING roles, all five states, Doctor OPEN after finalize, Assistant no clinical link in every state, exact Allergy POST revisions/key/body, value retention on network error, conflict reload, success invalidation, stale Queue disabling action, and dashboard all five counts with no future commands.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run test:client -- tests/client/queue.test.tsx tests/client/router.test.tsx`

Expected: FAIL because Queue/dashboard do not support new DTO/actions.

- [ ] **Step 3: Implement Assistant review and pending groups**

Use shared Allergy hook/dialog with Queue Patient/Visit/Allergy revisions; never fetch Doctor workspace. On success invalidate Queue/dashboard; on conflict retain values and block resubmit until Queue reload. Render non-empty groups in fixed state order and disable every mutation for stale cached Queue.

- [ ] **Step 4: Expand Overview operational metrics**

Show five state counts and existing role-aware primary action. Add no money, stock quantity, disease trend, or monthly chart.

- [ ] **Step 5: Run GREEN**

Run: `cd careflow-pilot && npm run test:client && npm run typecheck:client && npm run lint`

Expected: full client suite PASS; role workspaces remain visibly distinct.

- [ ] **Step 6: Commit**

```bash
git add careflow-pilot
git commit -m "feat(pilot): connect allergy review and pending work"
```

---

### Task 10: Prove Both Paths, Update Operations Docs, and Run the Milestone Gate

**Files:**
- Create: `careflow-pilot/tests/e2e/clinical-decision.spec.ts`
- Modify: `careflow-pilot/tests/e2e/{responsive.spec,fixtures}.ts`
- Modify: `careflow-pilot/README.md`
- Modify: `README.md`

**Journeys:**

```text
ORDER: Assistant Patient A→Intake→NONE_KNOWN Allergy;
Doctor Start→complete draft→DEMO-MED-001 quantity/directions→Sign;
AWAITING_PREPARATION→reload keeps hashes/revisions→Assistant sees “รอจัดยา”.

NO_MEDICATION: Assistant Patient B→Intake;
Doctor Start→reviewed UNKNOWN Allergy→complete draft→NO_MEDICATION reason→Sign;
AWAITING_CHARGE→reload keeps hashes/revisions→Assistant sees “รอคิดเงิน”.
```

- [ ] **Step 1: Write failing Playwright journeys**

Create isolated Assistant/Doctor contexts, operate visible controls, compare signed hash text before/after reload, and assert shared Queue/dashboard. Use Assistant `page.request` to assert workspace `403`, then direct-navigate and assert no clinical content.

- [ ] **Step 2: Run RED**

Run: `cd careflow-pilot && npm run build && npx playwright test tests/e2e/clinical-decision.spec.ts`

Expected: FAIL at the first missing integrated clinical behavior.

- [ ] **Step 3: Fix only evidenced integration gaps**

For each discovered bug, add a focused failing unit/integration assertion in its owning test before changing production code. Do not add Inventory, Finance, or analytics to satisfy E2E.

- [ ] **Step 4: Extend viewport/keyboard acceptance**

At 375, 768, 1440px assert no overflow; mobile Patient rail stack; visible SOAP/Allergy/medication labels; reachable sticky actions; actual action height >=48px; Tab/Space/Enter operation; and exactly one Pilot banner.

- [ ] **Step 5: Update truthful README operations**

Document enabled synthetic clinical features and two-browser rehearsal. Keep Inventory, Dispense, Finance, close, backup deployment, HTTPS/Caddy, and real Patient data explicitly disabled.

- [ ] **Step 6: Run complete fresh verification**

Invoke `superpowers:verification-before-completion`, then:

```bash
cd careflow-pilot
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
git diff --check
```

From the repository root run the frozen visual-demo regression and prove no tracked source diff:

```bash
cd careflow-webapp
npm test
npm run typecheck
npm run build
cd ..
git diff --exit-code -- careflow-webapp
```

- [ ] **Step 7: Perform real-browser and local-host QA**

Inspect Doctor/Assistant desktop and phone journeys against Stitch. Before restarting the user's host, identify the exact listener/database opener; stop gracefully and wait for the running lock to disappear. Start the build and verify `GET http://127.0.0.1:3001/api/health` returns `{"status":"ok","database":"ready"}`. Remove only an empty exact stale lock after proving no listener/opener; never delete SQLite/WAL/SHM.

- [ ] **Step 8: Commit**

```bash
git add README.md careflow-pilot
git commit -m "test(pilot): prove clinical decision milestone"
```

---

## Requirement-to-Task Traceability

| Requirement | Tasks |
|---|---|
| Stitch UI/CSS and role-focused workspace | 8–10 |
| Source-linked Snapshot and explicit UNKNOWN | 2, 7, 8 |
| Append-only Allergy and state rules | 1, 2, 6, 9 |
| SOAP/Diagnosis draft | 4, 8 |
| Signed Note immutability and amendment | 1, 5, 6 |
| Synthetic catalog reused by Inventory later | 1, 3 |
| Exactly ORDER or NO_MEDICATION | 4, 5 |
| Atomic Finalize and Visit transition | 5 |
| Decision revision/invalidation entry | 6 |
| Assistant API denial | 2–10 |
| Idempotency/revision/audit/rollback | 2, 4–7 |
| Queue/dashboard from committed state | 7, 9 |
| Restart and guarded reset | 1, 7, 10 |
| Responsive/browser acceptance | 8–10 |
| Inventory/Finance/analytics deferred | Global Constraints, 7, 9, 10 |

## Milestone Definition of Done

- [ ] Every Task 1–10 RED test failed for the intended missing behavior before production code.
- [ ] ORDER and NO_MEDICATION persist signed evidence and correct pending state after reload/restart.
- [ ] Signed Note/Diagnosis/amendment/decision/Order/Allergy history cannot be overwritten by API or direct SQL.
- [ ] Assistant never receives Doctor clinical data/actions; no role impersonation exists.
- [ ] Queue, dashboard, Snapshot, hashes, audits, and revisions come from SQLite and survive restart.
- [ ] Reset removes all patient-linked clinical data and preserves Clinic/Staff plus synthetic catalog.
- [ ] Lint, typecheck, tests, build, Playwright, frozen-demo, diff check, and real-browser QA pass freshly.
- [ ] Inventory, Finance, close, analytics, production readiness, and real Patient use remain unavailable.

## Execution Boundary

Implement Tasks 1→10 in order. Do not start Medication/Inventory Safety until this milestone is green and reviewed; the next plan attaches lots, FEFO reservation, preparation, Label/release, handoff, Dispense, and stock movement to these signed decision versions.
