# CareFlow MVP Milestone 3 Fulfillment Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the synthetic medication safety path from a signed ORDER through Label, Preparation, Doctor Release, Handoff, immutable stock-out, and audited inventory correction/quarantine.

**Architecture:** Add a fulfillment module for Label, Preparation, Release, Invalidation, and Dispense orchestration while keeping FEFO, reservation, lot availability, and the movement ledger in inventory. Preserve the existing /api/dispensing URL family and React/CSS shell. Use caller-owned audited SQLite immediate transactions, strict shared Zod contracts, optimistic revisions, append-only evidence, and exact idempotent result replay.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM with better-sqlite3/SQLite WAL, Zod, React 19, React Router, TanStack Query, Vitest, Testing Library, Playwright, existing CareFlow CSS and print styles.

## Global Constraints

- The pilot remains synthetic-only; never accept or seed real patient or medication data.
- The tracked careflow-webapp/ and stitch_careflow_clinic_management_system/ directories are frozen read-only references.
- Existing receipt, reservation, allocation, audit, idempotency, revision, and immediate-transaction behavior must remain green.
- No mutable inventory balance column is introduced. On-hand is the sum of append-only Stock Movements; available is on-hand minus active reservation allocations.
- FEFO is server-owned: expiry date ascending, then lot ID ascending; the browser never sends a lot allocation or dispense quantity.
- A current signed ORDER is the only source for Label, Preparation, Release, and Dispense; NO_MEDICATION creates none of those artifacts.
- A Print Request records only a browser print request. It never claims physical printer success.
- Barcode is synthetic Medication-level internal_barcode; allocation ID still identifies the exact lot.
- Every mutation uses a strict shared body, prototype-key rejection, an Idempotency-Key, and expected revisions for mutable records.
- Every command re-reads its full chain inside an immediate transaction and writes nothing until every precondition passes.
- Same key plus same request replays original result data; only replayed metadata changes. Same key plus different input conflicts.
- UTC is stored canonically and Asia/Bangkok is used for clinic-date expiry checks.
- Doctor has the Assistant operational permissions needed to work alone. Assistant cannot release, unquarantine, or adjust stock.
- Every task follows TDD: write a focused failing test, run it and observe the expected RED failure, implement the minimum, run focused GREEN, then run the relevant full suite.
- Every completed task gets a spec-compliance and code-quality review before the next task.
- Keep changes in this existing non-main branch. Do not reset, clean, or overwrite unrelated untracked .DS_Store or Stitch reference content.

## File map and ownership

### Server and shared contracts

- Create src/server/modules/fulfillment/schema.ts for label, preparation, invalidation, release, rejection, Dispense, and Dispense Line tables.
- Create src/server/modules/fulfillment/service.ts for current-order chain reads, label/preparation/release/handoff orchestration, artifact invalidation, and DTO construction.
- Create src/server/modules/fulfillment/routes.ts for authenticated /api/dispensing commands and label reads.
- Create src/server/modules/fulfillment/index.ts for exports and service construction.
- Modify src/server/modules/medication/schema.ts and service.ts for internal_barcode and deterministic synthetic backfill.
- Modify src/server/modules/inventory/schema.ts and service.ts for consumption metadata, generalized movement source checks, lot revision, adjustment, quarantine, and fulfillment-facing reservation helpers.
- Modify src/server/modules/inventory/routes.ts and index.ts for inventory lot reads and integrity commands; preserve existing receipt route behavior.
- Modify src/server/db/schema.ts and src/server/app.ts to register new tables and the fulfillment service.
- Modify src/server/modules/platform/permissions.ts and audit.ts for new permissions and audit actions.
- Modify src/server/workflows/clinical.ts and clinical-routes.ts for atomic artifact invalidation after allergy/order changes.
- Modify src/server/modules/visit/service.ts, routes.ts, and queue/dashboard DTOs for the full fulfillment state machine.
- Modify src/server/maintenance/reset-synthetic.ts, health/schema tests, and restart tests for new tables, triggers, and statuses.
- Create numbered migrations under careflow-pilot/drizzle/; never edit an already committed migration or its metadata hash.
- Modify careflow-pilot/src/shared/contracts.ts for strict command/read DTOs and new Permission/Visit/fulfillment enums.

### Client

- Modify src/client/features/dispensing.ts and create focused feature functions for labels, confirmations, release, rejection, and handoff.
- Modify src/client/screens/DispensingScreen.tsx to render state/role-specific preparation, release, and handoff work.
- Create src/client/screens/LabelScreen.tsx for the protected 80 × 100 mm label preview and print-request flow.
- Modify src/client/screens/InventoryScreen.tsx and src/client/features/inventory.ts for lot status and adjustment panels.
- Modify src/client/app/router.tsx, query-client.ts, QueueScreen.tsx, OverviewScreen.tsx, and ConsultationScreen.tsx.
- Modify only scoped classes/tokens in src/client/styles/globals.css; do not copy or edit frozen visual assets.

### Tests and evidence

- Create/extend tests/server/fulfillment-completion.test.ts for service and route behavior.
- Extend tests/server/clinical-workflow.test.ts with real active reservation invalidation.
- Extend tests/server/clinical-schema.test.ts, reset-synthetic-data.test.ts, health.test.ts, restart.test.ts, and database-artifacts.test.ts.
- Extend tests/client/dispensing.test.tsx, router.test.tsx, consultation.test.tsx, inventory.test.tsx, queue.test.tsx, and query-client.test.ts as behavior changes.
- Create tests/e2e/fulfillment-completion.spec.ts with the complete two-browser medication path and failure paths.
- Keep the plan ledger in .superpowers/sdd/2026-08-09-careflow-fulfillment-completion/progress.md; it is git-ignored.

---

### Task 1: Fulfillment persistence, medication barcode, and migration foundation

**Files:**

- Create: careflow-pilot/src/server/modules/fulfillment/schema.ts
- Modify: careflow-pilot/src/server/modules/medication/schema.ts, careflow-pilot/src/server/modules/medication/service.ts
- Modify: careflow-pilot/src/server/modules/inventory/schema.ts
- Modify: careflow-pilot/src/server/db/schema.ts, careflow-pilot/src/shared/contracts.ts
- Create: careflow-pilot/drizzle/0009_fulfillment_completion.sql and matching drizzle/meta snapshot/journal entry
- Test: careflow-pilot/tests/server/fulfillment-completion.test.ts, clinical-schema.test.ts, database-artifacts.test.ts

**Interfaces:**

- Export fulfillment tables and status constants through modules/fulfillment/index.ts and db/schema.ts.
- Add internal_barcode to the Medication DTO and strict barcode schema; demo values are deterministic CF-DEMO-001, CF-DEMO-002, and CF-DEMO-003.
- Add Drizzle tables for fulfillment_label_versions, fulfillment_label_items, fulfillment_label_print_events, fulfillment_preparations, fulfillment_preparation_confirmations, fulfillment_artifact_invalidations, fulfillment_releases, fulfillment_rejections, fulfillment_dispenses, and fulfillment_dispense_lines.
- Add additive consumed_at, consumed_by, consumed_dispense_id, and revision fields where required; do not rebuild inventory_reservations or medications because child foreign keys already exist.
- Define shared DTOs for current Label, print event, Preparation, confirmation, Release, Rejection, Dispense, and the extended Pick List.

- [ ] **Step 1: Write RED schema and contract tests.** Add tests that import the missing fulfillment DTOs and assert a current signed ORDER can be represented with a label, a preparation, a per-allocation confirmation, a release chain, and a dispense chain. Assert NO_MEDICATION has no fulfillment artifact. Add a direct database test that attempts to update/delete an allocation, confirmation, label item, print event, release, rejection, invalidation, dispense line, or movement and expects the append-only trigger to reject it.
- [ ] **Step 2: Run the focused tests and confirm RED.** From careflow-pilot run npm run test:server -- tests/server/fulfillment-completion.test.ts tests/server/clinical-schema.test.ts tests/server/database-artifacts.test.ts. Expected failure is missing exports/tables/triggers, not a test syntax error.
- [ ] **Step 3: Add strict shared contracts.** Define discriminated schemas for BARCODE and MANUAL confirmation. BARCODE requires allocationId, preparationId, and barcode; MANUAL requires allocationId, preparationId, and a trimmed 1–500 character reason. Define command envelopes with expectedRevisions, payload, and strict unknown-key rejection. Define read DTOs with exact orderItemId/lotId association and role/state allowedActions.
- [ ] **Step 4: Add the schema with safe constraints.** Use immutable snapshot columns for label items, confirmations, releases, rejections, dispense lines, and print events. Add unique constraints for one label per decision, one confirmation per preparation/allocation, one release and dispense per reservation, and one dispense line per allocation. Add method-specific reason/barcode checks and status transition checks.
- [ ] **Step 5: Add internal_barcode without rebuilding medications.** Add the column additively, backfill active synthetic medications deterministically, create a partial unique index, and add insert/update guards that reject active rows without a normalized unique barcode. Keep medication IDs, revisions, and child foreign keys unchanged.
- [ ] **Step 6: Generate and inspect migration 0009.** Run npm run db:generate. Inspect SQL and Drizzle metadata; remove any generated table rebuild that would drop a populated parent or change an existing migration hash. Add explicit trigger SQL for append-only tables and reservation consumption checks.
- [ ] **Step 7: Run GREEN and typecheck.** Run the focused server tests, npm run typecheck:server, and npm run lint. Verify a fresh database and a database populated through migration 0008 both migrate to the new schema with foreign_keys enabled.
- [ ] **Step 8: Commit.** Commit exactly the persistence/contract work with feat: add fulfillment completion persistence.

### Task 2: Label, Preparation, clinical invalidation, and authenticated API

**Files:**

- Create: careflow-pilot/src/server/modules/fulfillment/service.ts, routes.ts, index.ts
- Modify: careflow-pilot/src/server/app.ts, modules/inventory/service.ts and routes.ts
- Modify: careflow-pilot/src/server/modules/platform/permissions.ts and audit.ts
- Modify: careflow-pilot/src/server/workflows/clinical.ts, clinical-routes.ts, modules/visit/service.ts
- Modify: careflow-pilot/src/server/maintenance/reset-synthetic.ts
- Test: careflow-pilot/tests/server/fulfillment-completion.test.ts, fulfillment-routes.test.ts, clinical-workflow.test.ts, reset-synthetic-data.test.ts

**Interfaces:**

- createFulfillmentService({ database, inventory, medications, visits, clock, idFactory }) returns getPickList, getCurrentLabel, startPreparation, recordPrintRequest, confirmAllocation, completePreparation, abandonPreparation, invalidateCurrentArtifacts, and readHandoffChain.
- registerFulfillmentRoutes registers GET /api/dispensing/:visitId, GET /api/dispensing/:visitId/labels, POST /api/dispensing/:visitId/reservations, POST /api/dispensing/:visitId/labels/:labelVersionId/print-events, POST /api/dispensing/:visitId/preparation-confirmations, POST /api/dispensing/:visitId/complete-preparation, and POST /api/dispensing/:visitId/reservation-release.
- The inventory module remains the owner of reserve/release/FEFO primitives; fulfillment composes them inside the caller-supplied transaction.

- [ ] **Step 1: Write RED service tests.** Seed a signed ORDER and future lots, then assert label creation from a signed decision, current-label reads, deterministic print sequences, reservation plus preparation creation, barcode success, barcode mismatch with zero writes, manual reason validation, incomplete-preparation blocking, completion, and abandon releasing the reservation while leaving allocations immutable.
- [ ] **Step 2: Write RED route/invalidation tests.** Cover anonymous access, assistant/doctor read/prepare/print permissions, strict body and Idempotency-Key errors, first 201/replay 200, same-key conflict, stale Visit/Preparation revisions, and a real active reservation invalidated by allergy and Order revision from PREPARING. Assert the old Label/Preparation cannot print, complete, release, or handoff.
- [ ] **Step 3: Run RED.** Run npm run test:server -- tests/server/fulfillment-completion.test.ts tests/server/fulfillment-routes.test.ts tests/server/clinical-workflow.test.ts. Confirm failures are missing fulfillment exports/routes/behavior.
- [ ] **Step 4: Build the current-chain reader.** Read the latest signed ORDER, current Label, valid artifacts, reservation allocations, and confirmation summaries with exact orderItemId and lotId associations. Return no draft or unsigned decision. Treat a released reservation as historical only; do not show it as the active Pick List.
- [ ] **Step 5: Create Label and Preparation atomically.** Extend the signed ORDER finalization/revision transaction to create the Label version and immutable items. Extend reserveForVisit so one transaction creates the hard reservation, all allocations, Preparation, Visit revision, audit events, and idempotency result. Backfill an active Phase 2B reservation with an ACTIVE Preparation during migration or a guarded maintenance step.
- [ ] **Step 6: Implement print and confirmation commands.** Print request appends sequence for the current valid Label. Barcode normalizes trim/uppercase and must match the allocation Medication internal_barcode; manual confirmation requires the reason. Complete re-reads all allocations and refuses any missing confirmation. Abandon invalidates only the Preparation, releases the active reservation, and returns AWAITING_PREPARATION.
- [ ] **Step 7: Implement clinical invalidation.** In the existing clinical transaction, release the active reservation before updating Visit status. Invalidate the current Label, Preparation, and Release where present; record the actual next status for ORDER versus NO_MEDICATION. Support allergy changes and medication revisions from PREPARING, AWAITING_RELEASE, and AWAITING_HANDOFF.
- [ ] **Step 8: Add permissions and audit.** Add fulfillment:read, fulfillment:prepare, label:print, fulfillment:release, fulfillment:handoff, inventory:quarantine, inventory:release-quarantine, and inventory:adjust to the shared Permission union and role map. Add label.version-created, label.print-requested, preparation.allocation-confirmed, visit.preparation-completed, visit.preparation-abandoned, and fulfillment.artifacts-invalidated actions with metadata containing decision/version, artifact IDs, lot IDs, quantities, and actual transitions.
- [ ] **Step 9: Implement routes with exact replay.** Require permission before service work, strict-parse the command, call executeIdempotent with stable operation names, store the original data result, and return 201 on first commit/200 on replay. For manual abandon preserve reason and return the extended Pick List after commit.
- [ ] **Step 10: Update reset and restart allowlists.** Delete fulfillment children before parents, clear movement/adjustment/status-event rows in dependency order, reinstall triggers, and add schema/health/reset/restart assertions for the new table count and status values.
- [ ] **Step 11: Run GREEN and full server tests.** Run focused tests, then npm run test:server, npm run typecheck:server, and npm run lint. Fix every regression before commit.
- [ ] **Step 12: Commit.** Commit with feat: add label preparation and fulfillment api.

### Task 3: Preparation and Label client workflow

**Files:**

- Modify: careflow-pilot/src/client/features/dispensing.ts, screens/DispensingScreen.tsx, app/query-client.ts, app/router.tsx
- Create: careflow-pilot/src/client/screens/LabelScreen.tsx
- Modify: careflow-pilot/src/client/screens/ConsultationScreen.tsx and styles/globals.css
- Test: careflow-pilot/tests/client/dispensing.test.tsx, router.test.tsx, consultation.test.tsx, query-client.test.ts

**Interfaces:**

- useDispensingPickList returns the extended Pick List.
- useReserveDispensing, usePrintLabel, useConfirmAllocation, useCompletePreparation, and useAbandonPreparation send strict command attempts with retry disabled and invalidate the Pick List on success.
- Existing PageHeader, Card, SectionHeading, StatusBadge, ActionButton, TextAreaField, and current dispensing CSS remain the visual primitives.

- [ ] **Step 1: Write RED client tests.** Cover current Label/print state, preparation allocation rows with exact lot/quantity, loading/error/permission states, barcode input Enter behavior, mismatch no-progress UI, manual reason preservation, incomplete completion error, abandon success, and state/role-specific actions. Assert /dispensing/:visitId/labels is protected and print copy says request/open print rather than physical success.
- [ ] **Step 2: Run RED.** Run npm run test:client -- tests/client/dispensing.test.tsx tests/client/router.test.tsx tests/client/consultation.test.tsx tests/client/query-client.test.ts. Expected failures are missing hooks, routes, and controls.
- [ ] **Step 3: Implement client feature functions.** Add query keys and strict client.get/client.command functions. Generate a fresh idempotency key per deliberate attempt, preserve drafts on error, and invalidate the Pick List only after a committed command.
- [ ] **Step 4: Implement state-aware DispensingScreen.** AWAITING_PREPARATION shows current signed Order/Label and Start Preparation. PREPARING shows one focused keyboard-wedge input, exact allocation rows, confirmation state, Complete, and Abandon with reason. AWAITING_RELEASE shows Doctor final-check controls or Assistant read-only waiting. AWAITING_HANDOFF shows Handoff. AWAITING_CHARGE shows a truthful later-milestone summary.
- [ ] **Step 5: Implement Label print screen.** Render signed snapshot fields at 80 × 100 mm, hide app chrome in print CSS, record the Print Request before invoking window.print, and preserve invalid/stale/error messages. Do not display an old invalid Label as printable.
- [ ] **Step 6: Update route and consultation navigation.** Replace only the unavailable dispensing element, add the label route, keep checkout/OPD placeholders, and update CTA/status wording for PREPARING/AWAITING_RELEASE/AWAITING_HANDOFF.
- [ ] **Step 7: Run GREEN and client verification.** Run focused tests, npm run typecheck:client, npm run lint, and npm run build:client. Commit with feat: add preparation and label workflow ui.

### Task 4: Doctor Release, Reject, and Handoff/Dispense stock-out

**Files:**

- Modify: careflow-pilot/src/server/modules/fulfillment/service.ts and routes.ts
- Modify: careflow-pilot/src/server/modules/inventory/schema.ts, service.ts, routes.ts
- Modify: careflow-pilot/src/server/modules/platform/audit.ts, permissions.ts
- Modify: careflow-pilot/src/server/modules/visit/service.ts and workflows/clinical.ts
- Create: careflow-pilot/drizzle/0010_dispense_ledger.sql and matching metadata
- Modify: careflow-pilot/src/client/features/dispensing.ts, screens/DispensingScreen.tsx, shared/contracts.ts
- Test: careflow-pilot/tests/server/fulfillment-completion.test.ts, fulfillment-routes.test.ts, clinical-workflow.test.ts, tests/client/dispensing.test.tsx

**Interfaces:**

- Add POST /api/dispensing/:visitId/release, POST /api/dispensing/:visitId/reject, and POST /api/dispensing/:visitId/handoff.
- releaseForVisit verifies current signed decision, valid Label, Print Request sequence at least Preparation.minimum_print_sequence, complete Preparation, active reservation, sellable lots, and expected revisions before creating immutable Release and moving to AWAITING_HANDOFF.
- rejectForVisit requires Doctor/reason, writes Rejection plus Preparation invalidation, releases reservation, and returns AWAITING_PREPARATION without invalidating the Label. A later Preparation requires a new Print Request sequence.
- handoffForVisit verifies current Release, current clinic-date sellability, reservation completeness, and no existing Dispense; it inserts Dispense/Lines, negative movements, consumes reservation, and moves to AWAITING_CHARGE in one immediate transaction.

- [ ] **Step 1: Write RED release/reject tests.** Assert Assistant direct release is 403, Doctor release requires current print event and complete confirmations, stale/invalidated artifact is blocked, reject preserves the Label but requires a new print sequence, and exact audit metadata includes every lot and quantity.
- [ ] **Step 2: Write RED handoff tests.** Assert handoff creates one Dispense Line and one negative movement per allocation, available/on-hand/reserved totals are correct, duplicate handoff is blocked, insufficient/expired/quarantined stock rolls back every row, and reservation becomes terminal CONSUMED.
- [ ] **Step 3: Run RED.** Run npm run test:server -- tests/server/fulfillment-completion.test.ts tests/server/fulfillment-routes.test.ts. Expected failures are missing release/handoff endpoints, movement constraints, and consumption fields.
- [ ] **Step 4: Implement Release and Reject.** Add exact chain checks and immutable evidence. Use fulfillment.artifact_invalidations for old artifacts. Add Doctor-only permission and required reasons. Ensure rejected Label reuse is explicit and print sequence is enforced.
- [ ] **Step 5: Generalize the movement ledger safely.** Add DISPENSE with negative delta and source checks. Rebuild only the leaf inventory_stock_movements table under foreign_keys=ON; copy every existing receipt row unchanged; create triggers validating receipt/dispense sources and append-only updates/deletes; add a populated 0009-to-0010 migration test.
- [ ] **Step 6: Implement atomic Handoff.** Insert Dispense and Lines before movement trigger validation, write movement rows using generated line IDs as sources, set reservation CONSUMED with dispense metadata, increment touched lot revisions once, append audit events, and advance Visit only after every precondition is re-read.
- [ ] **Step 7: Wire client final-check and handoff.** Show Release/Reject only to Doctor, Handoff to Assistant/Doctor only at AWAITING_HANDOFF, preserve reject reason, and render post-handoff stock/Visit state from the API.
- [ ] **Step 8: Run GREEN and full affected suites.** Run focused tests, npm run test:server, npm run test:client, npm run typecheck, npm run lint, and migration upgrade tests. Commit with feat: complete release handoff and dispense.

### Task 5: Inventory adjustment, quarantine, queue/dashboard, and operational UI

**Files:**

- Modify: careflow-pilot/src/server/modules/inventory/schema.ts, service.ts, routes.ts, index.ts
- Modify: careflow-pilot/src/server/modules/platform/permissions.ts, audit.ts
- Modify: careflow-pilot/src/server/modules/visit/service.ts
- Create: careflow-pilot/drizzle/0011_inventory_integrity.sql and matching metadata
- Modify: careflow-pilot/src/client/features/inventory.ts, screens/InventoryScreen.tsx, screens/QueueScreen.tsx, screens/OverviewScreen.tsx
- Modify: careflow-pilot/src/client/styles/globals.css
- Test: careflow-pilot/tests/server/inventory.test.ts, fulfillment-completion.test.ts, reset-synthetic-data.test.ts, tests/client/inventory.test.tsx, queue.test.tsx

**Interfaces:**

- Add GET /api/inventory/medications/:medicationId/lots.
- Add POST /api/inventory/lots/:lotId/adjustments, /quarantine, and /unquarantine.
- inventory_lots.revision advances once per command that changes on-hand, reserved, available, or sellability: receipt, reservation create/release/consume, dispense, adjustment, quarantine, and unquarantine.
- Adjustment accepts only an existing corrects_movement_id, non-zero quantity_delta, and required reason. Server generates new Adjustment/Movement IDs.

- [ ] **Step 1: Write RED inventory integrity tests.** Cover Doctor-only adjustment/unquarantine, Assistant/Doctor quarantine, required reasons, unknown fields, stale lot revision, active reservation quarantine block, expired unquarantine block, append-only status events, adjustment source validation, and no-negative/no-below-reserved outcomes.
- [ ] **Step 2: Run RED.** Run npm run test:server -- tests/server/inventory.test.ts tests/server/fulfillment-completion.test.ts. Expected failures are missing schema, routes, permissions, and aggregate revision behavior.
- [ ] **Step 3: Implement inventory commands.** Add lot revision, adjustment/status-event tables, source triggers, derived balances, and immediate command services. Quarantine changes only current lot status and event; it never mutates movement totals or active reservations.
- [ ] **Step 4: Implement role-aware API.** Check permission before reading lot detail, strict-parse reason/delta/revision, execute idempotently, return 201 first/200 replay, and append audit metadata with lot, movement, source, delta, old/new status, and reason.
- [ ] **Step 5: Add operational UI.** Reuse the Inventory cards and existing form controls. Show lot totals/status/revision, Assistant/Doctor quarantine action, Doctor unquarantine/adjustment actions, and preserved drafts/errors. Update Queue and Overview labels/counts for PREPARING, AWAITING_RELEASE, and AWAITING_HANDOFF.
- [ ] **Step 6: Run GREEN and client/server verification.** Run focused tests, full client/server suites, typechecks, lint, and build. Commit with feat: add inventory correction and quarantine.

### Task 6: Full pilot path, migrations, reset, and final review

**Files:**

- Create: careflow-pilot/tests/e2e/fulfillment-completion.spec.ts
- Modify: careflow-pilot/tests/e2e/fixtures.ts only for reusable synthetic helpers
- Modify: careflow-pilot/tests/server/health.test.ts, database-artifacts.test.ts, restart.test.ts, reset-synthetic-data.test.ts, clinical-schema.test.ts
- Modify: careflow-pilot/README.md to document the finished Milestone 3 boundary
- Update: .superpowers/sdd/2026-08-09-careflow-fulfillment-completion/progress.md

- [ ] **Step 1: Write RED two-browser E2E.** Start one temporary Pilot server; create synthetic patient/Visit, Doctor-signed ORDER, two future lots with different expiry, Assistant label request and FEFO reservation, scan/manual confirmations, Doctor release, Assistant handoff, restart, and verify AWAITING_CHARGE plus exact per-lot stock-out. Add reject/reprint, stale artifact, allergy/order invalidation, barcode mismatch, insufficient-stock rollback, quarantine, adjustment, and role-denial scenarios.
- [ ] **Step 2: Run RED and fix only test setup blockers.** Run npm run test:e2e -- tests/e2e/fulfillment-completion.spec.ts. The first failure must be the unavailable feature or missing endpoint; fixture changes may only create deterministic synthetic setup helpers.
- [ ] **Step 3: Update reset/schema/health/restart evidence.** Assert all new tables/triggers are present, migration count matches, populated upgrade keeps foreign keys on and identifiers/totals, reset removes fulfillment and inventory rows in dependency order, restart reads the same evidence and statuses, and no frozen directory or database file is tracked.
- [ ] **Step 4: Run complete verification fresh.** From careflow-pilot run npm test, npm run lint, npm run typecheck, npm run build, npm run test:e2e, and git diff --check. Record exact pass counts, build result, migration upgrade result, and any non-blocking bundle warnings.
- [ ] **Step 5: Review requirements line by line.** Confirm PRD criteria for ORDER/NO_MEDICATION, invalidation, barcode/manual evidence, FEFO/race/rollback, idempotency, restart, role denial, audit, print size, and adjustment/quarantine are each covered by a named test or persisted evidence.
- [ ] **Step 6: Request a final GPT-5.6 Sol Max read-only review.** Give the reviewer the spec, plan, implementation reports, full diff, migration upgrade evidence, and fresh verification output. Fix every Critical/Important finding through a focused RED→GREEN loop and scoped re-review.
- [ ] **Step 7: Update the ledger and commit documentation.** Record the complete path, routes, migrations 0009–0011, permissions, audit actions, pass counts, and deferred Milestone 4 boundary. Commit documentation/test evidence with test: cover fulfillment completion pilot flow.
- [ ] **Step 8: Stop for user acceptance.** Report what is implemented, what was verified, the final Sol Max verdict, and that Finance & Close remains the next milestone. Do not start Milestone 4 without a new user request.

## Execution and review protocol

The coordinator records the base SHA before every task and uses the subagent-driven-development scripts to create a task brief, review package, and progress ledger. One implementation subagent runs at a time because all agents share this worktree. After each implementer commit, a fresh reviewer checks both spec compliance and code quality; unresolved Critical or Important findings block the next task. A final whole-branch reviewer runs after Task 6.

The implementation plan itself is committed before Task 1. The plan, spec, task reports, review packages, and fresh verification output are the source of truth if the conversation is compacted.
