# CareFlow Clinical Pilot Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five clinical-workspace gaps found in the 2026-08-08 review without replacing the approved Stitch-derived UI or expanding the Pilot scope.

**Architecture:** Keep the existing React Query, shared Zod contracts, Express workflow, and SQLite boundaries. Add explicit client-side reconciliation between server draft revisions and a locally dirty consultation form, make the Allergy dialog edit the complete aggregate, surface stale/conflict states consistently, and derive a sourced Snapshot value for signed `NO_MEDICATION` decisions.

**Tech Stack:** React 19, TypeScript, TanStack Query, Zod, Express, SQLite, Vitest, Testing Library, Playwright.

## Global Constraints

- Preserve the current Stitch-derived page composition and existing CSS design language; make only focused additions needed for safety and usability.
- Keep the project synthetic-only and loopback-only; do not add Inventory, Dispensing, Finance, real-patient data, cloud hosting, or new dependencies.
- Never persist draft clinical text in URL, local storage, or session storage.
- Keep signed evidence and Allergy history append-only; no database migration is required.
- All user-facing error and recovery copy remains Thai.

---

### Task 1: Preserve dirty consultation drafts during refresh and Allergy review

**Files:**
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Test: `careflow-pilot/tests/client/consultation.test.tsx`

**Interfaces:**
- Consumes: `VisitWorkspaceDto`, `useVisitWorkspace`, and the existing consultation mutation hooks.
- Produces: local dirty-state reconciliation that imports server drafts only when safe and retains local text on a divergent draft revision.

- [ ] **Step 1: Write failing reconciliation tests**

Add tests that type an unsaved Subjective value, then return a workspace response with only a newer Patient revision and assert the typed value remains. Add a second test with a newer draft revision containing different server text and assert the local value remains while the conflict alert appears.

```tsx
await user.type(await screen.findByLabelText("Subjective (ข้อมูลจากผู้ป่วย)"), "ข้อความที่ยังไม่บันทึก");
workspace.patient.revision += 1;
await queryClient.invalidateQueries({ queryKey: ["visit", visit.id] });
expect(screen.getByLabelText("Subjective (ข้อมูลจากผู้ป่วย)")).toHaveValue("ข้อความที่ยังไม่บันทึก");
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Expected: the local Subjective value is replaced by the refetched server draft.

- [ ] **Step 3: Implement minimal dirty-state reconciliation**

Track whether the form differs from the last accepted server draft. Compare only note/medication draft revisions for form replacement. If the server draft changes while local state is dirty, retain the local form, clear command attempts, and block signing with the existing conflict alert. If the refetched server form equals the local form after the current user's save, mark it clean without raising a conflict.

- [ ] **Step 4: Add a recovery test**

Click “โหลดข้อมูลล่าสุด”, return a successful current workspace response, and assert the local text is retained, the conflict clears, and a subsequent save uses current expected revisions.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Expected: all consultation tests pass.

### Task 2: Permit genuinely partial consultation drafts

**Files:**
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Modify: `careflow-pilot/src/client/components/careflow/MedicationDecisionEditor.tsx`
- Test: `careflow-pilot/tests/client/consultation.test.tsx`

**Interfaces:**
- Consumes: the existing `SaveConsultationDraftBody` contract, including `{kind:"UNDECIDED"}`.
- Produces: Save Draft accepts every payload accepted by the draft schema; finalization still requires a complete note and explicit medication decision.

- [ ] **Step 1: Replace the test that enshrines the disabled Save Draft behavior**

```tsx
expect(screen.getByRole("button", { name: "บันทึกร่าง" })).toBeEnabled();
await user.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
expect(await capturedRequest()).toMatchObject({
  payload: { medicationDecision: { kind: "UNDECIDED" } },
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Expected: Save Draft remains disabled.

- [ ] **Step 3: Separate draft validity from finalization validity**

Allow `saveDraft` whenever the workspace is editable and current values satisfy the shared draft schema. Keep `decisionValid` and required signed-note checks only on the sign/finalize path. Change the hint to explain that an explicit decision is required before signing, not before saving.

- [ ] **Step 4: Run focused client and server draft tests**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Run: `npm run test:server -- tests/server/clinical.test.ts`

Expected: both pass and finalization still rejects incomplete evidence.

### Task 3: Edit and preserve the complete Allergy aggregate

**Files:**
- Modify: `careflow-pilot/src/client/components/careflow/AllergyReviewDialog.tsx`
- Modify: `careflow-pilot/src/client/styles/pilot.css`
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Test: `careflow-pilot/tests/client/queue.test.tsx`
- Test: `careflow-pilot/tests/client/consultation.test.tsx`

**Interfaces:**
- Consumes: `ReviewAllergyPayload`, whose `PRESENT` state accepts 1–20 complete items.
- Produces: an editor for substance, reaction, severity, and nullable note for every current item, with add/remove controls and visible mutation errors.

- [ ] **Step 1: Write failing aggregate-preservation tests**

Render a current assessment with two items, edit the second item's severity and note, submit, and assert both items are present in order. Also assert switching to `NONE_KNOWN` submits an empty item array.

```tsx
expect(screen.getAllByLabelText("สารที่แพ้")).toHaveLength(2);
await user.selectOptions(screen.getAllByLabelText("ความรุนแรง")[1], "SEVERE");
expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
  items: [expect.objectContaining({ substance: "ยา A" }), expect.objectContaining({ severity: "SEVERE" })],
}));
```

- [ ] **Step 2: Run focused Allergy tests and confirm RED**

Run: `npm run test:client -- tests/client/queue.test.tsx tests/client/consultation.test.tsx`

Expected: only the first item is rendered and submitted.

- [ ] **Step 3: Implement the complete item editor**

Use an array initialized from all existing Allergy items. Render stable indexed rows with existing `SelectField`, `TextAreaField`, add, and remove buttons. Preserve current severity and note. Disable submit for `PRESENT` until every item has substance and reaction, and enforce the existing 20-item limit.

- [ ] **Step 4: Surface Doctor workspace Allergy errors and conflicts**

Pass mutation errors into `AllergyReviewDialog`. On `REVISION_CONFLICT` or `INVALID_STATE`, clear the attempt and show a reload action; keep the dialog values so the clinician can recover without retyping.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm run test:client -- tests/client/queue.test.tsx tests/client/consultation.test.tsx`

Expected: all focused tests pass.

### Task 4: Warn and block mutations when the workspace is stale

**Files:**
- Modify: `careflow-pilot/src/client/screens/ConsultationScreen.tsx`
- Test: `careflow-pilot/tests/client/consultation.test.tsx`

**Interfaces:**
- Consumes: TanStack Query's cached `data`, `error`, `isFetching`, and `refetch` state.
- Produces: a visible stale-data warning with retry, while retaining locally typed fields and preventing commands based on stale revisions.

- [ ] **Step 1: Write a failing stale-workspace test**

Return valid workspace data, then make a refetch fail. Assert the cached patient context stays visible, a Thai stale warning appears, Save/Sign/Allergy mutations are disabled, and typed text remains.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Expected: cached data stays visible without any warning and actions remain enabled.

- [ ] **Step 3: Add stale-state recovery UI**

Render a compact alert above the clinical content when `workspace.error && workspace.data`. Reuse the workspace reload function, show fetching state, and allow form editing while blocking server mutations until a successful reload clears the query error.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm run test:client -- tests/client/consultation.test.tsx`

Expected: stale warning, retained text, blocked commands, and recovery behavior all pass.

### Task 5: Represent signed NO_MEDICATION as sourced Snapshot evidence

**Files:**
- Modify: `careflow-pilot/src/server/workflows/clinical.ts`
- Test: `careflow-pilot/tests/server/visit.test.ts`
- Test: `careflow-pilot/tests/server/restart.test.ts`

**Interfaces:**
- Consumes: the latest signed `MedicationDecision`, including `kind` and `noMedicationReason`.
- Produces: `currentMedicationContext.state === "VALUE"` for both signed decision kinds, with `MEDICATION_DECISION` source provenance.

- [ ] **Step 1: Write the failing Snapshot test**

Finalize a visit with `NO_MEDICATION`, open a later visit for the same Patient, and assert:

```ts
expect(workspace.patientSnapshot.currentMedicationContext).toEqual({
  state: "VALUE",
  value: ["ไม่สั่งยา: เฝ้าดูอาการและพักผ่อน"],
  source: {
    type: "MEDICATION_DECISION",
    id: decision.id,
    occurredAt: decision.signedAt,
  },
});
```

- [ ] **Step 2: Run the server test and confirm RED**

Run: `npm run test:server -- tests/server/visit.test.ts`

Expected: Snapshot returns `UNKNOWN`.

- [ ] **Step 3: Derive a VALUE for both signed decision kinds**

Keep ORDER mapping unchanged. Map NO_MEDICATION to one Thai summary string containing the signed reason and attach the signed decision source.

- [ ] **Step 4: Run server tests and confirm GREEN**

Run: `npm run test:server -- tests/server/visit.test.ts tests/server/restart.test.ts`

Expected: both pass.

### Task 6: Full regression and visual safety check

**Files:**
- Verify only; no new production file is required.

**Interfaces:**
- Consumes: all changes from Tasks 1–5.
- Produces: evidence that the corrective slice is regression-safe and keeps the approved visual language.

- [ ] **Step 1: Run static and automated verification**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm test`

Run: `npm run build`

Run: `npx playwright test`

Expected: all commands pass; an existing bundle-size warning may remain but no new warning is introduced.

- [ ] **Step 2: Inspect the focused diff**

Run: `git diff --check`

Run: `git diff -- careflow-pilot docs/superpowers/plans/2026-08-08-careflow-clinical-pilot-review-fixes.md`

Expected: no whitespace errors, no changes under `careflow-webapp/` or `stitch_careflow_clinic_management_system/`, and no unrelated refactor.

- [ ] **Step 3: Review the running UI at desktop and narrow widths**

Verify that the multi-item Allergy dialog scrolls, labels remain readable, sticky actions do not obscure errors, and the consultation layout remains aligned with the existing Stitch-derived styling.

- [ ] **Step 4: Commit the verified corrective slice**

```bash
git add docs/superpowers/plans/2026-08-08-careflow-clinical-pilot-review-fixes.md careflow-pilot/src careflow-pilot/tests
git commit -m "fix: harden clinical pilot workspace"
```
