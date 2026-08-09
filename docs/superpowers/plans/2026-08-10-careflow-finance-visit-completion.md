# CareFlow Finance and Visit Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the synthetic-only Pilot from `AWAITING_CHARGE` through immutable Charge, Cash/PromptPay/full waiver, Doctor close, and Doctor-only A4 OPD Card.

**Architecture:** Extend the existing Fastify/TypeScript modular monolith with a deep Finance module and a small Visit Completion workflow. Prices are snapshotted into signed medication and dispense evidence, Finance owns immutable Charge/Adjustment/Payment rows, and close re-reads the complete evidence chain inside the caller-owned audited immediate transaction before writing one immutable VisitClosure.

**Tech Stack:** Node.js 22, TypeScript, Fastify, SQLite WAL, Drizzle ORM/migrations, Zod, React 19, TanStack Query, Vitest, Testing Library, and Playwright.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-10-careflow-finance-visit-completion-design.md` and is authoritative for Milestone 4.
- All money is non-negative safe-integer BAHT. DTO/TypeScript names end in `Baht`; physical SQLite columns end in `_baht`. Never accept decimals, floats, client totals, overpayment, underpayment, or rounding.
- Migrations `0000`–`0015` and their metadata are immutable. Add only `0016`–`0018` and matching Drizzle journal/snapshots.
- Use the existing caller-owned audited `BEGIN IMMEDIATE` transaction and exact idempotent envelope. Domain evidence, Visit transition, audit, and idempotency response commit or roll back together.
- Strict Zod contracts reject unknown/prototype keys. First successful POST returns `201`; same-key/same-payload replay returns stored data with `200`; same-key/different-payload returns `IDEMPOTENCY_CONFLICT` without writes.
- Assistant may read Finance and record exact Cash only. Doctor may finalize Charge, record Cash, confirm PromptPay, approve full waiver, close Visit, and read OPD. OPD/SOAP/diagnosis are Doctor-only at both API and UI boundaries.
- Preserve the existing Stitch-derived UI/CSS, Thai copy, responsive behavior, print conventions, and synthetic-data banner. Do not modify `careflow-webapp/` or `stitch_careflow_clinic_management_system/`.
- Do not add partial payment, split tender, refund, void, reopen, receipt/tax invoice, price-management UI, bank/QR integration, backup/restore, deployment, HTTPS, analytics, or real-patient behavior.
- Each task is implemented test-first by GPT-5.6 Terra Max, committed only after green verification, then reviewed read-only by GPT-5.6 Sol Max. All Critical/Important findings must be fixed and re-reviewed before the next task.

---

### Task 1: Integer-Baht Price Masters and Immutable Price Snapshots

**Files:**

- Create: `careflow-pilot/drizzle/0016_finance_pricing_snapshots.sql`
- Create: `careflow-pilot/drizzle/meta/0016_snapshot.json`
- Modify: `careflow-pilot/drizzle/meta/_journal.json`
- Create: `careflow-pilot/src/server/modules/finance/schema.ts`
- Create: `careflow-pilot/src/server/modules/finance/pricing.ts`
- Create: `careflow-pilot/src/server/modules/finance/index.ts`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/server/modules/platform/schema.ts`
- Modify: `careflow-pilot/src/server/modules/medication/schema.ts`
- Modify: `careflow-pilot/src/server/modules/medication/service.ts`
- Modify: `careflow-pilot/src/server/modules/fulfillment/schema.ts`
- Modify: `careflow-pilot/src/server/modules/fulfillment/service.ts`
- Modify: `careflow-pilot/src/server/maintenance/reset-synthetic.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/finance-pricing.test.ts`
- Modify: `careflow-pilot/tests/server/database-artifacts.test.ts`
- Modify: `careflow-pilot/tests/server/health.test.ts`
- Modify: `careflow-pilot/tests/server/reset-synthetic-data.test.ts`

**Interfaces:**

```ts
type PriceSnapshot = {
  unitPriceBaht: number;
  currency: "THB";
  sourceMedicationId: string;
  sourceMedicationRevision: number;
};

snapshotOrderPrices(tx, medicationDecisionId): void;
snapshotDispensePrices(tx, dispenseId): void;
deriveChargeQuote(tx, visitId, expectedClinicPricingRevision): ChargeQuote;
```

- [ ] **Step 1: Write RED pricing and migration tests.** Assert `consultationFeeBaht=100`, medication fixture prices `5/10/50/15`, integer/upper-bound checks, missing/decimal/unsafe values rejected, one snapshot per signed Order Item/Dispense Line, append-only triggers, exact price propagation, and unchanged snapshots after master edits.

- [ ] **Step 2: Write RED populated-upgrade/reset tests.** Build an applied `0015` database containing signed ORDER, signed `NO_MEDICATION`, multi-lot Dispense, Stock Movements, and `AWAITING_CHARGE`; apply `0016`; assert old IDs/revisions/hashes/quantities/balances remain byte-equivalent, FK stays on, `foreign_key_check` is empty, price snapshots backfill deterministically, and migration `0000`–`0015` hashes are unchanged.

- [ ] **Step 3: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/finance-pricing.test.ts tests/server/database-artifacts.test.ts tests/server/reset-synthetic-data.test.ts tests/server/health.test.ts
```

Expected: failure because migration `0016`, price fields, Finance pricing exports, snapshot tables, and reset lifecycle support do not exist.

- [ ] **Step 4: Implement migration and schema.** Add `clinic_config.consultation_fee_baht/pricing_revision`, `medications.unit_price_baht`, `medication_order_price_snapshots`, and `fulfillment_dispense_price_snapshots`; enforce `THB`, integer ranges, one-to-one source uniqueness, exact source medication/price propagation, and update/delete blockers. Generate only `0016` metadata.

- [ ] **Step 5: Implement snapshot timing.** Call `snapshotOrderPrices` inside signed ORDER creation/revision and `snapshotDispensePrices` inside successful Handoff before the result commits. `NO_MEDICATION` creates no medication snapshot. Use deterministic IDs/backfill for existing synthetic evidence without modifying append-only parent rows.

- [ ] **Step 6: Update contracts/reset/health.** Add strict integer-Baht DTO fields and canonical reset order/trigger restoration. Preserve Clinic/Medication masters and verify exact fixture prices after reset.

- [ ] **Step 7: Run GREEN and full server verification.** Run the focused command, then `npm run test:server`, `npm run typecheck:server`, `npm run lint`, `npm run db:generate`, and `git diff --check`.

- [ ] **Step 8: Commit.** Commit with `feat: add integer baht price snapshots` and request GPT-5.6 Sol Max review of migration identity, arithmetic, snapshot timing, rollback, and reset safety.

---

### Task 2: Server-Derived Checkout and Immutable Charge Finalization

**Files:**

- Create: `careflow-pilot/drizzle/0017_charge_collection_ledger.sql`
- Create: `careflow-pilot/drizzle/meta/0017_snapshot.json`
- Modify: `careflow-pilot/drizzle/meta/_journal.json`
- Modify: `careflow-pilot/src/server/modules/finance/schema.ts`
- Create: `careflow-pilot/src/server/modules/finance/service.ts`
- Create: `careflow-pilot/src/server/modules/finance/routes.ts`
- Modify: `careflow-pilot/src/server/modules/finance/index.ts`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/server/modules/platform/permissions.ts`
- Modify: `careflow-pilot/src/server/modules/platform/audit.ts`
- Modify: `careflow-pilot/src/server/errors.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/finance-charge.test.ts`
- Create: `careflow-pilot/tests/server/finance-routes.test.ts`
- Modify: `careflow-pilot/tests/server/database-artifacts.test.ts`
- Modify: `careflow-pilot/tests/server/clinical-schema.test.ts`

**Interfaces:**

```ts
createFinanceService({ database, pricing, clock, idFactory }): {
  getCheckout(actor, visitId): CheckoutDto;
  finalizeCharge(tx, actor, visitId, command): CheckoutDto;
  readResolution(tx, visitId): FinanceResolution;
};
```

- `GET /api/checkout/:visitId` requires `finance:read`.
- `POST /api/checkout/:visitId/charge-finalizations` requires `finance:finalize-charge` and body `{ expectedRevisions: { visit, clinicPricing }, payload: { settlementIntent: "COLLECT" } | { settlementIntent: "FULL_WAIVER", waiverReason } }`.

- [ ] **Step 1: Write RED schema/service tests.** Assert one Charge per Visit, one consultation line, medication line per actual Dispense Line, `lineTotalBaht=quantity*unitPriceBaht`, derived gross `1..100_000_000`, ORDER requires current Dispense/prices, `NO_MEDICATION` has consultation only, source clinic/visit/decision/dispense integrity, append-only rows, content hash determinism, and no stored gross aggregate.

- [ ] **Step 2: Write RED route/idempotency tests.** Cover anonymous/Assistant finalize denial, Doctor preview/finalize, strict unknown bodies, stale Visit/pricing revisions, missing snapshots, first `201`, same-key replay `200` with byte-equivalent result, collision `409`, different-key domain duplicate, concurrency, and injected audit/Visit/idempotency failures with zero partial rows.

- [ ] **Step 3: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:server -- tests/server/finance-charge.test.ts tests/server/finance-routes.test.ts tests/server/database-artifacts.test.ts tests/server/clinical-schema.test.ts
```

Expected: failure because migration `0017`, Finance service/routes, permissions, audit taxonomy, and Checkout contracts are absent.

- [ ] **Step 4: Implement ledger migration.** Create `finance_charges`, `finance_charge_lines`, `finance_charge_adjustments`, and `finance_payments` with exact constraints/guards from the design. `0017` creates no Charge for existing Visits. Add append-only update/delete blockers and unique/source-integrity triggers.

- [ ] **Step 5: Implement Checkout read model.** Before finalize, derive preview exclusively from current signed decision, consultation master, actual Dispense price snapshots, and actor permissions. After finalize, return only immutable Charge evidence. Never return SOAP/diagnosis to either role.

- [ ] **Step 6: Implement audited finalization route.** Permission-check before service work, strict-parse, call `executeIdempotent` with operation `finance.finalize-charge.v1`, re-read all sources under the immediate lock, insert header/ordered lines, append `charge.finalized`, conditionally transition `AWAITING_CHARGE→AWAITING_PAYMENT`, and store the exact response envelope atomically.

- [ ] **Step 7: Add stable errors.** Add `FINANCE_NOT_READY`, `CHARGE_SOURCE_INCOMPLETE`, `PRICE_SNAPSHOT_MISSING`, and `CHARGE_ALREADY_FINALIZED` as HTTP 409 shared codes with focused assertions.

- [ ] **Step 8: Run GREEN/full checks and commit.** Run focused tests, full server tests, server typecheck, lint, DB generation/check, diff-check; commit `feat: finalize immutable visit charges`; request Sol Max review.

---

### Task 3: Exact Cash, Doctor PromptPay, and Full Waiver

**Files:**

- Modify: `careflow-pilot/src/server/modules/finance/service.ts`
- Modify: `careflow-pilot/src/server/modules/finance/routes.ts`
- Modify: `careflow-pilot/src/server/modules/platform/permissions.ts`
- Modify: `careflow-pilot/src/server/modules/platform/audit.ts`
- Modify: `careflow-pilot/src/server/errors.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Create: `careflow-pilot/tests/server/finance-collection.test.ts`
- Create: `careflow-pilot/tests/server/finance-concurrency.test.ts`

**Interfaces:**

```ts
approveFullWaiver(tx, actor, visitId, { chargeId, reason, expectedVisitRevision }): CheckoutDto;
recordCash(tx, actor, visitId, { chargeId, amountBaht, expectedVisitRevision }): CheckoutDto;
confirmPromptPay(tx, actor, visitId, { chargeId, amountBaht, manualReference, expectedVisitRevision }): CheckoutDto;
```

- [ ] **Step 1: Write RED collection tests.** Assert full waiver is exactly negative gross, requires trimmed reason, and creates `COLLECTION_NOT_REQUIRED`; Cash/PromptPay amount must equal current net due; PromptPay reference is required and manual only; Cash reference is null; all money is integer Baht.

- [ ] **Step 2: Write RED role/race/idempotency tests.** Assistant and Doctor may Cash; only Doctor may PromptPay/waive. Cover direct 403, stale revision, duplicate method, Cash/PromptPay/waiver races with at most one winner, no Payment plus waiver, first/replay/collision envelopes, different-key duplicates, exact audit metadata/reason, and injected rollback.

- [ ] **Step 3: Run RED.** Run `npm run test:server -- tests/server/finance-collection.test.ts tests/server/finance-concurrency.test.ts tests/server/finance-routes.test.ts`; expect missing commands/routes/permissions/errors.

- [ ] **Step 4: Implement strict routes.** Add exact paths `/waivers`, `/payments/cash`, and `/payments/promptpay`; use operations `finance.approve-waiver.v1`, `finance.record-cash.v1`, and `finance.confirm-promptpay.v1`; never accept recipient, QR, bank confirmation, totals, or actor IDs from the browser.

- [ ] **Step 5: Implement terminal resolution transactions.** Re-read Charge completeness and net due under lock; insert one adjustment or payment; append `charge.waiver-approved`, `payment.cash-recorded`, or `payment.promptpay-confirmed`; conditionally transition `AWAITING_PAYMENT→READY_TO_CLOSE`; write exact idempotent result in the same transaction.

- [ ] **Step 6: Add stable errors.** Add `WAIVER_NOT_ALLOWED`, `PAYMENT_AMOUNT_MISMATCH`, and `PAYMENT_ALREADY_RECORDED` as 409 codes. Validation errors remain 422 for missing reason/reference or non-integer amount.

- [ ] **Step 7: Run GREEN/full checks and commit.** Run focused/full server tests, typecheck, lint, build-server, diff-check; commit `feat: add cash promptpay and waiver collection`; request Sol Max review of amount/role/race/evidence integrity.

---

### Task 4: Thai Checkout, Queue, and Overview Workflow

**Files:**

- Create: `careflow-pilot/src/client/features/finance.ts`
- Create: `careflow-pilot/src/client/screens/CheckoutScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/QueueScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/OverviewScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/DispensingScreen.tsx`
- Modify: `careflow-pilot/src/client/app/query-client.ts`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Modify: `careflow-pilot/src/client/styles/globals.css`
- Create: `careflow-pilot/tests/client/checkout.test.tsx`
- Modify: `careflow-pilot/tests/client/queue.test.tsx`
- Modify: `careflow-pilot/tests/client/router.test.tsx`
- Modify: `careflow-pilot/tests/client/query-client.test.ts`

**Interfaces:**

- `useCheckout`, `useFinalizeCharge`, `useApproveWaiver`, `useRecordCash`, and `useConfirmPromptPay` use shared schemas, explicit attempt objects, mutation retry disabled, and invalidate Checkout/Queue/Overview after commit.
- `/checkout/:visitId` replaces the unavailable placeholder.

- [ ] **Step 1: Write RED client tests.** Cover preview/finalized/paid/waived/closed states, exact whole-Baht Thai formatting, line evidence, allowed actions by role, Doctor finalize, Assistant/Doctor Cash, Doctor PromptPay/manual reference, Doctor waiver/reason, loading/unavailable/403/validation/stale/conflict, preserved drafts, deliberate retry key reuse, and duplicate-submit blocking.

- [ ] **Step 2: Write RED Queue/Overview/navigation tests.** Add `AWAITING_PAYMENT` and `READY_TO_CLOSE` counts/cards/Thai labels with role-appropriate `/checkout/:visitId` links; CLOSED leaves active queue; Consultation/Dispensing link truthfully to Checkout at `AWAITING_CHARGE`.

- [ ] **Step 3: Run RED.** Run:

```sh
cd careflow-pilot
npm run test:client -- tests/client/checkout.test.tsx tests/client/queue.test.tsx tests/client/router.test.tsx tests/client/query-client.test.ts
```

Expected: unavailable route and missing Finance hooks/screen/status fields.

- [ ] **Step 4: Implement Finance hooks and attempts.** Generate a fresh key per deliberate user intent, retain it across transport retries, never auto-retry commands, and invalidate queries only after committed success.

- [ ] **Step 5: Implement CheckoutScreen with existing primitives.** Left column renders server lines/gross/waiver/net due. Right column renders one role/state job: Doctor finalize/full waiver, exact Cash, Doctor PromptPay/manual reference, READY_TO_CLOSE waiting, or CLOSED read-only. Inputs never calculate or edit server totals.

- [ ] **Step 6: Update Queue/Overview/routes/styles.** Reuse PageHeader/Card/ActionButton/TextAreaField and existing `.checkout-*` CSS; add responsive/focus/error states without creating a second design system.

- [ ] **Step 7: Run GREEN/full checks and commit.** Run focused/full client tests, client typecheck, lint, client build, diff-check; commit `feat: add Thai finance checkout workflow`; request Sol Max UI/accessibility/permission/stale-state review.

---

### Task 5: Doctor Close Gate and Doctor-Only A4 OPD Card

**Files:**

- Create: `careflow-pilot/drizzle/0018_visit_closure_integrity.sql`
- Create: `careflow-pilot/drizzle/meta/0018_snapshot.json`
- Modify: `careflow-pilot/drizzle/meta/_journal.json`
- Modify: `careflow-pilot/src/server/db/schema.ts`
- Modify: `careflow-pilot/src/server/modules/visit/schema.ts`
- Modify: `careflow-pilot/src/server/modules/visit/service.ts`
- Modify: `careflow-pilot/src/server/modules/visit/routes.ts`
- Modify: `careflow-pilot/src/server/modules/finance/service.ts`
- Modify: `careflow-pilot/src/server/modules/platform/permissions.ts`
- Modify: `careflow-pilot/src/server/modules/platform/audit.ts`
- Create: `careflow-pilot/src/server/workflows/visit-completion.ts`
- Modify: `careflow-pilot/src/server/app.ts`
- Modify: `careflow-pilot/src/server/errors.ts`
- Modify: `careflow-pilot/src/shared/contracts.ts`
- Modify: `careflow-pilot/src/client/features/finance.ts`
- Modify: `careflow-pilot/src/client/screens/CheckoutScreen.tsx`
- Create: `careflow-pilot/src/client/screens/OpdCardScreen.tsx`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Modify: `careflow-pilot/src/client/styles/globals.css`
- Create: `careflow-pilot/tests/server/visit-completion.test.ts`
- Create: `careflow-pilot/tests/server/visit-completion-routes.test.ts`
- Modify: `careflow-pilot/tests/server/database-artifacts.test.ts`
- Modify: `careflow-pilot/tests/server/clinical-schema.test.ts`
- Create: `careflow-pilot/tests/client/opd-card.test.tsx`
- Modify: `careflow-pilot/tests/client/checkout.test.tsx`

**Interfaces:**

```ts
createVisitCompletionWorkflow({ database, visits, finance, notes, medications, fulfillment, clock, idFactory }): {
  closeVisit(tx, actor, visitId, command): VisitClosureDto;
  getOpdCard(actor, visitId): OpdCardDto;
};
```

- `POST /api/visits/:visitId/close` requires `visit:close` and pins Visit revision, Charge ID, and exactly one Payment/waiver resolution ID.
- `GET /api/visits/:visitId/opd-card` requires `opd:read`; Assistant receives 403 before clinical evidence is read.

- [ ] **Step 1: Write RED close-gate truth-table tests.** Cover Charge absent/incomplete, unresolved collection, mismatched IDs, Payment amount mismatch, waiver not zero, pending workflow, stale Visit, Assistant direct 403, Doctor success, one Closure, `closedAt` equality, `READY_TO_CLOSE→CLOSED`, reopen denial, and no-write rollback at each injected failure.

- [ ] **Step 2: Write RED OPD/privacy tests.** Assert only CLOSED Doctor reads OPD; Assistant Finance/OPD responses contain no SOAP/diagnosis/plan/hashes; projection includes closure clinic/patient/doctor snapshots, signed note/diagnosis and addenda, actual Dispense or `NO_MEDICATION`, Charge lines, resolution, timestamps, content hashes, and synthetic-only banner. Source master edits do not alter closure snapshots; post-close note amendment appears as an addendum without changing Closure.

- [ ] **Step 3: Write RED client/A4 tests.** Doctor sees close action and OPD link; Assistant sees waiting/read-only state and no link; direct OPD route is protected; A4 print hides app chrome and renders Thai sections without overflow at 375/768/1440 and print media.

- [ ] **Step 4: Run RED.** Run focused server/client commands for the new tests; expect missing migration, workflow, permissions, contracts, route, screen, and print behavior.

- [ ] **Step 5: Implement migration and workflow.** Add immutable `visit_closures`, resolution/source guards, append-only triggers, Closure-before-CLOSED/timestamp/reopen Visit guards. Under one immediate transaction re-read every source, insert Closure with canonical content hash, update Visit once, append `visit.closed`, and store exact replay.

- [ ] **Step 6: Implement Doctor-only OPD projection/UI.** Render structured DTO from immutable evidence plus closure snapshots; never store rendered HTML and never expose clinical content in Checkout. Reuse `.opd-card` and `@page opd-card` styles with Doctor-only AuthGate/permission checks.

- [ ] **Step 7: Add stable errors.** Add `VISIT_CLOSE_BLOCKED` and `OPD_CARD_NOT_READY` as 409 codes with stable `fieldErrors` keys `charge`, `collection`, and `visitState`.

- [ ] **Step 8: Run GREEN/full checks and commit.** Run focused/full server and client tests, typecheck, lint, build, DB generation/check, diff-check; commit `feat: close visits with Doctor-only OPD cards`; request Sol Max review of close atomicity, privacy, immutability, projection, and print.

---

### Task 6: Full Pilot Flow, Reset, Restart, Upgrade, and Final Review

**Files:**

- Modify: `careflow-pilot/src/server/maintenance/reset-synthetic.ts`
- Modify: `careflow-pilot/tests/server/health.test.ts`
- Modify: `careflow-pilot/tests/server/database-artifacts.test.ts`
- Modify: `careflow-pilot/tests/server/restart.test.ts`
- Modify: `careflow-pilot/tests/server/reset-synthetic-data.test.ts`
- Modify: `careflow-pilot/tests/server/clinical-schema.test.ts`
- Create: `careflow-pilot/tests/e2e/finance-visit-completion.spec.ts`
- Modify: `careflow-pilot/tests/e2e/fixtures.ts` only for reusable synthetic helpers
- Modify: `careflow-pilot/README.md`
- Update: `.superpowers/sdd/2026-08-10-careflow-finance-visit-completion/progress.md`

- [ ] **Step 1: Write RED two-browser E2E.** Use one temporary server and Doctor/Assistant BrowserContexts for: ORDER→Dispense→Doctor finalize→Assistant Cash→Doctor close→Doctor OPD; ORDER→Doctor PromptPay→close; `NO_MEDICATION`→finalize with full waiver→close. Assert exact integer-Baht lines/totals, statuses, actor roles, audit/evidence IDs, OPD privacy, and no duplicate rows.

- [ ] **Step 2: Add safety E2E.** Cover deliberate retry/double-click, stale revisions, concurrent Cash/PromptPay/waiver with one winner, Assistant direct finalize/PromptPay/waiver/close/OPD denials, restart after Charge and after Payment, A4 print dimensions/no app chrome, and CLOSED removal from active queue.

- [ ] **Step 3: Update lifecycle evidence.** Assert 19 migrations, exact tables/triggers, populated `0015→0018` upgrade with old hashes/IDs/totals preserved, FK on/empty check, canonical reset dependency order/audit cleanup/fixture retention, restart persistence, and no tracked SQLite/frozen-directory artifacts.

- [ ] **Step 4: Run complete verification fresh.** From `careflow-pilot` run:

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run db:generate
git diff --check
git status --short
```

Record exact client/server/E2E counts, migration upgrade result, build result, and non-blocking bundle warnings in the Task 6 report and progress ledger.

- [ ] **Step 5: Review acceptance criteria line by line.** Map every design criterion to a named server/client/E2E/migration test: integer Baht, snapshots, ORDER/NO_MEDICATION, role denials, Charge/collection races, close gate, privacy, OPD A4, idempotency, reset/restart/upgrade.

- [ ] **Step 6: Request final GPT-5.6 Sol Max review.** Provide the approved spec, this plan, all task reports, the complete `615b22b..HEAD` diff, migration hashes/upgrade evidence, and fresh verification output. Fix every Critical/Important through a focused Terra Max RED→GREEN loop and request scoped re-review.

- [ ] **Step 7: Commit final evidence.** Update README to mark synthetic Milestone 4 complete and keep backup/deployment/real-data use disabled. Commit `test: cover finance and visit completion pilot flow`.

- [ ] **Step 8: Stop for user acceptance.** Report implemented scope, exact verification, final Sol verdict, known non-blocking follow-ups, and do not start backup/deployment/hardening without a new user request.

## Plan Self-Review

- Spec coverage: pricing snapshots, Charge, collection, queue/UI, close, Doctor-only OPD, migrations, reset/restart/upgrade, concurrency, privacy, and final review are each owned by one task.
- Placeholder scan: no TBD/TODO or undefined “implement similarly” steps remain.
- Type consistency: all monetary fields use `*Baht`; physical fields use `*_baht`; routes and operation names match the approved spec; `createFinanceService` feeds `createVisitCompletionWorkflow`.
- Scope check: backup/restore, deployment, hardening, price-management UI, partial collection, receipts/tax, QR/bank integration, analytics, and real patients remain outside Milestone 4.
