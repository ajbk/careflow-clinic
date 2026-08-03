# CareFlow Role-Focused Workspaces — Design Specification

**Status:** Approved in conversation on 3 August 2026 when the user confirmed that the Local Pilot must follow the supplied Stitch reference and said “เริ่มเลยครับ”.

**Scope:** Correct the current Foundation UI so Assistant and Doctor have visibly different starting points, navigation, copy, actions, and clinical access while preserving the existing React components, CSS design tokens, API shapes, SQLite data, and workflow state. Tighten the existing Consultation workspace endpoint so the same role boundary is enforced by the server.

## 1. Problem

The current Pilot uses one `AppShell` navigation list for both roles. Doctor permissions are a superset of Assistant permissions, so both roles see Overview, Queue, and Intake in the same order. The only visible role difference on a waiting Queue row is the Doctor-only “เริ่มการตรวจ” button.

That behavior protects the command at the API, but it does not satisfy the supplied Stitch product direction:

- “One screen, one job” must reduce the choices shown for the staff member's current responsibility.
- Assistant work centers on Patient Intake and operational handoff.
- Doctor work centers on the clinical Queue and Consultation Room.
- Clinical content and clinical actions must never appear in the Assistant workspace.

## 2. Source of Truth

In priority order for this change:

1. `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md` controls visual language, spacing, typography, touch targets, and “One screen, one job”.
2. `stitch_careflow_clinic_management_system/patient_intake_assistant/code.html` controls the Assistant Intake composition.
3. `stitch_careflow_clinic_management_system/clinic_queue/code.html` and `consultation_room_doctor/code.html` control the Doctor Queue and Consultation composition.
4. `docs/superpowers/specs/2026-08-03-careflow-pilot-design.md` controls Pilot safety, server-backed state, role permissions, and synthetic-only data.
5. Existing `careflow-pilot` UI and CSS are implementation assets to preserve, not a reason to flatten the role experience.

## 3. Options Considered

### Option A — Continue one permission-filtered navigation

This is the smallest code change but preserves the current problem: because Doctor owns most Assistant permissions, the workspaces remain visually alike. Rejected.

### Option B — Build two independent applications and shells

This creates maximal separation but duplicates branding, responsive behavior, session handling, and accessibility code. It would also make it harder for a Doctor to perform an Assistant operation when working alone. Rejected.

### Option C — Shared design system with role-focused entry and workspace modes

Use one authenticated application frame and one server session, but derive landing route, navigation, screen copy, and actions from the authenticated role. Keep shared data components and URLs where the job is genuinely shared. This is selected because it matches Stitch without discarding the working CSS/API foundation.

## 4. Role Experience Contract

### Assistant

- Visiting `/` redirects to `/intake` after authentication and Pilot prerequisites.
- The workspace identity reads “ASSISTANT WORKSPACE / งานผู้ช่วย”.
- Outside the focused Intake task, primary navigation order is Intake, Queue, then Overview.
- Intake follows the Stitch transactional composition: it suppresses global navigation, uses a narrow centered form canvas, and presents “ส่งพบแพทย์” as its single terminal action. It retains the existing server-backed Patient search/generation and Intake form.
- Queue copy describes operational handoff to the Doctor and never offers “เริ่มการตรวจ” or “เปิดห้องตรวจ”.
- A direct Consultation URL is denied before the clinical workspace fetch or UI renders.

### Doctor

- Visiting `/` redirects to `/queue` after authentication and Pilot prerequisites.
- The workspace identity reads “DOCTOR WORKSPACE / งานแพทย์”.
- Primary navigation contains Queue and Overview. Intake remains directly accessible because the Pilot PRD permits a Doctor to perform Assistant operations when working alone, but it is not presented as a primary Doctor navigation job.
- Queue copy describes the Doctor's examination list. Waiting rows expose “เริ่มการตรวจ” only when both the session permission and server `allowedActions` permit it.
- Consulting rows expose “เปิดห้องตรวจ” only to Doctor.
- Consultation switches from the operational shell to the supplied Doctor clinical composition: patient context/sidebar, committed Intake/vitals, visit evidence, clinical-note area, and a clinical action rail. Clinical authoring remains visibly unavailable/read-only until the Clinical Record API milestone; the UI must not pretend a draft or signature was persisted.

### Shared Overview

- Move the dashboard screen to `/overview`.
- Both roles may access the same server-backed operational counts.
- Page actions are role-aware: Assistant receives the Intake shortcut; Doctor receives the Queue shortcut.
- The dashboard is secondary for both roles, not the common default landing page.

## 5. Routing and Authorization

- Add a role landing component at the index route. It reads the authenticated server session and performs a replace navigation to the role home.
- Preserve safe explicit `returnTo` behavior. A login opened with `returnTo=/` reaches the role home through the index redirect; a safe explicit `/queue` or `/intake` target remains respected when authorized.
- Change `/consultations/:visitId` to require `visit:start-consultation` at the route gate. Server authorization remains authoritative.
- Change `GET /api/visits/:visitId/workspace` to require the same Doctor-only permission. Assistant access returns `403` before the Visit workspace service runs.
- Do not introduce a client-side role switch, localStorage role, duplicate session state, or role query parameter.
- Unknown or unauthorized clinical data must not be briefly rendered during redirect.

## 6. Component Boundaries

- `role-workspace.ts` is the single pure mapping from authenticated role to home path, workspace identity, and navigation items.
- `RoleLandingScreen.tsx` performs only the index redirect.
- `AppShell.tsx` renders the mapping and keeps the existing responsive sidebar/drawer, branding, account card, and Pilot banner for operational pages. It applies a focused mode for Intake and a clinical mode for Consultation so those Stitch task compositions do not inherit the generic operational navigation.
- `QueueScreen.tsx` derives role-focused header/actions and hides clinical links from Assistant while keeping the shared Queue data model.
- `OverviewScreen.tsx` derives only its role-aware primary action; metrics remain shared.
- `ConsultationScreen.tsx` keeps committed server data and adopts the Doctor-focused Stitch composition without enabling unsupported writes.
- Existing visual tokens and general component primitives remain unchanged. Add only focused-workspace and consultation composition rules to the existing stylesheets.

## 7. States and Error Handling

- Existing loading, stale Queue, conflict, unavailable, and denied behavior remains intact.
- Role navigation is derived only after the session is available, so loading never guesses a role.
- Doctor-only actions continue to require both client permission and server-provided `allowedActions`.
- Direct Assistant access to a clinical route renders the existing Thai permission-denied state and must not request `/api/visits/:id/workspace`.
- The permanent synthetic-only Pilot banner remains on every protected screen.

## 8. Responsive and Accessibility Requirements

- Preserve the current 1120px content maximum, 48px desktop margins, 16px mobile margins, 8px rhythm, Be Vietnam Pro typography, and existing color tokens.
- Preserve 48px minimum interactive targets, visible labels, keyboard focus, skip link, responsive drawer, and one-column mobile layouts.
- Active navigation must continue to use the current Deep Green state and `aria-label="เมนูหลัก"`.
- Role identity must be expressed in text, not color alone.

## 9. Test Contract

Behavior-first client tests must prove:

1. Assistant `/` redirects to `/intake`; Doctor `/` redirects to `/queue`.
2. Assistant navigation exposes Intake, Queue, Overview in that priority and no clinical link/action.
3. Doctor navigation exposes Queue and Overview as primary jobs and does not present Intake as primary navigation.
4. Assistant never sees “เริ่มการตรวจ” or “เปิดห้องตรวจ”, including a `CONSULTING` Queue row.
5. Doctor sees those actions only when server state permits them.
6. Assistant direct Consultation access is denied in the client without requesting the workspace endpoint, and a direct API call returns `403`.
7. Overview primary action is Intake for Assistant and Queue for Doctor.
8. Existing Intake submission, shared Queue, RBAC API, responsive, build, and two-browser workflow tests remain green.

Each changed behavior follows a red-green TDD cycle. The final gate is client tests, integration tests, typecheck, build, and a real browser viewport inspection of both role journeys.

## 10. Explicitly Out of Scope

- Writable SOAP, diagnosis, Medication Order, signatures, dispensing, inventory, finance, or OPD records.
- New backend tables, response shapes, or API endpoints. Tightening authorization on the existing workspace endpoint is in scope.
- Two independent front-end applications.
- Replacing the existing design system, global CSS, authentication, SQLite, or Fastify foundation.
- Claiming readiness for real patient data.
