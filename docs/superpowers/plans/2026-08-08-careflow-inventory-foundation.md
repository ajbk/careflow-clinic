# CareFlow Inventory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synthetic-only, auditable medication receiving and inventory dashboard vertical slice without changing the frozen visual prototype.

**Architecture:** Keep `medications` as the Drug Master and add a focused `inventory` module containing lots, receipt records, and an append-only stock-movement ledger. All writes go through an idempotent Fastify command backed by a SQLite immediate transaction; React Query screens consume the resulting contracts and reuse the existing CareFlow shell/CSS.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM for better-sqlite3, SQLite migrations, Zod contracts, React 19, React Router, TanStack Query, Vitest, Playwright.

## Global Constraints

- The pilot remains synthetic-only; never accept or seed real patient or medication data.
- The frozen `careflow-webapp/` and `stitch_careflow_clinic_management_system/` directories are read-only design references and must not be modified.
- Stock balances are never stored or updated directly; aggregate stock is derived from append-only movements.
- Receipt, lot, receipt line, movement, and audit event commit in one SQLite immediate transaction.
- A medication/lot-number pair is unique within the clinic; duplicate lots return `INVALID_STATE`.
- Reception requires an active medication, exact medication revision, positive integer quantity `1..999999`, trimmed lot `1..100`, supplier `1..200`, note `0..500`, and an ISO expiry date after the clinic date in `Asia/Bangkok`.
- Assistant has `inventory:read` and `inventory:receive`; doctor has `inventory:read` only. The existing `/api/medications` permission behavior must not change.
- Idempotency replay must return the original command envelope; the same key with a different request is `IDEMPOTENCY_CONFLICT`. Inventory receipts use standard exact envelope storage/replay because their synthetic-only DTO contains a historical aggregate snapshot; do not rebuild it from a receipt reference.
- UI must reuse the existing `PageHeader`, `Card`, `SectionHeading`, `StatusBadge`, table, summary-card, and stock form styles already present in `src/client/styles/globals.css`.
- Every behavior change follows TDD: write one focused failing test, run it and observe the expected failure, implement the minimum, run the focused test, then run the relevant suite.

---

## File map

- Create `src/server/modules/inventory/schema.ts`: inventory lot, receipt, receipt-line, and stock-movement Drizzle tables plus append-only SQL names.
- Create `src/server/modules/inventory/service.ts`: receipt transaction helpers, aggregate query, date/status policy, and medication search bridge.
- Create `src/server/modules/inventory/routes.ts` and `src/server/modules/inventory/index.ts`: authenticated HTTP surface and exports.
- Modify `src/server/db/schema.ts`, `src/server/app.ts`, `src/server/modules/platform/permissions.ts`, and `src/server/modules/platform/audit.ts` to register the module, permissions, and audit action.
- Modify `src/shared/contracts.ts`: inventory DTOs, query, command payload/body, and response schemas.
- Create migration `drizzle/0006_inventory_foundation.sql` and let Drizzle update `drizzle/meta/_journal.json` and snapshot metadata.
- Create `tests/server/inventory.test.ts`: service, persistence, route, permission, audit, idempotency, and rollback coverage.
- Create `src/client/features/inventory.ts`: React Query hooks and API calls.
- Create `src/client/screens/InventoryScreen.tsx` and `src/client/screens/StockReceptionScreen.tsx`: production pilot screens using existing shell classes.
- Modify `src/client/app/query-client.ts`, `src/client/app/router.tsx`, `src/client/app/role-workspace.ts`, and `src/client/components/careflow/AppShell.tsx` for query keys, protected routes, role navigation, and the inventory icon.
- Create `tests/client/inventory.test.tsx` and extend `tests/client/router.test.tsx` only where route/role behavior is covered.
- Create `tests/e2e/inventory-foundation.spec.ts`: assistant receive/read and doctor read-only smoke flow.

---

### Task 1: Inventory contracts, persistence, and aggregate/receipt service

**Files:**
- Create: `src/server/modules/inventory/schema.ts`
- Create: `src/server/modules/inventory/service.ts`
- Create: `src/server/modules/inventory/index.ts`
- Modify: `src/server/db/schema.ts`
- Modify: `src/shared/contracts.ts`
- Create: `drizzle/0006_inventory_foundation.sql` (generated from the schema)
- Test: `tests/server/inventory.test.ts`

**Interfaces:**
- Produces `InventoryService` with `getInventory(): InventorySummaryDto[]`, `searchMedicationCatalog(query: string): MedicationDto[]`, `receiveStock(tx, actor, expectedMedicationRevision, payload): InventoryReceiptDto`, and `getReceipt(id): InventoryReceiptDto`.
- Produces `inventorySummarySchema`, `inventoryReceiptSchema`, `inventoryResponseSchema`, `inventoryMedicationSearchResponseSchema`, `receiveInventoryPayloadSchema`, and `receiveInventoryBodySchema` in `src/shared/contracts.ts`.
- `InventorySummaryDto` has `{ medication, onHand, reserved, available, lotCount, nearestExpiry, status }`; `status` is `OK | LOW | OUT | EXPIRED`.

- [ ] **Step 1: Write the failing service tests.** Add tests that call a real test database and assert: an active medication can be received into a future-expiry lot; the resulting on-hand/available values are derived from one positive movement; `1..10` is `LOW`, `>10` is `OK`, zero is `OUT`, and an all-expired positive lot is `EXPIRED`; stale medication revision and non-future expiry fail; a duplicate medication/lot pair fails; updating/deleting a movement fails at the database boundary; and a failed receipt leaves no receipt, lot, or movement row. Audit atomicity is asserted in Task 2 after the audit policy is registered.

- [ ] **Step 2: Run the focused server test and verify RED.** Run `npm run test:server -- tests/server/inventory.test.ts`. Expected: the new imports/contracts/service are missing or the assertions fail because the inventory tables and service do not exist.

- [ ] **Step 3: Add shared Zod contracts.** In `src/shared/contracts.ts`, add ISO date/quantity schemas and the exact DTOs/payload described in the design. Reject unknown keys with `z.strictObject` and use the existing prototype-key protection for command bodies. Keep `MedicationDto` unchanged.

- [ ] **Step 4: Add Drizzle tables and migration.** Define `inventoryLots`, `inventoryReceipts`, `inventoryReceiptLines`, and `inventoryStockMovements` with clinic/staff/medication foreign keys, check constraints, the medication/lot unique key, positive receipt quantities, movement type `RECEIPT`, and triggers named `inventory_receipts_block_update/delete`, `inventory_receipt_lines_block_update/delete`, and `inventory_stock_movements_block_update/delete`. Export the tables from `src/server/db/schema.ts`, then run `npm run db:generate` and inspect the generated `0006` SQL for the same constraints/triggers.

- [ ] **Step 5: Implement the minimum service.** Use the existing `DatabaseHandle`, `AppTransaction`, `MedicationService.assertMedicationRevision`, `assertExpectedRevision`, and injected clock/id factory. Compute the Bangkok clinic date with `Intl.DateTimeFormat` and derive aggregate rows with `SUM(quantityDelta)` and date/status conditions. Insert receipt, line, lot snapshot, movement, and audit through the transaction passed by the route; do not add balance columns.

- [ ] **Step 6: Run the focused test and verify GREEN.** Run `npm run test:server -- tests/server/inventory.test.ts`; fix implementation issues without weakening the assertions. Then run `npm run typecheck:server`.

- [ ] **Step 7: Commit the task.** Run `git add src/server/modules/inventory src/server/db/schema.ts src/shared/contracts.ts drizzle tests/server/inventory.test.ts` and commit with `feat: add inventory foundation persistence`.

### Task 2: Authenticated inventory API, permissions, audit, and idempotency

**Files:**
- Create: `src/server/modules/inventory/routes.ts`
- Modify: `src/server/modules/inventory/index.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/modules/platform/permissions.ts`
- Modify: `src/server/modules/platform/audit.ts`
- Test: `tests/server/inventory.test.ts`

**Interfaces:**
- Consumes `InventoryService` and contracts from Task 1.
- Produces `GET /api/inventory`, `GET /api/inventory/medications?q=...`, and `POST /api/inventory/receipts`.

- [ ] **Step 1: Add failing route tests.** Extend the server test with authenticated assistant and doctor fixtures. Assert assistant can read inventory, search receiving medications, and post a receipt; doctor can read but receives `403` on search/post; anonymous requests receive `401`; stale revision/duplicate lot return the documented error codes; successful receipt appends `inventory.stock-received` with note reason; same key/body replays with `replayed: true`; same key/different body returns `IDEMPOTENCY_CONFLICT`.

- [ ] **Step 2: Run the focused test and verify RED.** Run `npm run test:server -- tests/server/inventory.test.ts`; expected failures are missing permissions/routes/audit policy.

- [ ] **Step 3: Add permissions and audit policy.** Add `inventory:read` and `inventory:receive` to the permission enum. Add both permissions to assistant and only `inventory:read` to doctor. Register `inventory.stock-received` as optional-reason in the audit policy.

- [ ] **Step 4: Implement routes with the existing auth/idempotency patterns.** Require actor permissions before service calls. Parse strict query/body contracts. Use `executeIdempotent` with operation `inventory.receive`, actor scope, request envelope, and service work. Use standard exact envelope storage/replay for this synthetic-only receipt DTO so its aggregate snapshot is not recomputed after later receipts or a date rollover. Return `200` for replay and `201` for the first receipt.

- [ ] **Step 5: Register the module and run GREEN.** Register the inventory service/routes in `src/server/app.ts`, run `npm run test:server -- tests/server/inventory.test.ts`, then run the full `npm run test:server` suite to catch permission regressions (especially the existing assistant `/api/medications` denial).

- [ ] **Step 6: Commit the task.** Run `git add src/server/modules/inventory src/server/app.ts src/server/modules/platform/permissions.ts src/server/modules/platform/audit.ts src/shared/contracts.ts tests/server/inventory.test.ts` and commit with `feat: expose inventory receiving api`.

### Task 3: React Query features and visual-shell screens

**Files:**
- Create: `src/client/features/inventory.ts`
- Create: `src/client/screens/InventoryScreen.tsx`
- Create: `src/client/screens/StockReceptionScreen.tsx`
- Modify: `src/client/app/query-client.ts`
- Modify: `src/client/app/router.tsx`
- Modify: `src/client/app/role-workspace.ts`
- Modify: `src/client/components/careflow/AppShell.tsx`
- Test: `tests/client/inventory.test.tsx`
- Test: `tests/client/router.test.tsx`

**Interfaces:**
- Consumes the inventory contracts and endpoints from Tasks 1–2.
- Produces `useInventory()`, `useInventoryMedicationSearch(query, enabled)`, and `useReceiveInventory()` hooks; routes `/inventory` and `/inventory/receive` remain behind `AuthGate`.

- [ ] **Step 1: Write failing client tests.** Add tests with a real `QueryClient` and fetch fixture that assert the dashboard renders API rows, labels `LOW/OUT/EXPIRED` in Thai, filters by search, shows the receive link only for an assistant, and the receiving form preserves medication/quantity/lot/expiry/supplier draft after a `422` or `IDEMPOTENCY_CONFLICT`. Add a route test that doctor can enter `/inventory` but cannot enter `/inventory/receive` and assistant can enter both.

- [ ] **Step 2: Run focused client tests and verify RED.** Run `npm run test:client -- tests/client/inventory.test.tsx tests/client/router.test.tsx`; expected failures are missing hooks/screens/routes.

- [ ] **Step 3: Implement query keys and feature functions.** Add `inventory` and `inventoryMedicationSearch` keys. Use `ApiClient.get` with the response schemas, and `ApiClient.command` with `createCommandAttempt`/the existing idempotency helper for receipt submission. Invalidate `queryKeys.inventory` after a successful receive.

- [ ] **Step 4: Implement screens using existing components/classes.** Build `InventoryScreen` with `PageHeader`, three summary cards, local search, table, urgent list, and `StatusBadge`; use `inventory-page`, `inventory-summary`, `inventory-layout`, `inventory-table`, and `urgent-restock-card` classes already in `globals.css`. Build `StockReceptionScreen` with async medication search, canonical-unit preview, future date input, impact panel, Thai error text, disabled submit while pending, and draft preservation. Do not copy or edit files in either frozen visual directory.

- [ ] **Step 5: Wire protected routes/navigation and run GREEN.** Add permission-gated routes (`inventory:read` and `inventory:receive`), add a `package` nav icon and Inventory item for both workspaces, and render the receive CTA only when the session has `inventory:receive`. Run the focused client tests, then `npm run typecheck:client` and `npm run lint`.

- [ ] **Step 6: Commit the task.** Run `git add src/client tests/client` and commit with `feat: add inventory dashboard and receiving screens`.

### Task 4: End-to-end smoke flow and whole-slice verification

**Files:**
- Create: `tests/e2e/inventory-foundation.spec.ts`
- Modify: `tests/e2e/fixtures.ts` only if a reusable helper is required by the test.
- No changes: `careflow-webapp/`, `stitch_careflow_clinic_management_system/`.

**Interfaces:**
- Consumes the running pilot routes and seeded synthetic accounts/medications from Tasks 1–3.

- [ ] **Step 1: Write the failing Playwright flow.** Add one test that logs in as assistant, acknowledges the pilot if needed, opens Inventory, visits Receive, searches `DEMO`, selects a medication, enters quantity `10`, lot `E2E-2608`, a future expiry, and supplier, submits, then asserts the dashboard shows `10` and `LOW`. In a second browser context, log in as doctor, assert Inventory is visible/readable, and direct receipt submission is rejected by the server.

- [ ] **Step 2: Run the new E2E test and verify RED.** Run `npm run test:e2e -- tests/e2e/inventory-foundation.spec.ts`; expected failure is the unavailable inventory routes or missing API.

- [ ] **Step 3: Make only test-fixture adjustments required for deterministic isolation.** Reuse `startPilotServer`, `loginAndAcknowledge`, and existing seeded synthetic data. If the test needs a unique lot, keep it in the test payload; do not add production seed data.

- [ ] **Step 4: Run the complete verification set.** Run, in order: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. Record exact pass counts and investigate every failure before moving on.

- [ ] **Step 5: Inspect the diff and frozen directories.** Run `git status --short`, `git diff --stat`, and `git diff --name-only`; confirm no frozen visual directory changed and no generated database file is tracked.

- [ ] **Step 6: Commit the task.** Run `git add tests/e2e/inventory-foundation.spec.ts` and commit with `test: cover inventory foundation pilot flow`.

### Task 5: Review and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-08-careflow-inventory-foundation.md` only for completion notes if needed.
- Create: `.superpowers/sdd/inventory-foundation/progress.md` (git-ignored execution ledger).

- [ ] **Step 1: Request a task-scoped review of the completed slice.** Provide the reviewer the plan, design spec, commit range, and fresh verification output. The reviewer must evaluate both spec compliance and implementation quality.

- [ ] **Step 2: Fix all Critical/Important findings with focused TDD cycles.** Re-run the affected tests and a scoped review after each fix; record deferred Minor findings in the ledger.

- [ ] **Step 3: Run the final verification commands again.** Use the complete set in Task 4 immediately before any completion claim.

- [ ] **Step 4: Update the ledger and hand off.** Summarize the new routes, permissions, migration, test evidence, and explicit Phase 2B boundary (FEFO/reservation/dispensing remains next).
