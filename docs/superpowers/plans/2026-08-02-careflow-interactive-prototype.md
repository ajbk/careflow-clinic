# CareFlow Interactive Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a polished, responsive, Thai-first CareFlow prototype with 14 connected routes, a complete patient workflow, local demo persistence, inventory and appointment mutations, analytics, and print views.

**Architecture:** Use the Sites vinext starter with React client routes backed by a typed `CareFlowProvider` and reducer. Thin route files render focused feature screens; shared domain selectors keep dashboards, queues, inventory, and analytics consistent. Versioned local storage persists demo actions and safely resets invalid data.

**Tech Stack:** TypeScript, React, vinext app router, CSS, Lucide React, Vitest, React Testing Library, localStorage, Cloudflare-compatible Sites hosting.

## Global Constraints

- `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md` is the visual source of truth.
- Use `#003629` primary, `#1b4d3e` primary container, `#f9faf7` surface, `#d5e5ea` secondary container, `#191c1b` text, `#404945` supporting text, `#c0c9c3` subtle outline, `#ba1a1a` error, and `#ffdad6` error container.
- Use Be Vietnam Pro with a Thai-capable glyph fallback, the documented type scale, an 8 px spacing rhythm, 16 px card/button radius, and controls at least 48 px tall.
- Keep all 14 semantic routes from the approved design; never use unstable `SCREEN_n` identifiers.
- Keep clinical screens visually restricted to Doctor mode, while labeling role enforcement as prototype behavior rather than real security.
- Keep signed clinical fields read-only, require all medications before dispensing, deduct stock exactly once, require payment method selection, block unavailable appointment slots, and validate stock reception.
- Keep output Cloudflare Worker-compatible and preserve `.openai/hosting.json`.
- Generate exactly one site-specific social card after the visual direction and copy are stable; omit it if its text is unusable after one retry.

---

## Planned File Map

- `app/layout.tsx` — CareFlow metadata, fonts, providers, social metadata.
- `app/globals.css` — DESIGN.md tokens, base components, responsive layouts, animation, and print rules.
- `app/providers.tsx` — mounts `CareFlowProvider`.
- `app/page.tsx` — overview route.
- `app/intake/page.tsx`, `app/queue/page.tsx`, `app/consultations/[visitId]/page.tsx` — intake and clinical flow.
- `app/dispensing/[visitId]/page.tsx`, `app/dispensing/[visitId]/labels/page.tsx`, `app/checkout/[visitId]/page.tsx`, `app/visits/[visitId]/opd-card/page.tsx` — fulfillment, payment, and print flow.
- `app/patients/[patientId]/history/page.tsx` — longitudinal record.
- `app/inventory/page.tsx`, `app/inventory/receive/page.tsx` — stock workflow.
- `app/appointments/page.tsx`, `app/appointments/new/page.tsx` — calendar workflow.
- `app/analytics/page.tsx` — monthly analytics.
- `components/careflow/AppShell.tsx` — shared responsive navigation and role switch.
- `components/careflow/ui.tsx` — small visual primitives.
- `components/careflow/screens/*.tsx` — one focused screen component per route.
- `lib/careflow/types.ts` — domain types and action union.
- `lib/careflow/seed.ts` — deterministic demo state.
- `lib/careflow/reducer.ts` — validated state transitions.
- `lib/careflow/selectors.ts` — derived queue, KPI, inventory, and analytics values.
- `lib/careflow/storage.ts` — versioned local-storage envelope and fallback.
- `lib/careflow/route-access.ts` — role-aware navigation metadata.
- `tests/careflow/*.test.ts` — domain and selector tests.
- `tests/components/*.test.tsx` — critical interaction tests.

---

### Task 1: Initialize the Sites App and Lock the Visual Foundation

**Files:**
- Create/modify: starter-generated `package.json`, `app/layout.tsx`, `app/globals.css`, `app/providers.tsx`
- Remove: `app/_sites-preview/**` after the product shell replaces it
- Modify: `.openai/hosting.json`
- Test: `tests/setup.ts`

**Interfaces:**
- Produces: global CSS tokens and `.care-card`, `.care-button`, `.care-input`, `.status-pill`, `.page-grid` classes; `Providers({ children })`.

- [ ] **Step 1: Initialize the current workspace once**

Run the Sites initializer with the workspace root as its target, retain the install session until complete, then start the generated dev server and open its exact Local URL once.

- [ ] **Step 2: Add application dependencies**

Add `lucide-react`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, and test scripts without changing the starter package manager.

- [ ] **Step 3: Replace starter metadata and tokens**

Set title to `CareFlow — ระบบจัดการคลินิกชุมชน`, description to `ต้นแบบระบบคลินิกชนบทที่เรียบง่าย เชื่อถือได้ และออกแบบเพื่อการดูแลที่ต่อเนื่อง`, and expose the exact DESIGN.md values as CSS custom properties.

- [ ] **Step 4: Verify the visual foundation**

Run `npm run build`. Expected: successful Worker-compatible production output with no starter-preview import.

- [ ] **Step 5: Commit**

Commit the initialized application and visual foundation as `feat: initialize CareFlow design system`.

---

### Task 2: Implement the Typed Demo Domain and Persistence

**Files:**
- Create: `lib/careflow/types.ts`
- Create: `lib/careflow/seed.ts`
- Create: `lib/careflow/reducer.ts`
- Create: `lib/careflow/selectors.ts`
- Create: `lib/careflow/storage.ts`
- Create: `lib/careflow/route-access.ts`
- Create: `lib/careflow/context.tsx`
- Test: `tests/careflow/reducer.test.ts`
- Test: `tests/careflow/storage.test.ts`
- Test: `tests/careflow/selectors.test.ts`

**Interfaces:**
- Produces: `CareFlowState`, `CareFlowAction`, `careFlowReducer(state, action)`, `seedState`, `loadState(storage)`, `saveState(storage, state)`, `selectDashboardMetrics(state)`, `selectQueueColumns(state)`, and `CareFlowProvider`.

- [ ] **Step 1: Write failing workflow tests**

Cover `SUBMIT_INTAKE`, `START_CONSULTATION`, `SIGN_VISIT`, `CONFIRM_DISPENSING`, `COMPLETE_PAYMENT`, `RECEIVE_STOCK`, `CREATE_APPOINTMENT`, `SET_ROLE`, and `RESET_DEMO`. Assert that dispensing cannot occur with unchecked items, stock decreases once, and a completed payment marks the visit complete.

- [ ] **Step 2: Run tests and verify failure**

Run `npm test -- tests/careflow/reducer.test.ts`. Expected: module-not-found failures for the domain files.

- [ ] **Step 3: Implement exact state and action types**

Use role values `assistant | doctor`, visit statuses `intake | waiting | consulting | awaiting-dispensing | awaiting-payment | complete`, and payment methods `cash | promptpay`. Model patients, visits, medication items, inventory items/batches, appointments, transactions, and toasts.

- [ ] **Step 4: Implement reducer invariants**

Return the prior state plus an error toast for invalid transitions. On valid dispensing, mark medication items prepared and decrement matching inventory exactly once. On reset, return a fresh clone of `seedState`.

- [ ] **Step 5: Implement storage and selectors**

Store `{ version: 1, state }` under `careflow.prototype.v1`. Parse failures, version mismatches, or missing structural keys return a fresh seed. Derive metrics rather than duplicating counts in components.

- [ ] **Step 6: Run tests and verify pass**

Run `npm test -- tests/careflow`. Expected: all domain tests pass.

- [ ] **Step 7: Commit**

Commit as `feat: add connected CareFlow demo state`.

---

### Task 3: Build the Shared Shell and UI Primitives

**Files:**
- Create: `components/careflow/AppShell.tsx`
- Create: `components/careflow/ui.tsx`
- Create: `components/careflow/PatientHeader.tsx`
- Create: `components/careflow/ToastRegion.tsx`
- Modify: `app/providers.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/AppShell.test.tsx`

**Interfaces:**
- Consumes: `CareFlowProvider`, route access metadata, active role.
- Produces: `AppShell`, `PageHeader`, `Card`, `MetricCard`, `StatusBadge`, `Field`, `UnitField`, `ActionButton`, `PatientHeader`, and `ToastRegion`.

- [ ] **Step 1: Write failing role-navigation tests**

Render `AppShell` in Assistant mode and assert that `ห้องตรวจ` and `รายงาน` are absent; switch to Doctor and assert that they appear. Assert that the prototype badge and reset control always render.

- [ ] **Step 2: Run test and verify failure**

Run `npm test -- tests/components/AppShell.test.tsx`. Expected: missing component failure.

- [ ] **Step 3: Implement desktop and mobile shells**

Use the soft-blue tonal sidebar on desktop, a compact top bar and bottom navigation on mobile, visible active-route state, 48 px controls, skip link, keyboard focus, role toggle, clinic-open indicator, and reset confirmation.

- [ ] **Step 4: Implement reusable primitives**

Keep primitives semantic and small. Use buttons for actions, links for navigation, labels bound to fields, `aria-live` for toasts, and status text in addition to color.

- [ ] **Step 5: Run tests and build**

Run `npm test -- tests/components/AppShell.test.tsx && npm run build`. Expected: pass.

- [ ] **Step 6: Commit**

Commit as `feat: add responsive CareFlow application shell`.

---

### Task 4: Implement the Connected Patient Journey

**Files:**
- Create: `components/careflow/screens/IntakeScreen.tsx`
- Create: `components/careflow/screens/QueueScreen.tsx`
- Create: `components/careflow/screens/ConsultationScreen.tsx`
- Create: `components/careflow/screens/DispensingScreen.tsx`
- Create: `components/careflow/screens/LabelsScreen.tsx`
- Create: `components/careflow/screens/CheckoutScreen.tsx`
- Create: `components/careflow/screens/OpdCardScreen.tsx`
- Create: `components/careflow/screens/PatientHistoryScreen.tsx`
- Create/modify: the corresponding eight route files
- Test: `tests/components/patient-flow.test.tsx`

**Interfaces:**
- Consumes: context actions and selectors from Task 2, primitives from Task 3.
- Produces: the eight patient-flow routes and their print views.

- [ ] **Step 1: Write failing critical-interaction tests**

Assert that intake requires name, temperature, blood pressure, and chief complaint; consultation sign-off requires assessment; dispensing CTA stays disabled until every checkbox is selected; checkout requires a payment method; signed fields are disabled.

- [ ] **Step 2: Run test and verify failure**

Run `npm test -- tests/components/patient-flow.test.tsx`. Expected: missing screen modules.

- [ ] **Step 3: Implement intake and queue**

Create the Thai-first identity/vitals form and three-column queue. Successful intake dispatches `SUBMIT_INTAKE`, shows a success toast, and navigates to `/queue`. Queue cards expose only context-valid actions.

- [ ] **Step 4: Implement consultation and history**

Show allergy alert, recent visits, vitals, SOAP fields, ICD-10 selection, and medication plan. `SIGN_VISIT` makes fields read-only and advances status. History shows profile, visit summary, weight trend, and encounter timeline.

- [ ] **Step 5: Implement dispensing, labels, checkout, and OPD card**

Medication cards require preparation checks. Successful confirmation decrements inventory and routes to labels. Labels call `window.print()`. Checkout supports Cash and PromptPay selection and advances to complete. OPD card renders immutable visit content with print action.

- [ ] **Step 6: Run tests and build**

Run `npm test -- tests/components/patient-flow.test.tsx && npm run build`. Expected: pass.

- [ ] **Step 7: Commit**

Commit as `feat: connect CareFlow patient journey`.

---

### Task 5: Implement Dashboard, Inventory, Appointments, and Analytics

**Files:**
- Create: `components/careflow/screens/OverviewScreen.tsx`
- Create: `components/careflow/screens/InventoryScreen.tsx`
- Create: `components/careflow/screens/StockReceptionScreen.tsx`
- Create: `components/careflow/screens/AppointmentsScreen.tsx`
- Create: `components/careflow/screens/NewAppointmentScreen.tsx`
- Create: `components/careflow/screens/AnalyticsScreen.tsx`
- Create/modify: the corresponding six route files
- Test: `tests/components/operations.test.tsx`

**Interfaces:**
- Consumes: shared domain state, selectors, shell, and UI primitives.
- Produces: six operational routes whose metrics update from shared demo actions.

- [ ] **Step 1: Write failing operational tests**

Assert that stock reception previews and commits `current + received`, invalid expiry is rejected, unavailable appointment slots are disabled, new appointments render on the week calendar, and dashboard metrics reflect state transitions.

- [ ] **Step 2: Run test and verify failure**

Run `npm test -- tests/components/operations.test.tsx`. Expected: missing screen modules.

- [ ] **Step 3: Implement overview and inventory**

Build KPI cards, live patient journey, quick actions, medication registry, urgent restock panel, low/depleted states, search, and links to stock reception. Use derived values from selectors.

- [ ] **Step 4: Implement stock reception**

Build medication search, positive quantity, unit, supplier, required batch, future expiry, live stock impact preview, cancel, and confirmation. Dispatch `RECEIVE_STOCK` and return to inventory.

- [ ] **Step 5: Implement appointments**

Build the weekly time grid with Thai Buddhist-calendar display, seeded events, current-day treatment, view toggle, and new-appointment form with patient selection, date, time chips, reason, notes, and conflict prevention.

- [ ] **Step 6: Implement analytics**

Render patient volume, consultations, revenue, low stock, a data-driven volume chart, ranked diagnoses, and medication usage table. Correct the erroneous source year `2523` to `2566` for October 2023.

- [ ] **Step 7: Run tests and build**

Run `npm test -- tests/components/operations.test.tsx && npm run build`. Expected: pass.

- [ ] **Step 8: Commit**

Commit as `feat: add CareFlow clinic operations screens`.

---

### Task 6: Finish Print, Metadata, Social Preview, and Release Validation

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create after validation: `public/og.png`
- Modify: tests only if release checks expose an actual defect

**Interfaces:**
- Consumes: all screens and final copy.
- Produces: responsive and printable release candidate with product-specific metadata.

- [ ] **Step 1: Add exact print rules**

Use `@page { size: A4; }` for OPD output and route-specific `@page { size: 80mm 100mm; margin: 0; }` behavior for labels. Hide navigation, action bars, toasts, and prototype chrome in print media.

- [ ] **Step 2: Complete responsive and accessibility checks**

Verify 375 px, 768 px, and 1440 px layouts; visible focus; no horizontal overflow outside the calendar/queue scrollers; labeled controls; status text independent of color; and keyboard-operable interactions.

- [ ] **Step 3: Generate and inspect one social card**

Generate a landscape card using the finished CareFlow title, Thai-first clinic copy, forest-green palette, soft-blue tonal layer, white cards, and calm healthcare motif. Inspect all text; retry once only if unusable. Save an accepted card to `public/og.png` and wire absolute request-host metadata.

- [ ] **Step 4: Run complete verification**

Run `npm test` and `npm run build`. Then visit all 14 routes and manually complete intake → queue → consultation → dispensing → labels → checkout → OPD, receive stock, create an appointment, switch roles, reset data, and open both print previews.

- [ ] **Step 5: Commit**

Commit as `feat: finish CareFlow prototype`.

- [ ] **Step 6: Publish with Sites**

Use the Sites hosting workflow, preserve the local dev process until publishing succeeds, return the deployed private URL, and then stop the retained dev server.

