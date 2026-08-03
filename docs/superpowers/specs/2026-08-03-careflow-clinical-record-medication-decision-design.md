# CareFlow Clinical Record and Medication Decision — Design Specification

**Status:** The Clinical vertical-slice direction was approved in conversation on 3 August 2026. This written specification is awaiting the user's review before implementation planning.

**Milestone:** Local Pilot milestone 2 of 5

**Safety boundary:** Synthetic Patient and medication data only. This milestone does not authorize real clinical use.

## 1. Goal

Turn the existing Doctor Consultation workspace from a read-only handoff into a complete, server-backed clinical vertical slice. A Doctor must be able to review a source-linked Patient Snapshot, review or revise Allergy information, save a consultation draft, record SOAP and Diagnosis, explicitly choose a synthetic Medication Order or `NO_MEDICATION`, and finalize the Consultation atomically.

The resulting signed Clinical Note and medication decision are immutable evidence shared by every browser session and preserved across Clinic Host restarts. The existing Stitch composition, React component library, CSS tokens, responsive behavior, and role-focused workspaces remain the visual foundation.

## 2. Source of Truth

The following sources control this milestone in priority order:

1. `docs/superpowers/specs/2026-08-03-careflow-pilot-design.md` controls Local Pilot safety, workflow, state transitions, roles, audit, and acceptance criteria.
2. `docs/superpowers/plans/2026-08-03-careflow-local-pilot-foundation.md` controls module boundaries and identifies this milestone as “Clinical Record and Medication Decision”.
3. `docs/superpowers/specs/2026-08-03-careflow-role-focused-workspaces-design.md` controls role-specific routing and clinical access.
4. `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md` controls typography, color, spacing, touch targets, and “one screen, one job”.
5. `stitch_careflow_clinic_management_system/consultation_room_doctor/code.html` and `screen.png` control the Doctor Consultation composition.
6. `/Users/ajbk/Downloads/careflow-implementation-plan.md` remains background architecture guidance only where it does not conflict with the approved repository specifications.

## 3. Scope

This milestone includes:

- A Doctor-only clinical workspace assembled from committed Patient, Visit, Intake, Allergy, Note, Diagnosis, and medication-decision data.
- An explicit Patient Snapshot that distinguishes `UNKNOWN`, “reviewed and none known”, and recorded values.
- Append-only, source-linked Allergy revisions with Assistant/Doctor state rules and optimistic concurrency.
- An explicit Save Draft command for SOAP, Diagnosis, and the pending medication decision.
- A signed Clinical Note that cannot be updated or deleted.
- Signed, append-only Clinical Note amendments that never alter the original note.
- A small repository-versioned synthetic Medication catalog for safe selection in the Pilot.
- A versioned signed Medication Order or signed `NO_MEDICATION`; exactly one is required.
- One atomic Finalize Consultation command that signs the Clinical Note and medication decision, audits the action, and advances the Visit.
- A Doctor-only medication-decision revision command that is ready for the next milestone's invalidation/reservation consequences.
- Queue, dashboard, reset, restart, and browser behavior updated for the newly reachable Visit states.

This milestone does not include inventory lots, stock balances, FEFO, reservations, Label versions, preparation, barcode confirmation, release, Dispense, Charge, Payment, Visit close, OPD Card, backup deployment, or real Patient data.

## 4. Options Considered

### Option A — Clinical vertical slice with a minimal synthetic catalog

Build Snapshot, Allergy, draft/sign/amend Note, Diagnosis, a small synthetic catalog, Medication Order/`NO_MEDICATION`, and atomic finalization together. Inventory continues in the next milestone using the same medication identifiers. This is selected because it finishes one truthful clinical decision boundary without pulling stock and dispensing into the same change.

### Option B — Note and `NO_MEDICATION` first

This is smaller, but the medication path remains unusable and the next milestone starts without a stable signed-order contract. Rejected because it does not complete the approved milestone.

### Option C — Add full Inventory now

This would enable dispensing earlier, but combines clinical evidence, catalog, lots, FEFO, reservation races, release, and atomic stock-out in one implementation cycle. Rejected because its failure modes and acceptance tests require an independent milestone.

## 5. Architecture and Module Boundaries

The application remains one Fastify modular monolith, one canonical SQLite writer, and one React client.

### Patient module

The Patient module owns Allergy revisions and exposes read/update operations through its public `index.ts`. It returns a source-linked Allergy snapshot and increments the Patient revision whenever the Allergy assessment changes.

### Note module

The new Note module owns mutable Clinical Note drafts, draft Diagnosis items, immutable signed Notes, immutable signed Diagnosis snapshots, and immutable amendments. Other modules import only `note/index.ts`.

### Medication module

The new Medication module owns the synthetic catalog, medication-decision drafts, immutable signed medication decisions, and immutable signed Order-item snapshots. Inventory will later reference the same stable `medications.id`; it will not replace or reinterpret signed Order snapshots.

### Visit module

The Visit module remains the owner of Visit state and revision. It exposes transaction-aware public transitions for Finalize Consultation, Allergy safety changes, and medication-decision revision. No other module writes the `visits` table directly.

### Application workflow layer

Cross-module commands are coordinated in an application-layer clinical workflow built by `server/app.ts`. A focused `server/workflows/clinical.ts` may hold the coordinator implementation so `app.ts` remains composition rather than business logic. This workflow imports module public interfaces only, receives one `AuditedTransaction`, and never opens a second transaction.

The module-boundary lint rule expands only to recognize `server/workflows/*` as application composition. Private cross-module imports remain forbidden.

## 6. Data Model

All timestamps are UTC ISO strings. User-facing dates render in `Asia/Bangkok` with Buddhist Era formatting. All IDs are server-generated.

### 6.1 Allergy assessment revisions

`patient_allergy_revisions` stores a complete append-only assessment of the Patient's Allergy state:

- `id`, `patient_id`, and monotonic `revision`
- `state`: `UNKNOWN`, `NONE_KNOWN`, or `PRESENT`
- `source_text`, `reason`, `reviewed_by`, and `reviewed_at`

`patient_allergy_items` stores zero or more items for a `PRESENT` revision:

- `id`, `allergy_revision_id`
- `substance`, `reaction`, `severity`, and `note`
- `severity`: `UNKNOWN`, `MILD`, `MODERATE`, or `SEVERE`

No Allergy row means the initial state is unreviewed `UNKNOWN`; it never means “no known Allergy”. An explicit `UNKNOWN` revision means the history was reviewed but remains unknown and therefore carries provenance. `NONE_KNOWN` requires an explicit review with source, actor, timestamp, and reason. A new assessment inserts a new parent and child set and increments `patients.revision`; old rows are never updated.

### 6.2 Clinical Note draft and signed evidence

`clinical_note_drafts` contains one mutable draft per Visit:

- `id`, `visit_id`, `revision`
- `subjective`, `objective`, `assessment`, and `plan`
- `created_by`, `created_at`, `updated_by`, and `updated_at`

`clinical_note_draft_diagnoses` contains ordered free-text Diagnosis entries. This milestone does not claim ICD-10 terminology validation or provide an external terminology integration.

`clinical_notes` contains the immutable signed snapshot:

- `id`, `visit_id`, `version`
- the four SOAP fields copied from the accepted draft
- `source_draft_revision`, `signed_by`, `signed_at`, and `content_hash`

`clinical_note_diagnoses` contains the ordered Diagnosis snapshot linked to the signed Note.

`clinical_note_amendments` contains append-only signed additions:

- `id`, `clinical_note_id`, monotonic `version`
- `content`, `reason`, `signed_by`, `signed_at`, and `content_hash`

An amendment is a new signed statement. It is never a patch or overwrite of the original SOAP fields.

### 6.3 Synthetic Medication catalog

`medications` contains a small repository-versioned catalog:

- stable ID/code such as `DEMO-MED-001`
- clearly synthetic Thai display name
- strength text, dosage-form text, canonical unit, active flag, and revision

Catalog entries are marked as demonstration data and contain no real Patient information. The catalog survives synthetic Patient reset because it is versioned configuration. Lot, expiry, barcode, inventory disposition, and stock quantity are deferred.

### 6.4 Medication decision draft and signed evidence

`medication_decision_drafts` contains one mutable choice per Visit:

- `id`, `visit_id`, `revision`
- `kind`: `UNDECIDED`, `ORDER`, or `NO_MEDICATION`
- `no_medication_reason` when applicable
- `created_by`, `created_at`, `updated_by`, and `updated_at`

`medication_order_draft_items` contains ordered `ORDER` items with catalog ID/revision, integer quantity in the catalog's canonical unit, and Thai directions.

`medication_decisions` contains the immutable signed decision:

- `id`, `visit_id`, monotonic `version`
- `kind`: `ORDER` or `NO_MEDICATION`
- `reason`, `supersedes_id`, `signed_by`, `signed_at`, and `content_hash`

`medication_order_items` contains immutable snapshots for `ORDER` decisions:

- source medication ID and revision
- display name, strength, dosage form, and canonical unit copied at signing
- integer quantity and Thai directions copied from the accepted draft

An `ORDER` requires at least one valid item and no `NO_MEDICATION` reason. `NO_MEDICATION` requires a reason and zero items. These constraints are enforced by the service transaction and covered by database checks where SQLite can express them safely.

### 6.5 Storage immutability

SQLite triggers reject update/delete operations against signed Notes, signed Diagnoses, amendments, signed medication decisions, signed Order items, and Allergy history. Draft tables remain mutable through revision-checked services. The guarded synthetic reset explicitly drops and restores only the known immutability/audit triggers while the Clinic Host is stopped, then verifies the canonical schema and zero patient-linked rows.

## 7. Patient Snapshot Contract

The clinical workspace returns a derived Snapshot, not a second writable source of truth:

- Patient identity and current Patient revision
- current Allergy assessment with state, items, source, reviewer, and reviewed time
- committed Intake/vitals with source actor and time
- latest signed Diagnosis list, latest signed Plan, and latest signed medication decision when history exists
- `UNKNOWN` placeholders for current medication context, active problems, latest relevant plan, or pending follow-up when no committed source exists
- a recent-Visit timeline based only on committed signed evidence

Every non-identity Snapshot item includes a source type, source ID, and occurred/reviewed time. Missing values are never silently omitted or rendered as an empty string.

## 8. Commands and State Transitions

Every command requires authentication, permission, an idempotency key, strict request validation, and all relevant expected revisions.

### 8.1 Review Allergy

`POST /api/patients/:patientId/allergy-revisions`

- Assistant may submit only while the active Visit is `WAITING`.
- Doctor may submit while the Visit is `WAITING` or `CONSULTING`.
- After an `ORDER` decision is signed but before handoff, a Doctor Allergy change creates a new Allergy revision and moves the Visit to `AWAITING_ORDER_REVISION` in the same transaction.
- This milestone does not permit Allergy changes from `AWAITING_CHARGE` or after handoff; the API returns `INVALID_STATE` rather than weakening future evidence rules.
- A stale Patient or Visit revision commits nothing.

The Assistant Queue exposes a focused “ทบทวนข้อมูลแพ้ยา” action only for a `WAITING` Visit. The Doctor edits the same aggregate inside the Consultation workspace. Both surfaces use the same API and revision contract; neither owns a browser-only copy.

The transition to `AWAITING_ORDER_REVISION` is the stable invalidation entry point. The next milestone will add Label/preparation/release invalidation and reservation return inside this same application workflow transaction.

### 8.2 Save Consultation draft

`POST /api/visits/:visitId/consultation-draft`

- Doctor only; Visit must be `CONSULTING`.
- Saves SOAP, ordered Diagnosis entries, and the medication-decision draft atomically.
- Uses expected Visit, Note-draft, and medication-draft revisions.
- It does not change Visit state and does not create signed evidence.
- The UI uses an explicit Save Draft action; this milestone does not autosave or store clinical content in `localStorage`.

### 8.3 Finalize Consultation

`POST /api/visits/:visitId/finalize-consultation`

- Doctor only; Visit must be `CONSULTING`.
- Requires non-empty Subjective, Objective, Assessment, Plan, at least one Diagnosis, and exactly one valid medication decision.
- Requires current Visit, Patient, Note-draft, medication-draft, and referenced catalog revisions. Because every Allergy change increments the Patient revision, the Patient expectation is also the safety-fact concurrency token. An unreviewed `UNKNOWN` Allergy is displayed explicitly but does not invent an additional clinical blocking rule absent from the approved PRD.
- In one transaction it creates the signed Note and Diagnosis snapshots, creates the signed medication decision and optional Order items, advances the Visit revision/state, and appends audit evidence.
- `ORDER` advances to `AWAITING_PREPARATION`.
- `NO_MEDICATION` advances to `AWAITING_CHARGE`.
- Any failure rolls back every row and the Visit remains `CONSULTING`.
- Retry with the same idempotency key and identical body returns the original response; key reuse with a different body returns `IDEMPOTENCY_CONFLICT`.

### 8.4 Sign Note amendment

`POST /api/clinical-notes/:noteId/amendments`

- Doctor only; the original Note must already be signed.
- Requires non-empty amendment content and reason plus the current amendment-history revision/version.
- Appends one immutable amendment and audit event without modifying Note bytes or Visit state.

### 8.5 Sign medication-decision revision

`POST /api/visits/:visitId/medication-decision-revisions`

- Doctor only; allowed in exactly `AWAITING_ORDER_REVISION`, `AWAITING_PREPARATION`, or `AWAITING_CHARGE` before any downstream artifact or finalized Charge exists.
- Requires a reason, current Visit/Patient/decision revisions, and exactly one new `ORDER` or `NO_MEDICATION` decision.
- Creates a new signed decision version with `supersedes_id`; the old decision remains immutable.
- `ORDER` advances to `AWAITING_PREPARATION`; `NO_MEDICATION` advances to `AWAITING_CHARGE`.
- The next milestone will attach atomic artifact invalidation/reservation release to this same command before preparation becomes available.

## 9. Read APIs and Wire Contracts

- `GET /api/visits/:visitId/workspace` remains Doctor-only and expands to return the base Visit/Intake, Patient Snapshot, draft state, signed Note/amendments, current medication decision, and server-computed `allowedActions`.
- The workspace accepts every state in which signed clinical evidence must remain reviewable; it is no longer limited to `WAITING` and `CONSULTING`.
- `GET /api/medications?q=` is Doctor-only, requires a 2–80 character query, returns active synthetic catalog entries, and never returns inventory availability.
- Existing Queue and Dashboard DTOs expand only as needed to represent `AWAITING_PREPARATION`, `AWAITING_ORDER_REVISION`, and `AWAITING_CHARGE` as committed pending work.
- All success and error bodies remain strict shared Zod schemas in `src/shared/contracts.ts`.

Server-computed allowed actions include only actions valid for both the authenticated role and the current committed revisions/state. The browser never derives permission from role text alone.

## 10. Authorization and Audit

The role matrix remains encoded centrally. New permissions are explicit data, not scattered role comparisons:

- `patient:update-allergy`: Assistant and Doctor, with state rules enforced in the workflow
- `clinical:read`: Doctor
- `clinical:save-draft`: Doctor
- `clinical:sign`: Doctor
- `clinical:amend`: Doctor
- `medication:read-catalog`: Doctor
- `medication:sign-decision`: Doctor

Assistant direct calls to clinical read/write/sign/amend, catalog, or medication-decision endpoints return `403` before service work runs.

Audit events record actor ID, actor role, UTC time, action, entity, resulting revision/version, reason where required, and linked entity IDs. At minimum this milestone records Allergy review, draft save, Consultation finalize, Note sign, decision sign, amendment sign, decision supersede, and Visit transition. Audit metadata contains identifiers and versions, not full clinical prose.

## 11. Doctor Consultation UX

The current `ConsultationScreen` and existing CSS are extended rather than replaced.

### Patient context

- Preserve the 252px desktop Patient rail and stacked mobile composition.
- Add the source-linked Allergy alert at the top of the clinical canvas.
- Display `UNKNOWN` visibly when Allergy has not been reviewed; do not use a reassuring green “none” state.
- Show committed Intake/vitals and a compact recent-evidence timeline.
- In the Assistant workspace, keep Allergy review out of the Intake authoring form and expose it as one focused action on a committed `WAITING` Queue row.

### Clinical authoring

- Replace the read-only placeholder with labeled Subjective, Objective, Assessment, and Plan controls.
- Diagnosis is an ordered free-text list; the UI does not claim an ICD-10 code is validated.
- Add one Medication Decision card with an explicit choice between “สั่งยาจากรายการทดสอบ” and `NO_MEDICATION`.
- An Order searches the small synthetic catalog and requires quantity plus Thai directions per item.
- `NO_MEDICATION` requires a visible reason.
- Empty medication selection never implicitly means `NO_MEDICATION`.

### Actions and signed state

- Keep the Stitch-style sticky bottom action bar with “บันทึกร่าง” and “ลงนามและจบการตรวจ”.
- Both controls meet the 48px target requirement and work by keyboard.
- Signing uses a confirmation dialog summarizing the immutable Note and medication decision; it does not request a shared password or role toggle.
- After finalization, controls become read-only evidence with signer/time/version/hash identity and an amendment action.
- `AWAITING_PREPARATION` links to the existing unavailable Dispensing route; `AWAITING_CHARGE` links to the unavailable Checkout route. The UI states clearly which next milestone owns the pending step and never pretends it completed.

The permanent synthetic-only banner remains exactly once. Thai is the working language; canonical domain tokens such as Visit, Clinical Note, Medication Order, `UNKNOWN`, and `NO_MEDICATION` remain visible where precision matters.

## 12. Loading, Conflict, and Failure Behavior

- Workspace loading uses the existing clinical skeleton without rendering stale Patient data from another Visit.
- A failed draft save keeps the current in-memory form values and provides Retry; clinical content is not copied to browser storage.
- A revision conflict names the changed aggregate, returns current revisions, keeps the user's unsaved form visible, and requires an explicit reload/review before resubmission.
- Validation errors are mapped to the exact SOAP, Diagnosis, Allergy, or medication field in Thai.
- Permission denial renders no clinical data and performs no clinical workspace fetch for Assistant.
- Finalize, amendment, Allergy review, and decision revision use disabled/pending controls to prevent accidental repeated clicks, while server idempotency remains authoritative.
- Network uncertainty never causes the UI to invent a signed state. It reloads the committed workspace using the same idempotency key to discover whether the command committed.
- Illegal state and stale revision failures produce no partial Note, Order, Audit, or Visit writes.

## 13. Queue, Dashboard, Restart, and Reset

- Queue is still derived from committed Visit state and includes accurate Thai pending labels for the newly reachable states.
- Finalized Visits disappear from the Doctor examination list but remain visible in the appropriate operational pending count.
- Dashboard adds committed counts for waiting preparation, order revision, and charge without adding fake Inventory or Finance totals.
- A real-file restart test verifies the same signed Note hash, decision version, Allergy revision, Visit state/revision, and Audit IDs after closing and reopening SQLite.
- The guarded synthetic reset deletes all Patient-linked clinical drafts/evidence, Allergy history, decisions, Visit data, idempotency records, sessions, and related audit events in foreign-key order.
- The synthetic Medication catalog and Clinic/Staff configuration survive reset.
- Reset updates its exact table allowlist, canonical-schema comparison, trigger restoration, and zero-row verification. It continues to fail closed for unknown tables or a running Clinic Host.

## 14. Test Contract

Every changed behavior follows RED → GREEN → REFACTOR with tests committed before or with the implementation they drive.

### Server and database

1. Snapshot serializes `UNKNOWN`, `NONE_KNOWN`, and `PRESENT` as distinct values with provenance.
2. Allergy update is append-only, increments Patient revision, obeys Assistant/Doctor state rules, audits the actor, and rejects stale revisions without partial writes.
3. Draft save atomically persists SOAP, Diagnosis, and medication-decision draft; replay creates one effect and collision is rejected.
4. Finalize rejects incomplete SOAP, missing Diagnosis, undecided medication, empty Order, and Order plus `NO_MEDICATION` together.
5. Finalize is Doctor-only and assistant direct calls return `403`.
6. Finalize with `ORDER` atomically signs Note/Diagnosis/decision/items and transitions to `AWAITING_PREPARATION`.
7. Finalize with `NO_MEDICATION` atomically signs Note/Diagnosis/decision and transitions to `AWAITING_CHARGE`.
8. Injected failure after each participant proves rollback of every participant and audit row.
9. Same-key retry returns the original signed IDs/hash and does not increment versions twice.
10. Signed Note, Diagnosis, decision, Order item, and amendment update/delete attempts are rejected at storage/API boundaries.
11. Amendment preserves the original Note bytes/hash and returns ordered immutable history after restart.
12. Allergy change after an Order moves the Visit to `AWAITING_ORDER_REVISION`; a new decision supersedes rather than overwrites the old one.
13. Medication catalog search returns only active synthetic entries and signed items retain catalog snapshots after master changes.
14. Real-file restart and guarded reset cover every new table, trigger, audit action, revision, and hash.

### Client

1. Consultation renders source-linked Snapshot values and explicit `UNKNOWN` states.
2. Doctor can save and reload a draft without changing Visit state.
3. The form requires an explicit Order or `NO_MEDICATION` choice and maps field errors in Thai.
4. Conflict keeps typed content visible and requires review before retry.
5. Signed state is read-only and exposes amendment as a separate action.
6. Assistant direct route access neither fetches nor renders clinical data.
7. Existing role landing, Intake, Queue, Overview, authentication, banner, and unavailable-route behavior remain green.

### Browser acceptance

1. Doctor completes one `ORDER` Consultation and sees `AWAITING_PREPARATION` after a page reload.
2. Doctor completes one `NO_MEDICATION` Consultation and sees `AWAITING_CHARGE` after a page reload.
3. A second authenticated context observes the same committed Queue/dashboard state.
4. Assistant cannot access the clinical workspace or APIs.
5. The Consultation passes 375px, 768px, and 1440px viewport checks with no horizontal overflow, minimum 48px actions, keyboard operation, and exactly one Pilot banner.

The final milestone gate runs lint, typecheck, client tests, server tests, production build, Playwright, `git diff --check`, and real-browser visual inspection against the supplied Stitch screen.

## 15. Explicit Deferrals

- Inventory, lots, expiry/quarantine, FEFO, reservations, barcode/manual preparation, Label, release/reject, Dispense, and stock movement belong to milestone 3.
- Charge, payment, waiver, close gate, OPD Card, and financial documents belong to milestone 4.
- Monthly analytics, revenue trends, disease trends, and medication-use analysis remain outside Local Pilot P0. Only truthful operational counts derived from committed state appear during the Pilot.
- External ICD terminology, EHP import, interoperability, real Patient identity entry, cloud services, appointments, labs, AI, and multi-clinic support remain out of scope.

## 16. Definition of Done

This milestone is done only when both medication-decision paths are walkable from the existing Queue, every signed artifact is immutable and restart-persistent, all role/revision/idempotency/transaction gates pass, the responsive Stitch-derived Consultation has been visually inspected, and every deferred subsystem remains visibly pending rather than simulated.
