# CareFlow Role-Focused Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Assistant and Doctor journeys visibly and securely role-focused while preserving the existing CareFlow design system, shared Queue data, and Local Pilot backend.

**Architecture:** Keep one authenticated React application and derive role home, workspace identity, and operational navigation from the server session through one pure role-workspace mapping. Use route-aware shell modes for focused Intake and clinical Consultation. Enforce the clinical boundary twice: `AuthGate` blocks Assistant rendering and Fastify blocks Assistant workspace reads.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, TypeScript 5.9, Fastify 5, SQLite/Drizzle, Vitest, Testing Library, MSW, Playwright, existing Rural Health Commons CSS.

## Global Constraints

- Preserve `careflow-pilot/src/client/styles/globals.css` tokens: Deep Green `#003629`, Warm Off-White `#f9faf7`, Soft Blue `#d5e5ea`, Be Vietnam Pro, 1120px maximum content width, 8px spacing rhythm, and 48px minimum controls.
- Preserve server-backed session, Queue, Patient, Intake, and Visit state; do not introduce a role query parameter, role switch, localStorage application data, new table, or new API response shape.
- Assistant `/` lands on `/intake`; Doctor `/` lands on `/queue`; shared Overview lives at `/overview`.
- Assistant must not render or fetch Doctor Consultation content, and direct `GET /api/visits/:visitId/workspace` must return `403` for Assistant.
- Clinical note authoring stays unavailable/read-only until its backend milestone; no placeholder clinical write may be sent or stored.
- Preserve the permanent synthetic-only Pilot banner and existing loading, stale-data, conflict, retry, keyboard, mobile drawer, and responsive behavior.
- Do not stage or modify the unrelated root `.DS_Store` or untracked `stitch_careflow_clinic_management_system/` reference directory.

---

### Task 1: Enforce Doctor-Only Consultation Workspace Reads

**Files:**
- Modify: `careflow-pilot/tests/server/visit.test.ts`
- Modify: `careflow-pilot/tests/server/restart.test.ts`
- Modify: `careflow-pilot/src/server/modules/visit/routes.ts`

**Interfaces:**
- Consumes: existing `requireActor(request, permission)` and `visit:start-consultation` Doctor-only permission.
- Produces: unchanged `GET /api/visits/:visitId/workspace` response for Doctor; `403 FORBIDDEN` for Assistant before `VisitService.getWorkspace` runs.

- [ ] **Step 1: Write the failing server authorization assertions**

Add an Assistant request for the existing Visit and make the unknown-Visit assertion with the Doctor cookie:

```ts
const assistantWorkspace = await test.app.inject({
  method: "GET",
  url: `/api/visits/${visitId}/workspace`,
  headers: { cookie: test.assistantCookie },
});
expect(assistantWorkspace.statusCode).toBe(403);
expect(assistantWorkspace.json().error.code).toBe("FORBIDDEN");

const unknown = await test.app.inject({
  method: "GET",
  url: "/api/visits/unknown-visit/workspace",
  headers: { cookie: test.doctorCookie },
});
expect(unknown.statusCode).toBe(404);
```

- [ ] **Step 2: Run RED for the real Fastify boundary**

Run:

```bash
cd careflow-pilot
npm run test:server -- tests/server/visit.test.ts -t "returns a committed Workspace aggregate"
```

Expected: FAIL because the Assistant request currently returns `200`.

- [ ] **Step 3: Tighten the existing route and restart fixture**

Change only the workspace permission:

```ts
input.app.get("/api/visits/:visitId/workspace", async (request) => {
  const actor = requireActor(request, "visit:start-consultation");
  const params = request.params as { visitId?: string };
  return { data: input.visits.getWorkspace(params.visitId ?? "", actor) };
});
```

In `restart.test.ts`, use `doctorCookie` for `workspaceBefore` and `workspaceAfter`; Queue remains readable by both roles.

- [ ] **Step 4: Run GREEN and the server regression suite**

Run:

```bash
npm run test:server -- tests/server/visit.test.ts tests/server/restart.test.ts
```

Expected: both files PASS; the Doctor sees the same committed snapshot before and after restart.

- [ ] **Step 5: Commit the privacy boundary**

```bash
git add careflow-pilot/tests/server/visit.test.ts careflow-pilot/tests/server/restart.test.ts careflow-pilot/src/server/modules/visit/routes.ts
git commit -m "fix(pilot): protect doctor consultation workspace"
```

---

### Task 2: Add Role Home and Navigation Contracts

**Files:**
- Create: `careflow-pilot/src/client/app/role-workspace.ts`
- Create: `careflow-pilot/src/client/screens/RoleLandingScreen.tsx`
- Modify: `careflow-pilot/src/client/app/router.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/AppShell.tsx`
- Modify: `careflow-pilot/tests/client/router.test.tsx`
- Modify: `careflow-pilot/tests/client/auth.test.tsx`
- Modify: `careflow-pilot/tests/client/queue.test.tsx`

**Interfaces:**
- Consumes: `SessionDto["user"]["role"]`, current React Router location, and existing Lucide icon registry.
- Produces: `roleWorkspaceFor(role): RoleWorkspace`, where `RoleWorkspace` contains `homePath`, Thai/English workspace labels, and ordered operational navigation items.

- [ ] **Step 1: Write failing role landing and navigation tests**

Add behavior tests using complete real session payloads and path-specific fetch responses:

```tsx
it.each([
  ["assistant", "/intake"],
  ["doctor", "/queue"],
] as const)("lands %s on %s", async (role, expectedPath) => {
  const { router } = renderRoleApp("/", role);
  await waitFor(() => expect(router.state.location.pathname).toBe(expectedPath));
});

it("shows Assistant operational navigation in job order", async () => {
  renderRoleApp("/queue", "assistant");
  const navigation = await screen.findByRole("navigation", { name: "เมนูหลัก" });
  expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href")))
    .toEqual(["/intake", "/queue", "/overview"]);
});

it("shows only Doctor primary jobs in Doctor navigation", async () => {
  renderRoleApp("/queue", "doctor");
  const navigation = await screen.findByRole("navigation", { name: "เมนูหลัก" });
  expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href")))
    .toEqual(["/queue", "/overview"]);
});

it("denies Assistant Consultation before requesting clinical data", async () => {
  let workspaceRequests = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/auth/session") return new Response(JSON.stringify(assistantSession), { status: 200 });
    if (path === "/api/visits/visit-1/workspace") {
      workspaceRequests += 1;
      return new Response(JSON.stringify({ error: { code: "FORBIDDEN", messageTh: "ไม่มีสิทธิ์", requestId: "r" } }), { status: 403 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  renderApp("/consultations/visit-1", fetchImpl);
  expect(await screen.findByRole("heading", { name: /ไม่มีสิทธิ์/ })).toBeInTheDocument();
  expect(workspaceRequests).toBe(0);
});
```

- [ ] **Step 2: Run RED for role routing**

Run:

```bash
npm run test:client -- tests/client/router.test.tsx
```

Expected: FAIL because `/` still renders Overview and both roles still use one navigation list.

- [ ] **Step 3: Implement the pure role workspace mapping**

Create the exact public contract:

```ts
import type { SessionDto } from "../../shared/contracts";

export type WorkspaceNavIcon = "dashboard" | "queue" | "intake";
export interface WorkspaceNavItem {
  href: "/intake" | "/queue" | "/overview";
  label: string;
  labelEn: string;
  icon: WorkspaceNavIcon;
}
export interface RoleWorkspace {
  homePath: "/intake" | "/queue";
  label: string;
  labelEn: "ASSISTANT WORKSPACE" | "DOCTOR WORKSPACE";
  navItems: readonly WorkspaceNavItem[];
}
export function roleWorkspaceFor(role: SessionDto["user"]["role"]): RoleWorkspace;
```

Use literal mappings: Assistant home `/intake` and nav `/intake`, `/queue`, `/overview`; Doctor home `/queue` and nav `/queue`, `/overview`.

- [ ] **Step 4: Implement index redirect and route gates**

`RoleLandingScreen` reads `useAuth()` and returns `<Navigate replace to={roleWorkspaceFor(session.user.role).homePath} />`. In `router.tsx`:

```tsx
{ index: true, element: <RoleLandingScreen /> },
{ path: "overview", element: <AuthGate requiredPermission="visit:read-queue"><OverviewScreen /></AuthGate> },
{ path: "consultations/:visitId", element: <AuthGate requiredPermission="visit:start-consultation"><ConsultationScreen /></AuthGate> },
```

Update Overview tests to visit `/overview`, then make `AppShell` render `roleWorkspaceFor(session.user.role).navItems` instead of permission-filtering one shared list.

- [ ] **Step 5: Run GREEN and client routing regressions**

Run:

```bash
npm run test:client -- tests/client/router.test.tsx tests/client/auth.test.tsx tests/client/queue.test.tsx
```

Expected: all selected files PASS; anonymous `returnTo` and Pilot prerequisites remain unchanged.

- [ ] **Step 6: Commit role routing**

```bash
git add careflow-pilot/src/client/app/role-workspace.ts careflow-pilot/src/client/screens/RoleLandingScreen.tsx careflow-pilot/src/client/app/router.tsx careflow-pilot/src/client/components/careflow/AppShell.tsx careflow-pilot/tests/client/router.test.tsx careflow-pilot/tests/client/auth.test.tsx careflow-pilot/tests/client/queue.test.tsx
git commit -m "feat(pilot): add role-focused landing and navigation"
```

---

### Task 3: Make Queue and Overview Actions Role-Specific

**Files:**
- Modify: `careflow-pilot/tests/client/queue.test.tsx`
- Modify: `careflow-pilot/src/client/screens/QueueScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/OverviewScreen.tsx`

**Interfaces:**
- Consumes: authenticated role and existing Queue `allowedActions`.
- Produces: operational Queue copy/actions for Assistant, clinical Queue copy/actions for Doctor, and role-specific Overview primary action.

- [ ] **Step 1: Write failing clinical-link privacy and role-copy tests**

```tsx
it("never exposes a consulting-room link to Assistant", async () => {
  server.use(
    http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
    http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })),
  );
  renderRoute("/queue");
  const row = await screen.findByRole("article", { name: /DEMO-000042/ });
  expect(within(row).queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
  expect(screen.getByText("ติดตามการส่งต่อผู้ป่วยให้แพทย์")).toBeInTheDocument();
});

it("offers the clinical room only to Doctor", async () => {
  server.use(http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })));
  renderRoute("/queue");
  expect(within(await screen.findByRole("article", { name: /DEMO-000042/ }))
    .getByRole("link", { name: "เปิดห้องตรวจ" })).toBeInTheDocument();
  expect(screen.getByText("เลือกผู้ป่วยเพื่อเริ่มหรือกลับเข้าห้องตรวจ")).toBeInTheDocument();
});
```

Add `/overview` tests asserting the Assistant primary action links to `/intake`, while Doctor's links to `/queue`.

- [ ] **Step 2: Run RED for the visible role boundary**

Run:

```bash
npm run test:client -- tests/client/queue.test.tsx
```

Expected: FAIL because the consulting link and page copy are currently shared.

- [ ] **Step 3: Implement role-aware Queue rendering**

Pass `canOpenClinical={canStart}` into each `QueueCard` and render the consulting link only when true:

```tsx
{item.visit.status === "CONSULTING" && canOpenClinical
  ? <Link className="queue-link" to={`/consultations/${item.visit.id}`}>เปิดห้องตรวจ</Link>
  : null}
```

Derive Queue eyebrow, description, and contextual action from `auth.session.user.role`. Keep Start Consultation gated by both `visit:start-consultation` and server `START_CONSULTATION` exactly as before.

- [ ] **Step 4: Implement role-aware Overview action**

Use `useAuth()` and render one literal target:

```tsx
const isDoctor = auth.session?.user.role === "doctor";
const primaryAction = isDoctor
  ? { to: "/queue", label: "ไปยังคิวตรวจ" }
  : { to: "/intake", label: "รับผู้ป่วย" };
```

Do not change shared metrics or Queue polling.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run test:client -- tests/client/queue.test.tsx
git add careflow-pilot/tests/client/queue.test.tsx careflow-pilot/src/client/screens/QueueScreen.tsx careflow-pilot/src/client/screens/OverviewScreen.tsx
git commit -m "feat(pilot): focus queue actions by role"
```

Expected: the client workflow file PASS with no loss of stale/conflict/retry coverage.

---

### Task 4: Apply Stitch Focused and Clinical Workspace Modes

**Files:**
- Modify: `careflow-pilot/tests/client/router.test.tsx`
- Modify: `careflow-pilot/tests/client/queue.test.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/AppShell.tsx`
- Modify: `careflow-pilot/src/client/screens/IntakeScreen.tsx`
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Modify: `careflow-pilot/src/client/styles/globals.css`
- Modify: `careflow-pilot/src/client/styles/pilot.css`

**Interfaces:**
- Consumes: current pathname, authenticated role, existing Patient/Intake workspace DTO, and existing Rural Health Commons tokens.
- Produces: `operational`, `focused`, and `clinical` render modes without changing backend data or API calls.

- [ ] **Step 1: Write failing focused/clinical composition tests**

```tsx
it("gives Intake one focused job without global navigation", async () => {
  renderRoleApp("/intake", "assistant");
  expect(await screen.findByRole("heading", { name: "ลงทะเบียนผู้ป่วยและซักประวัติ" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "เมนูหลัก" })).not.toBeInTheDocument();
  expect(screen.getByText("ASSISTANT WORKSPACE")).toBeInTheDocument();
});

it("renders a Doctor clinical workspace without writable clinical controls", async () => {
  renderRoute("/consultations/visit-42");
  expect(await screen.findByRole("complementary", { name: "บริบทผู้ป่วย" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "ข้อมูล Visit ปัจจุบัน" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Clinical Note" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /ลงนาม|เพิ่มยา|บันทึกร่าง/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED for Stitch composition**

Run:

```bash
npm run test:client -- tests/client/router.test.tsx tests/client/queue.test.tsx
```

Expected: FAIL because Intake still inherits global navigation and Consultation lacks the patient rail/clinical regions.

- [ ] **Step 3: Implement route-aware shell modes**

In `AppShell`, derive:

```ts
const mode = pathname === "/intake"
  ? "focused"
  : pathname.startsWith("/consultations/")
    ? "clinical"
    : "operational";
```

Focused mode renders a compact CareFlow/workspace header, Pilot banner, and one narrow main canvas without `sidebar-nav`. Clinical mode removes operational navigation and allows the Consultation screen to own its patient rail and full-width canvas. Operational mode keeps the existing sidebar, drawer, account card, top bar, skip link, and banner.

- [ ] **Step 4: Adapt Intake composition without changing its behavior**

Change the visible header to:

```tsx
<PageHeader
  eyebrow="ASSISTANT WORKSPACE · PATIENT INTAKE"
  title="ลงทะเบียนผู้ป่วยและซักประวัติ"
  description="ค้นหาหรือสร้างผู้ป่วย บันทึกสัญญาณชีพ แล้วส่งพบแพทย์"
/>
```

Keep search/generation, retry attempts, validation, all vital fields including heart rate/SpO₂, and the single `ส่งพบแพทย์` submit action unchanged.

- [ ] **Step 5: Adapt Consultation to the Doctor reference without fake writes**

Render three semantic areas using committed DTO values:

```tsx
<aside className="consultation-patient-rail" aria-label="บริบทผู้ป่วย">
  <PatientHeader patient={data.patient} status={status.label} statusTone={status.tone} />
  <Link className="care-button care-button-secondary" to="/queue">กลับคิวผู้ป่วย</Link>
</aside>
<section className="consultation-current-visit" aria-label="ข้อมูล Visit ปัจจุบัน">
  <SectionHeading icon={Stethoscope} title="ข้อมูล Visit ปัจจุบัน" description={data.intake.chiefComplaint} />
  <div className="vitals-summary">
    <span>อุณหภูมิ <strong>{vital(data.intake.vitals.temperatureC, " °C")}</strong></span>
    <span>ชีพจร <strong>{vital(data.intake.vitals.heartRateBpm, " ครั้ง/นาที")}</strong></span>
  </div>
</section>
<section className="consultation-note-panel" aria-label="Clinical Note">
  <SectionHeading icon={FileSignature} title="Clinical Note" description="พื้นที่งานแพทย์" />
  <div className="milestone-next-copy">การบันทึกและลงนามจะเปิดใน Milestone ถัดไป</div>
</section>
```

The patient rail contains name, HN, demographic context, status, and a Queue return link. The current Visit region contains complaint, four-to-six vital tiles, recorder/time evidence, Visit ID, and revision. The note region contains non-interactive Subjective/Objective/Assessment/Plan placeholders and the existing milestone message; it has no form controls or clinical mutation.

- [ ] **Step 6: Add only scoped CSS using existing tokens**

Add `.app-shell-focused`, `.focused-workspace-header`, `.focused-workspace-main`, `.app-shell-clinical`, `.clinical-workspace-grid`, `.consultation-patient-rail`, `.consultation-current-visit`, and `.consultation-note-panel`. Desktop clinical layout uses a 240–256px rail and fluid content; below 768px it becomes one column. Intake canvas is at most 768px, 16px mobile margins, and uses existing cards/inputs/buttons.

- [ ] **Step 7: Run GREEN, typecheck, and commit**

```bash
npm run test:client -- tests/client/router.test.tsx tests/client/intake.test.tsx tests/client/queue.test.tsx
npm run typecheck:client
git add careflow-pilot/tests/client/router.test.tsx careflow-pilot/tests/client/queue.test.tsx careflow-pilot/src/client/components/careflow/AppShell.tsx careflow-pilot/src/client/screens/IntakeScreen.tsx careflow-pilot/src/client/screens/ConsultationScreen.tsx careflow-pilot/src/client/styles/globals.css careflow-pilot/src/client/styles/pilot.css
git commit -m "feat(pilot): align role workspaces with Stitch"
```

Expected: selected tests and client typecheck PASS.

---

### Task 5: Prove the Two-Role Journey and Responsive UI

**Files:**
- Modify: `careflow-pilot/tests/e2e/pilot-shared-visit.spec.ts`
- Modify: `careflow-pilot/tests/e2e/responsive.spec.ts`

**Interfaces:**
- Consumes: the built SPA, real Fastify app, real temporary SQLite file, and independent Assistant/Doctor browser contexts.
- Produces: retained evidence that role separation works across real browser sessions and all supported viewports.

- [ ] **Step 1: Add end-to-end role assertions before changing production code further**

In the shared Visit journey, assert Assistant lands on `/intake`, Doctor lands on `/queue`, Assistant cannot see “เปิดห้องตรวจ” after the Visit becomes `CONSULTING`, and direct Assistant Consultation navigation shows permission denied. In responsive coverage, replace the Assistant unknown Consultation smoke with an explicit denied-state assertion and add Doctor Consultation to the route loop.

- [ ] **Step 2: Run the end-to-end tests**

```bash
npm run build
npx playwright test tests/e2e/pilot-shared-visit.spec.ts tests/e2e/responsive.spec.ts
```

Expected: both files PASS at phone, tablet, and desktop widths without horizontal overflow.

- [ ] **Step 3: Run the complete verification gate**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
git diff --check
```

Expected: zero lint/type/test/build/Playwright failures and no whitespace errors.

- [ ] **Step 4: Inspect both roles in a real browser**

Start the existing development server and inspect Assistant Intake, Assistant Queue, Doctor Queue, and Doctor Consultation at desktop and phone widths. Confirm visual identity, active navigation, permanent Pilot banner, focused Intake, clinical patient rail, and no Assistant clinical content. Fix only observed regressions and rerun the smallest failing test before the full gate.

- [ ] **Step 5: Commit acceptance evidence**

```bash
git add careflow-pilot/tests/e2e/pilot-shared-visit.spec.ts careflow-pilot/tests/e2e/responsive.spec.ts
git commit -m "test(pilot): prove role-focused journeys"
```

If browser inspection required production corrections, stage those exact corrected files in the same evidence commit after their red-green regression test passes.
