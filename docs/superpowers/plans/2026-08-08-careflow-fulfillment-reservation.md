# CareFlow Fulfillment Reservation and FEFO Pick List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect signed synthetic medication Orders to hard, auditable FEFO reservations and a server-backed Pick List without implementing preparation confirmation, dispense, payment, or handoff.

**Architecture:** Extend the existing `inventory` module with immutable reservation allocations and a stateful reservation aggregate. The service derives lot availability from the receipt movement ledger plus active allocation rows, performs all-or-nothing FEFO allocation in a SQLite immediate transaction, and owns the Visit `AWAITING_PREPARATION ↔ PREPARING` boundary. Clinical workflow hooks release active reservations when allergy/order safety invalidates a preparation. React Query screens consume strict shared contracts and reuse the existing CareFlow shell/CSS.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM for better-sqlite3, SQLite migrations, Zod contracts, React 19, React Router, TanStack Query, Vitest, Playwright.

## Global Constraints

- The pilot remains synthetic-only; never accept or seed real patient or medication data.
- The frozen `careflow-webapp/` and `stitch_careflow_clinic_management_system/` directories are read-only design references and must not be modified.
- Existing Phase 2A receipt movements remain append-only and receipt-only. Do not add mutable stock balances or browser-supplied lot allocations.
- Active reserved quantity is derived only from `inventory_reservation_allocations` joined to `inventory_reservations.status = 'ACTIVE'`.
- Reserve is all-or-nothing across every item in the signed `ORDER`; insufficient, expired, quarantined, or already-held stock leaves no partial rows and no Visit transition.
- FEFO ordering is expiry ascending, then lot id ascending; clinic-date comparisons use `Asia/Bangkok`.
- A reservation is tied to a Visit, signed decision id/version, and order item. Allocation rows are immutable; release updates only reservation state and records a reason.
- Reserve/release commands require strict bodies, expected revisions, and an `Idempotency-Key`; the original full `{ data, replayed }` envelope is stored and replayed exactly.
- Assistant has `inventory:read`, `inventory:receive`, and `inventory:reserve`; Doctor has `inventory:read` and `inventory:reserve`. The existing `/api/medications` permission behavior must not change.
- Clinical allergy/order invalidation hooks and inventory reservation writes must share the enclosing audited transaction.
- UI must reuse the existing CareFlow visual shell and CSS classes; do not redesign or copy the frozen prototype.
- Every behavior change follows TDD: write one focused failing test, run it and observe RED, implement the minimum, run focused GREEN, then run the relevant full suite.

## File map

- Modify `src/server/modules/inventory/schema.ts`: reservation and allocation Drizzle tables plus constraints.
- Modify `src/server/modules/inventory/service.ts`: lot-balance aggregate, signed-order reader, FEFO allocator, reservation/release commands, Pick List DTO construction, and clinical release helper.
- Modify `src/server/modules/inventory/index.ts` and `src/server/modules/inventory/routes.ts`: exports and authenticated Pick List/reservation routes.
- Modify `src/server/db/schema.ts`, `src/server/app.ts`, `src/server/modules/platform/permissions.ts`, and `src/server/modules/platform/audit.ts` to register schema, service, permissions, and actions.
- Modify `src/shared/contracts.ts`: reservation status, allocation, Pick List, reserve/release command, and response schemas.
- Create migration `drizzle/0007_fulfillment_reservation.sql` and update Drizzle metadata.
- Modify `src/server/maintenance/reset-synthetic.ts` and schema-focused tests for new tables, triggers, and reset verification.
- Create `tests/server/fulfillment-reservation.test.ts`: service, route, permission, audit, idempotency, FEFO, rollback, and release coverage.
- Modify `src/server/workflows/clinical.ts` and `src/server/modules/visit/service.ts` for reservation invalidation hooks and `PREPARING` revision/safety transitions.
- Create `src/client/features/dispensing.ts` and `src/client/screens/DispensingScreen.tsx`.
- Modify `src/client/app/query-client.ts`, `src/client/app/router.tsx`, `src/client/screens/ConsultationScreen.tsx`, and scoped client styles only where required for the Pick List.
- Create `tests/client/dispensing.test.tsx` and extend `tests/client/consultation.test.tsx`/`router.test.tsx` for changed route labels and permissions.
- Create `tests/e2e/fulfillment-reservation.spec.ts`; modify E2E fixtures only if a reusable helper is necessary.
- Create/update `.superpowers/sdd/2026-08-08-careflow-fulfillment-reservation/progress.md` as the git-ignored execution ledger.

---

### Task 1: Reservation persistence, contracts, derived balances, and FEFO service

**Files:**
- Modify: `src/server/modules/inventory/schema.ts`, `src/server/modules/inventory/service.ts`, `src/server/modules/inventory/index.ts`
- Modify: `src/server/db/schema.ts`, `src/shared/contracts.ts`
- Create: `drizzle/0007_fulfillment_reservation.sql` (generated from the schema)
- Test: `tests/server/fulfillment-reservation.test.ts`

**Interfaces:**
- `InventoryService.getInventory()` now reports active reserved quantities and allocatable availability from movement/allocations.
- Produces `getPickList(visitId)`, `reserveForVisit(tx, actor, visitId, expectedVisitRevision, expectedDecisionVersion)`, `releaseReservation(tx, actor, visitId, expectedVisitRevision, expectedReservationId, reason)`, and `releaseActiveReservation(tx, actor, visitId, reason)`.
- Produces strict shared DTOs for reservation, allocation, Pick List, reserve/release bodies, and command responses.

- [ ] **Step 1: Write failing service tests.** Add real SQLite tests that seed signed `ORDER` evidence and receipt lots, then assert: two lots allocate FEFO across the earlier lot first; expired/quarantined lots are skipped; active reservation reduces `available`; insufficient multi-item stock rolls back every row and Visit status; a second active reserve cannot duplicate allocations; release changes state and restores availability without editing allocation rows; allocation update/delete triggers reject mutation; and Bangkok tomorrow/today boundaries are deterministic.
- [ ] **Step 2: Run the focused server test and verify RED.** Run `npm run test:server -- tests/server/fulfillment-reservation.test.ts`. Expected: missing contracts/tables/service behavior.
- [ ] **Step 3: Add shared contracts and Drizzle persistence.** Add strict schemas and define `inventoryReservations` plus `inventoryReservationAllocations`, foreign keys, checks, the active-reservation unique index, and append-only allocation triggers. Export through `db/schema.ts`, run `npm run db:generate`, and inspect `0007`/metadata for all constraints.
- [ ] **Step 4: Implement derived balances and FEFO.** Add grouped lot-balance queries that avoid movement/allocation row multiplication. Read the latest signed Order and order-item snapshots inside the supplied transaction, reject non-`ORDER`/wrong status/stale revisions, choose sellable lots in deterministic order, prove all quantities before inserting, then insert reservation/allocations and advance the Visit in one transaction. Build a stable Pick List from snapshots and allocation rows.
- [ ] **Step 5: Implement release helpers.** Mark only an active reservation as released with a required reason; keep allocation rows immutable; restore `available` through the derived query. Provide a clinical hook that releases without changing Visit status so the enclosing clinical transition can do the optimistic Visit update.
- [ ] **Step 6: Run focused GREEN and typecheck.** Run `npm run test:server -- tests/server/fulfillment-reservation.test.ts` and `npm run typecheck:server`; fix issues without weakening the safety assertions.
- [ ] **Step 7: Commit the task.** Commit with `feat: add fulfillment reservation persistence and fefo service`.

### Task 2: Authenticated API, permissions, audit, and clinical invalidation

**Files:**
- Modify: `src/server/modules/inventory/routes.ts`, `src/server/modules/inventory/index.ts`, `src/server/app.ts`
- Modify: `src/server/modules/platform/permissions.ts`, `src/server/modules/platform/audit.ts`
- Modify: `src/server/workflows/clinical.ts`, `src/server/modules/visit/service.ts`
- Modify: `src/server/maintenance/reset-synthetic.ts`, schema/reset tests
- Test: `tests/server/fulfillment-reservation.test.ts`, existing clinical workflow tests where needed

**Interfaces:**
- Produces `GET /api/dispensing/:visitId`, `POST /api/dispensing/:visitId/reservations`, and `POST /api/dispensing/:visitId/reservation-release`.
- Assistant/Doctor read and reserve permissions are server-enforced; doctor order/allergy safety revisions release active reservations atomically.

- [ ] **Step 1: Add failing route and invalidation tests.** Cover anonymous/forbidden access, strict body/query errors, assistant/doctor success, idempotent reserve/release replay/conflict, insufficient-stock rollback, audit rows/reasons, stale revisions, and a `PREPARING` Visit whose allergy review or decision revision leaves no active reservation.
- [ ] **Step 2: Run focused tests and verify RED.** Run the fulfillment and affected clinical server tests; expected failures are missing routes, permissions, audit actions, and hooks.
- [ ] **Step 3: Register permissions and audit actions.** Add `inventory:reserve` to shared permission schema and the assistant/doctor role maps. Add `inventory.reservation-created`, `inventory.reservation-released`, `visit.preparation-started`, and `visit.preparation-abandoned` with required reason policy for release/abandon.
- [ ] **Step 4: Implement routes with exact idempotency.** Require permissions before service work, parse strict commands, call `executeIdempotent` with operations `inventory.reserve` and `inventory.reservation-release`, store the full response envelope, return `201` on a new reservation/release and `200` on replay. GET must return only signed Order evidence and persisted allocation snapshots.
- [ ] **Step 5: Wire clinical invalidation and reset.** Pass the inventory service into the clinical workflow, invoke its release helper before allergy/order revision transitions, allow the documented `PREPARING` safety/revision states, and keep the enclosing transaction atomic. Update reset table/trigger lists, deletion order, expected table counts, and schema tests for the new tables.
- [ ] **Step 6: Run GREEN and full server suite.** Run focused tests, then `npm run test:server`; investigate all migration/reset/permission regressions.
- [ ] **Step 7: Commit the task.** Commit with `feat: expose fulfillment reservation api`.

### Task 3: Pick List client and role-aware workflow screen

**Files:**
- Create: `src/client/features/dispensing.ts`, `src/client/screens/DispensingScreen.tsx`
- Modify: `src/client/app/query-client.ts`, `src/client/app/router.tsx`, `src/client/screens/ConsultationScreen.tsx`
- Modify: scoped styles in `src/client/styles/globals.css` only if a new Pick List presentation needs them
- Test: `tests/client/dispensing.test.tsx`, `tests/client/router.test.tsx`, `tests/client/consultation.test.tsx`

**Interfaces:**
- Produces `useDispensingPickList`, `useReserveDispensing`, and `useReleaseDispensing` hooks.
- `/dispensing/:visitId` is protected by `inventory:read`; reserve/release controls render only with `inventory:reserve`.

- [ ] **Step 1: Write failing client tests.** Assert loading/error/success Pick List states, signed-order medication cards, FEFO lot rows, `PREPARING` hard-reserved copy, assistant/doctor control visibility, release reason preservation on `422/409`, and the consultation link text no longer claims the route is unavailable.
- [ ] **Step 2: Run focused client tests and verify RED.** Run `npm run test:client -- tests/client/dispensing.test.tsx tests/client/router.test.tsx tests/client/consultation.test.tsx`.
- [ ] **Step 3: Implement feature hooks.** Add query keys, strict `ApiClient.get`, command attempts for reserve/release, retry disabled for commands, and query invalidation after success.
- [ ] **Step 4: Implement the screen using existing UI.** Reuse PageHeader/Card/SectionHeading/StatusBadge and existing dispensing medication classes. Show order snapshots, exact lot/expiry/quantity allocation, stock hold, inline Thai errors, and a required abandon reason. Preserve draft input across mutation errors.
- [ ] **Step 5: Wire route and clinical CTA.** Replace only the `/dispensing/:visitId` unavailable element with the protected screen, update the consultation CTA copy and status test expectations, and leave labels/checkout/OPD placeholders unchanged.
- [ ] **Step 6: Run GREEN, typecheck, and lint.** Run focused client tests, `npm run typecheck:client`, and `npm run lint`.
- [ ] **Step 7: Commit the task.** Commit with `feat: add fefo pick list screen`.

### Task 4: End-to-end reservation rehearsal and whole-slice verification

**Files:**
- Create: `tests/e2e/fulfillment-reservation.spec.ts`
- Modify: `tests/e2e/fixtures.ts` only for reusable synthetic clinical setup helpers
- No changes: `careflow-webapp/`, `stitch_careflow_clinic_management_system/`

- [ ] **Step 1: Write the failing Playwright flow.** In one temporary Pilot server, create a synthetic Visit, review allergy, have Doctor sign an `ORDER`, receive two lots with different future expiry dates, open `/dispensing/:visitId` as Assistant, reserve, and assert the earlier lot is allocated first. Reload as Doctor and assert the same Pick List; attempt a second insufficient reservation and assert no status/row mutation.
- [ ] **Step 2: Run the new E2E and verify RED.** Run `npm run test:e2e -- tests/e2e/fulfillment-reservation.spec.ts`; expected failure is the unavailable dispensing screen/API.
- [ ] **Step 3: Keep fixtures synthetic and deterministic.** Reuse existing login/acknowledgement helpers and unique lot numbers; do not add production seeds or commit database files.
- [ ] **Step 4: Run complete verification.** Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`, recording exact pass counts and investigating every failure.
- [ ] **Step 5: Inspect scope.** Run `git diff --check`, `git status --short`, and `git diff --name-only`; confirm frozen directories and generated database files are untouched.
- [ ] **Step 6: Commit the task.** Commit with `test: cover fulfillment reservation pilot flow`.

### Task 5: Task reviews, final whole-branch review, and handoff

**Files:**
- Modify: this plan/spec only for completion notes if needed
- Create/update: `.superpowers/sdd/2026-08-08-careflow-fulfillment-reservation/progress.md` (git-ignored ledger)

- [ ] **Step 1: Request task-scoped reviews after each implementation task.** Reviewers receive the design, plan, task diff, and focused verification output; they check spec compliance and quality independently.
- [ ] **Step 2: Fix every Critical/Important finding with a focused TDD loop.** Re-run affected tests and a scoped re-review after each fix; document accepted Minor follow-ups.
- [ ] **Step 3: Request a final whole-branch review.** Check migration upgrade path, active reservation race behavior, exact idempotent replay, clinical invalidation transaction boundaries, accessibility/role gating, reset/startup behavior, and frozen scope.
- [ ] **Step 4: Run final verification again.** Use the full command set immediately before any completion claim.
- [ ] **Step 5: Update the ledger and hand off.** Record new routes, migration, permission/audit changes, pass counts, and the explicit deferred boundary (preparation confirmation, labels, release/final check, handoff, dispense, finance).
