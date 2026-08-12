# CareFlow Pre-pilot UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a fresh synthetic-only local UAT environment and a non-technical Thai guide that lets the project owner validate CareFlow end-to-end before a Pilot rehearsal.

**Architecture:** Keep product code and the old database untouched. Add a tracked documentation kit for the tester and administrator, create an untracked SQLite database at `careflow-pilot/data/uat/careflow-uat.sqlite`, run the existing production host on loopback, and record user-driven results without automating the user’s decisions.

**Tech Stack:** Markdown, Node.js 22, Fastify production build, SQLite WAL, existing Drizzle migrations and user CLI, two isolated browser sessions, Vitest, and Playwright.

## Global Constraints

- Use synthetic data only; never enter or capture a real person’s identity, symptoms, diagnosis, medication directions, payment reference, or clinical narrative.
- Run only on `127.0.0.1:3001`; do not expose the host to LAN or internet.
- Keep the old database, `.DS_Store`, `stitch_careflow_clinic_management_system/`, and all product code untouched.
- Use `careflow-pilot/data/uat/careflow-uat.sqlite` and named `uat-assistant` / `uat-doctor` accounts.
- Passwords are entered interactively and never written to Git, Markdown, screenshots, chat, or logs.
- The tester guide contains no terminal commands; technical setup lives only in the administrator runbook.
- Stop immediately on HTTP 500, cross-role clinical disclosure, lost state after restart, negative stock, incorrect Baht totals, or invalid Visit closure.
- Do not deploy, enable real data, or implement product fixes during UAT. Defects enter a separate approved TDD/review cycle.
- Do not push any UAT commit unless the user explicitly requests it.

---

### Task 1: Thai Tester Guide and Result Checklist

**Files:**
- Create: `docs/uat/careflow-pre-pilot/guide-th.md`
- Create: `docs/uat/careflow-pre-pilot/checklist.md`
- Reference: `careflow-pilot/src/client/app/router.tsx`
- Reference: `careflow-pilot/src/client/app/role-workspace.ts`
- Reference: `careflow-pilot/tests/e2e/fulfillment-completion.spec.ts`
- Reference: `careflow-pilot/tests/e2e/finance-visit-completion.spec.ts`

**Interfaces:**
- Consumes: exact Thai UI labels and the three approved scenarios.
- Produces: a command-free guide and a result file updated during live UAT.

- [ ] **Step 1: Record the documentation RED state**

Run `test -f docs/uat/careflow-pre-pilot/guide-th.md` and `test -f docs/uat/careflow-pre-pilot/checklist.md` separately.

Expected: both fail because the approved UAT kit does not exist.

- [ ] **Step 2: Write the user-facing Thai guide**

Create `guide-th.md` with these exact sections:

```markdown
# คู่มือทดลอง CareFlow ก่อน Pilot
## กติกาก่อนเริ่ม
## การเปิดสองหน้าต่างและตรวจบทบาท
## Scenario A — สั่งยา 8 เม็ด, FEFO สองล็อต, เงินสด 140 บาท
## จุดพักเพื่อ restart ระบบ
## Scenario B — ปฏิเสธการจัดยา, พิมพ์ใหม่, PromptPay 105 บาท
## Scenario C — ไม่สั่งยา, ยกเว้นเต็มจำนวน 100 บาท
## ตรวจสิทธิ์ Assistant และ Doctor
## เมื่อใดต้องหยุดทันที
## วิธีบันทึก PASS / FAIL / BLOCKED
```

Use these fixed synthetic values:

| Field | Scenario A | Scenario B | Scenario C |
|---|---|---|---|
| Chief complaint | `อาการสังเคราะห์ UAT เงินสด` | `อาการสังเคราะห์ UAT ปฏิเสธและพร้อมเพย์` | `อาการสังเคราะห์ UAT ไม่สั่งยา` |
| Allergy | `NONE_KNOWN` | `NONE_KNOWN` | `UNKNOWN` |
| SOAP | `ข้อมูลสังเคราะห์ UAT` plus each field name | same | same |
| Diagnosis | `การวินิจฉัยสังเคราะห์ UAT` | same | same |
| Decision | `ORDER` | `ORDER` | `NO_MEDICATION` |
| Medication | `[DEMO] ยาทดสอบชนิด A` | same | none |
| Quantity | `8` | `1` | none |
| Directions/reason | `รับประทานตามคำแนะนำสังเคราะห์ UAT` | same | `ไม่มีข้อบ่งใช้ยาในการทดสอบสังเคราะห์` |
| Resolution | Cash `140` Baht | PromptPay `UAT-PROMPT-105` | waiver reason `ยกเว้นเพื่อทดสอบระบบสังเคราะห์` |

Scenario A uses two `DEMO-MED-001` lots: `UAT-A-EARLY`, quantity `5`, expiry `2031-12-31`; and `UAT-A-LATE`, quantity `10`, expiry `2032-12-31`. Supplier is `ผู้จำหน่ายสังเคราะห์ UAT`. Expected FEFO is `5 + 3`; after handoff, on-hand is `0 + 7`.

Every numbered action must name the visible Thai menu/button, state the expected status immediately afterward, and reference one checklist ID. Do not expose route IDs, revisions, idempotency keys, hashes, or API terminology.

- [ ] **Step 3: Write the checklist and issue log**

Create `checklist.md` with prefixes `PRE`, `A`, `B`, `C`, `ROLE`, `RESTART`, and `FINAL`. Repeat this exact record shape for every action:

```markdown
### A-01 — Assistant สร้างผู้ป่วยสังเคราะห์
- Expected: เห็น Patient Header ที่มี `HN DEMO-` และไม่มีข้อมูลบุคคลจริง
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:
```

Add an issue table with columns `ID`, `Severity`, `Scenario`, `Observed`, `Expected`, `Evidence`, and `Decision`. Allowed severities are `Blocker`, `Important`, and `Minor`.

- [ ] **Step 4: Validate vocabulary and secret hygiene**

Run `rg` against `guide-th.md` for the exact labels `สร้างผู้ป่วยสังเคราะห์`, `ทบทวนประวัติแพ้ยา`, `ลงนามและส่งต่อ`, `เริ่มเตรียมยา`, `บันทึกคำขอพิมพ์`, `เสร็จสิ้นการเตรียมยา`, `ปฏิเสธการจัดยา`, `ยืนยันส่งมอบยา`, `ยืนยันรับเงินสด`, `ยืนยัน PromptPay`, `ยกเว้นเต็มจำนวน`, `ปิด Visit`, and `เปิดบัตร OPD`.

Run `rg -n "CAREFLOW_DB_PATH|npm run|git |sqlite|cookie|Idempotency-Key|password" docs/uat/careflow-pre-pilot/guide-th.md`.

Expected: required labels match; the technical-term scan returns no matches; `git diff --check` passes.

- [ ] **Step 5: Commit**

```bash
git add docs/uat/careflow-pre-pilot/guide-th.md docs/uat/careflow-pre-pilot/checklist.md
git commit -m "docs: add guided pre-pilot UAT"
```

---

### Task 2: Administrator Runbook and README Link

**Files:**
- Create: `docs/uat/careflow-pre-pilot/admin-runbook.md`
- Modify: `careflow-pilot/README.md`
- Reference: `careflow-pilot/scripts/migrate.ts`
- Reference: `careflow-pilot/scripts/users.ts`
- Reference: `careflow-pilot/src/server/config.ts`

**Interfaces:**
- Consumes: the fixed database path and account names.
- Produces: setup, restart, health, stop, and preservation instructions used by Task 3.

- [ ] **Step 1: Record the runbook RED state**

Run `test -f docs/uat/careflow-pre-pilot/admin-runbook.md` and search `careflow-pilot/README.md` for `careflow-pre-pilot/guide-th.md`.

Expected: both fail.

- [ ] **Step 2: Write the exact local setup commands**

Create `admin-runbook.md` containing:

```bash
cd careflow-pilot
npm ci
npm test
npm run lint
npm run typecheck
npm run build
install -d -m 700 data/uat
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run db:migrate -- "$PWD/data/uat/careflow-uat.sqlite"
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-assistant --display-name "ผู้ช่วย UAT" --role assistant
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" npm run users -- create --username uat-doctor --display-name "แพทย์ UAT" --role doctor
CAREFLOW_DB_PATH="$PWD/data/uat/careflow-uat.sqlite" CAREFLOW_HOST=127.0.0.1 CAREFLOW_PORT=3001 CAREFLOW_COOKIE_SECURE=false npm start
curl -fsS http://127.0.0.1:3001/api/health
```

Explain that each account command requires `SYNTHETIC-ONLY` and a 12–128 character password entered twice locally. Provide no password example. Define `Ctrl-C` as normal shutdown and require process verification before treating `.careflow-running` as stale.

- [ ] **Step 3: Add restart and preservation procedures**

Document this order: stop with `Ctrl-C`; confirm port `3001` is free; restart with the same UAT path; check `/api/health`; then ask the tester to reload. Never delete SQLite/WAL/SHM or the old database during lock recovery. Reset/deletion requires a separate explicit user instruction after results are recorded.

- [ ] **Step 4: Link the kit from the Pilot README**

Add `Pre-pilot UAT` immediately before `Milestone 4 and explicit limits` with links to `guide-th.md`, `checklist.md`, and `admin-runbook.md`.

- [ ] **Step 5: Validate and commit**

Run `rg` for `data/uat/careflow-uat.sqlite`, both usernames, `127.0.0.1:3001`, `api/health`, `Ctrl-C`, and `SYNTHETIC-ONLY` in the runbook. Verify all three README links and run `git diff --check`.

```bash
git add docs/uat/careflow-pre-pilot/admin-runbook.md careflow-pilot/README.md
git commit -m "docs: add local UAT operator runbook"
```

---

### Task 3: Fresh UAT Environment

**Files:**
- Runtime-only create: `careflow-pilot/data/uat/careflow-uat.sqlite`
- Runtime-only create: SQLite WAL/SHM and `.careflow-running` while running
- Runtime-only update: `.superpowers/sdd/2026-08-10-careflow-pre-pilot-uat/progress.md`
- Read: `docs/uat/careflow-pre-pilot/admin-runbook.md`

**Interfaces:**
- Consumes: Task 2 runbook and the existing CLI.
- Produces: one healthy host at `http://127.0.0.1:3001`, a fresh 23-migration database, and two named sessions.

- [ ] **Step 1: Verify the tree and baseline**

Run `git status --short --branch`, `git rev-parse HEAD`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.

Expected: only the pre-existing `.DS_Store` and Stitch reference are untracked; 474 tests and all static/build gates pass. Record HEAD and counts in the ignored progress ledger.

- [ ] **Step 2: Prove the target is unused**

Run separate `test ! -e` checks for the SQLite, WAL, SHM, and `.careflow-running` paths.

Expected: all pass. If any exists, stop and ask instead of overwriting or deleting it.

- [ ] **Step 3: Create and migrate the database**

Run the directory and migration commands. Query only the new UAT file and assert `23` migration rows, `PRAGMA foreign_keys = 1`, and an empty `PRAGMA foreign_key_check` result.

- [ ] **Step 4: Create accounts interactively**

Run both account commands in a TTY and pause for local password entry. Confirm only usernames, roles, and enabled state; never echo password input.

- [ ] **Step 5: Start and verify production mode**

Start with the explicit UAT path, wait for `/api/health` to return `200`, and confirm binding only to `127.0.0.1:3001`.

- [ ] **Step 6: Verify isolated sessions**

Open Browser A and a distinct private Browser B. Sign in as `uat-assistant` and `uat-doctor`, acknowledge rules, and verify role-specific navigation without creating a Patient. Record `PRE-01` through `PRE-04`.

No Git commit is created for runtime data. Verify no database, secret, or session artifact is tracked or staged.

---

### Task 4: Guided User UAT

**Files:**
- Modify: `docs/uat/careflow-pre-pilot/checklist.md`
- Read: `docs/uat/careflow-pre-pilot/guide-th.md`
- Read: `docs/uat/careflow-pre-pilot/admin-runbook.md`

**Interfaces:**
- Consumes: the healthy host, isolated accounts, clean database, and guide.
- Produces: user-observed scenario, role, restart, and UX evidence.

- [ ] **Step 1: Hand control to the tester**

The user performs visible UI actions. The agent handles only server restart and records the user’s observations. Do not click ahead or correct the user unless a stop condition fires.

- [ ] **Step 2: Run Scenario A**

Record every `A-*` and `RESTART-*` item. Expected invariants:

```text
Consultation 100 + medication 8 × 5 = Cash 140 Baht
UAT-A-EARLY: received 5, dispensed 5, on hand 0
UAT-A-LATE: received 10, dispensed 3, on hand 7
```

Restart after signed ORDER and after Payment, then verify the same Visit/evidence before continuing.

- [ ] **Step 3: Run Scenario B**

Confirm rejection releases the first reservation, the old label cannot complete later preparation, a new print request is required, PromptPay is `105` Baht, and Doctor close creates one Closure.

- [ ] **Step 4: Run Scenario C**

Confirm gross Charge `100`, waiver `-100`, net due `0`, no medication/dispense line, and Doctor-only OPD after close.

- [ ] **Step 5: Run role and duplicate-action checks**

Assistant must receive visible denial for Doctor Consultation/OPD/close/PromptPay/full-waiver without clinical content appearing. Repeated visible submissions must not duplicate evidence. Exact idempotency/stale-revision behavior remains covered by the fresh automated suite.

- [ ] **Step 6: Improve ambiguous guide steps**

Ask which steps required explanation and rewrite them using the exact visible Thai label. Add a synthetic screenshot only when text cannot remove ambiguity; crop browser chrome, local paths, account details, and identifiers before tracking it.

- [ ] **Step 7: Check evidence scope**

Run `git diff --check` and `git status --short`. Expected: only guide/checklist evidence is tracked; database, WAL/SHM, credentials, and old data are absent.

---

### Task 5: Findings Gate and Decision

**Files:**
- Modify: `docs/uat/careflow-pre-pilot/checklist.md`
- Runtime-only update: `.superpowers/sdd/2026-08-10-careflow-pre-pilot-uat/progress.md`

**Interfaces:**
- Consumes: completed checklist and issue register.
- Produces: an explicit `PASS`, `FAIL`, or `BLOCKED` verdict without deploying.

- [ ] **Step 1: Apply the exit criteria**

Fill exactly one value per row:

```markdown
## Final verdict
- Result: PASS | FAIL | BLOCKED
- Scenario A: PASS | FAIL | BLOCKED
- Scenario B: PASS | FAIL | BLOCKED
- Scenario C: PASS | FAIL | BLOCKED
- Role/privacy checks: PASS | FAIL | BLOCKED
- Restart persistence: PASS | FAIL | BLOCKED
- Open Blockers:
- Open Important findings:
- Recommendation: Pilot rehearsal | Fix and repeat affected scenarios
```

Do not claim PASS from incomplete checkboxes.

- [ ] **Step 2: Stop on defects**

For any Blocker or Important product defect, stop normally, preserve the UAT database, and report the exact checklist ID. Do not patch product code inside this plan; begin a separate approved brainstorming/TDD cycle.

- [ ] **Step 3: Commit documentation-only results**

When evidence is complete and no product fix is mixed into the diff:

```bash
git add docs/uat/careflow-pre-pilot/guide-th.md docs/uat/careflow-pre-pilot/checklist.md
git commit -m "docs: record pre-pilot UAT results"
```

Run `git diff --check` and `git status --short`. Do not add the database or push without explicit user instruction.

- [ ] **Step 4: Stop for user acceptance**

Report the scenario matrix, issue list, local commit, preserved database state, and recommendation. Do not start Pilot rehearsal, deployment, reset, or database deletion until the user chooses.
