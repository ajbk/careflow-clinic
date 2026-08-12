# CareFlow Native Windows CI and Local UAT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CareFlow Pilot install, verify, test, build, and run as a loopback-only synthetic UAT host on native Windows 11 without compiling bundled native dependencies.

**Architecture:** Keep normal lifecycle-script installs on Ubuntu/macOS, but make Windows use a prebuilt-only install followed immediately by an application-owned native runtime probe. Preserve the existing application, database, and migration boundaries; add only a small maintenance probe, a Windows CI contract, and platform-specific PowerShell operator instructions.

**Tech Stack:** Node.js 22 (`>=22.13.0`), npm lockfile installs, TypeScript, Vitest, better-sqlite3, Argon2, esbuild, GitHub Actions, Windows 11 PowerShell, SQLite WAL

## Global Constraints

- Windows support is native Windows 11 x64; do not use WSL or Docker.
- Bind the UAT host only to `127.0.0.1:3001`.
- Windows installs use `npm ci --ignore-scripts` followed by `npm run verify:native-runtime`.
- macOS/Linux and frozen-demo installs retain ordinary `npm ci` semantics.
- Do not install Visual Studio Build Tools, downgrade better-sqlite3, or consume an unreleased npm patch.
- Do not change clinical behavior, shared API contracts, SQLite schema, migration SQL, Drizzle metadata, or frozen Stitch/demo directories.
- Do not add Windows Service, installer, auto-start, LAN/WAN exposure, HTTPS, backup/restore, deployment, or real-data support.
- Keep passwords and password hashes out of command arguments, environment variables, documentation, logs, screenshots, and committed fixtures.
- The native probe must use only in-memory synthetic bytes and must not create a persistent database.
- A Windows CI result is required before claiming native Windows readiness; local macOS verification alone is insufficient.

---

### Task 1: Explicit Native Runtime Verification

**Files:**
- Create: `careflow-pilot/src/server/maintenance/native-runtime.ts`
- Create: `careflow-pilot/scripts/verify-native-runtime.ts`
- Create: `careflow-pilot/tests/server/native-runtime.test.ts`
- Modify: `careflow-pilot/package.json`
- Modify: `careflow-pilot/package-lock.json`

**Interfaces:**
- Consumes: `better-sqlite3@13.0.2`, `argon2@0.45.1`, and a new direct exact dev dependency `esbuild@0.28.1` already present transitively in the lockfile.
- Produces: `verifyNativeRuntime(): Promise<void>` and npm command `verify:native-runtime`.

- [ ] **Step 1: Write the missing native-probe RED test**

Create `careflow-pilot/tests/server/native-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyNativeRuntime } from "../../src/server/maintenance/native-runtime.js";

describe("native runtime verification", () => {
  it("executes SQLite, Argon2, and esbuild without persistent data", async () => {
    await expect(verifyNativeRuntime()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the focused test and capture the intended RED**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/native-runtime.test.ts
```

Expected: FAIL during collection because `src/server/maintenance/native-runtime.ts` does not exist.

- [ ] **Step 3: Add esbuild as a declared exact dev dependency and the npm command**

Run from `careflow-pilot`:

```bash
npm install --save-dev --save-exact esbuild@0.28.1
```

Add this exact script in `package.json`:

```json
"verify:native-runtime": "node --import tsx scripts/verify-native-runtime.ts"
```

Verify that `package-lock.json` changes only the root devDependency declaration/reference for the already locked `esbuild@0.28.1`; reject an unrelated dependency upgrade.

- [ ] **Step 4: Implement the actual in-memory native probe**

Create `careflow-pilot/src/server/maintenance/native-runtime.ts`:

```ts
import argon2 from "argon2";
import Database from "better-sqlite3";
import { transform } from "esbuild";

const probeBytes = Buffer.from("careflow-native-runtime-probe", "utf8");

export async function verifyNativeRuntime(): Promise<void> {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("CREATE TABLE native_probe (value TEXT NOT NULL)");
    const writeAndRead = sqlite.transaction((value: string): string | undefined => {
      sqlite.prepare("INSERT INTO native_probe (value) VALUES (?)").run(value);
      return sqlite.prepare("SELECT value FROM native_probe").pluck().get() as string | undefined;
    });
    if (writeAndRead("native-runtime") !== "native-runtime") {
      throw new Error("SQLite native runtime verification failed");
    }
  } finally {
    sqlite.close();
  }

  const passwordHash = await argon2.hash(probeBytes, {
    type: argon2.argon2id,
    memoryCost: 8_192,
    timeCost: 1,
    parallelism: 1,
  });
  if (!(await argon2.verify(passwordHash, probeBytes))) {
    throw new Error("Argon2 native runtime verification failed");
  }

  const transformed = await transform("const nativeProbe: number = 1;", {
    loader: "ts",
    target: "es2022",
  });
  if (!transformed.code.includes("const nativeProbe = 1")) {
    throw new Error("esbuild runtime verification failed");
  }
}
```

- [ ] **Step 5: Add the fail-closed CLI entrypoint**

Create `careflow-pilot/scripts/verify-native-runtime.ts`:

```ts
import { verifyNativeRuntime } from "../src/server/maintenance/native-runtime.js";

try {
  await verifyNativeRuntime();
  process.stdout.write("CareFlow native runtime verification complete\n");
} catch {
  process.stderr.write("CareFlow native runtime verification failed\n");
  process.exitCode = 1;
}
```

The CLI must not print dependency paths, hashes, probe bytes, stack traces, or environment values.

- [ ] **Step 6: Run the GREEN probe and focused tests**

Run:

```bash
cd careflow-pilot
npm run verify:native-runtime
npx vitest run --config vitest.server.config.ts tests/server/native-runtime.test.ts
npm run typecheck:server
npm run lint
```

Expected: fixed success line, 1 focused test PASS, typecheck PASS, lint PASS.

- [ ] **Step 7: Prove a lifecycle-script-free clean install still works**

From `careflow-pilot`, use a temporary copy outside the repository:

```bash
windows_probe_dir="$(mktemp -d)"
rsync -a --exclude node_modules --exclude dist --exclude data --exclude test-results --exclude playwright-report ./ "$windows_probe_dir/"
cd "$windows_probe_dir"
npm ci --ignore-scripts
npm run verify:native-runtime
npm run build
```

Expected: install PASS, native probe PASS, client/server production build PASS. Do not copy the temporary directory back into the repository.

- [ ] **Step 8: Commit the native runtime boundary**

```bash
git add careflow-pilot/package.json careflow-pilot/package-lock.json \
  careflow-pilot/src/server/maintenance/native-runtime.ts \
  careflow-pilot/scripts/verify-native-runtime.ts \
  careflow-pilot/tests/server/native-runtime.test.ts
git diff --cached --check
git commit -m "feat: verify prebuilt native runtime"
```

---

### Task 2: Native Windows CI Install Contract

**Files:**
- Create: `careflow-pilot/tests/server/windows-platform-contract.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: npm command `verify:native-runtime` from Task 1.
- Produces: `pilot-windows` CI order `npm ci --ignore-scripts` → native probe → lint/typecheck/server tests/build.

- [ ] **Step 1: Write the Windows workflow RED test**

Create `careflow-pilot/tests/server/windows-platform-contract.test.ts` with the first contract:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");

function windowsJob(): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const marker = "  pilot-windows:";
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error("pilot-windows job is missing");
  return workflow.slice(start);
}

describe("native Windows platform contract", () => {
  it("installs prebuilt packages before probing the native runtime", () => {
    const job = windowsJob();
    const installIndex = job.indexOf("- run: npm ci --ignore-scripts");
    const probeIndex = job.indexOf("- run: npm run verify:native-runtime");

    expect(job).toContain("runs-on: windows-latest");
    expect(installIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(installIndex);
    expect(job).not.toContain("npm ci\n");
    expect(job).not.toMatch(/Visual Studio|node-gyp|WSL|Docker/i);
  });
});
```

- [ ] **Step 2: Run the workflow test and capture the intended RED**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
```

Expected: FAIL because Windows still runs ordinary `npm ci` and has no native probe step.

- [ ] **Step 3: Change only the Windows install/probe sequence**

In `.github/workflows/ci.yml`, replace the Windows install step:

```yaml
      - run: npm ci --ignore-scripts
      - run: npm run verify:native-runtime
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:server
      - run: npm run build
```

Do not change the two Ubuntu `npm ci` steps, workflow triggers, cache paths, test commands, or browser artifact handling.

- [ ] **Step 4: Run the Windows contract and native probe GREEN**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts \
  tests/server/native-runtime.test.ts \
  tests/server/windows-platform-contract.test.ts
npm run verify:native-runtime
```

Expected: 2 focused tests PASS and native probe PASS.

- [ ] **Step 5: Commit the CI contract**

```bash
git add .github/workflows/ci.yml careflow-pilot/tests/server/windows-platform-contract.test.ts
git diff --cached --check
git commit -m "ci: verify prebuilt modules on Windows"
```

---

### Task 3: Executable Windows 11 PowerShell UAT Runbook

**Files:**
- Modify: `careflow-pilot/tests/server/windows-platform-contract.test.ts`
- Modify: `careflow-pilot/README.md`
- Modify: `docs/uat/careflow-pre-pilot/admin-runbook.md`
- Modify: `docs/uat/careflow-pre-pilot/guide-th.md`
- Modify: `docs/uat/careflow-pre-pilot/checklist.md`

**Interfaces:**
- Consumes: `verify:native-runtime`, existing `db:migrate`, `users`, `expire:uat-doctor-session`, and `npm start` commands.
- Produces: a copy/paste Windows PowerShell path for the same `careflow-uat.sqlite`, exactly two UAT accounts, loopback host, planned restart, and Scenario 5 expiry.

- [ ] **Step 1: Extend the platform contract with a missing-docs RED**

Append these constants and test to `windows-platform-contract.test.ts`:

```ts
const readRepositoryFile = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), "utf8");

it("documents one complete PowerShell UAT lifecycle without credentials", () => {
  const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
  const guide = readRepositoryFile("docs/uat/careflow-pre-pilot/guide-th.md");
  const checklist = readRepositoryFile("docs/uat/careflow-pre-pilot/checklist.md");
  const readme = readRepositoryFile("careflow-pilot/README.md");

  for (const required of [
    "## Windows 11 PowerShell",
    "npm ci --ignore-scripts",
    "npm run verify:native-runtime",
    "[System.IO.Path]::GetFullPath",
    "icacls.exe",
    "S-1-5-32-544",
    "$env:CAREFLOW_DB_PATH = $uatDb",
    "Invoke-RestMethod",
    "Get-NetTCPConnection",
    "Get-CimInstance Win32_Process",
    "npm run expire:uat-doctor-session -- --database \"$uatDb\"",
  ]) {
    expect(runbook).toContain(required);
  }

  expect(guide).toContain("Windows 11 PowerShell");
  expect(checklist).toContain("ระบบปฏิบัติการและ Node.js");
  expect(checklist).toContain("ผลตรวจสิทธิ์ directory/ACL");
  expect(readme).toContain("### Windows 11 PowerShell");

  const credentialAssignment = /(?:password|รหัสผ่าน)\s*[=:]\s*\S+/i;
  expect(runbook).not.toMatch(credentialAssignment);
  expect(guide).not.toMatch(credentialAssignment);
  expect(checklist).not.toMatch(credentialAssignment);
});
```

- [ ] **Step 2: Run the docs contract and capture the intended RED**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
```

Expected: workflow test PASS and PowerShell UAT lifecycle test FAIL because the required Windows sections do not exist.

- [ ] **Step 3: Split README quick start by platform**

Preserve the current POSIX block under `### macOS/Linux`, then add this Windows block under `## Quick start (Node 22)`:

````markdown
### Windows 11 PowerShell

Run PowerShell as the dedicated local UAT account from the repository root:

```powershell
Set-Location careflow-pilot
npm ci --ignore-scripts
npm run verify:native-runtime
$uatDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) 'data\uat'))
$uatDb = [System.IO.Path]::GetFullPath((Join-Path $uatDir 'careflow-uat.sqlite'))
New-Item -ItemType Directory -Path $uatDir -Force | Out-Null
$env:CAREFLOW_DB_PATH = $uatDb
npm run db:migrate -- "$uatDb"
npm run build
npm start
```

Browse only to `http://127.0.0.1:3001`. Apply and verify the restricted Windows ACL, provision the two interactive UAT accounts, and run restart/session-expiry checks with the [administrator runbook](../docs/uat/careflow-pre-pilot/admin-runbook.md#windows-11-powershell) before starting the Thai Journey checklist.
````

Keep deployment, service installation, backup, network exposure, and real data explicitly disabled.

- [ ] **Step 4: Add a complete Windows preparation and ACL section to the runbook**

Retain the current commands under a `## macOS/Linux (POSIX)` platform heading. Before the account-provisioning section, add:

````markdown
## Windows 11 PowerShell

Use a local NTFS checkout and sign in as the dedicated non-administrator UAT Windows account. Do not use OneDrive, a network drive, a shared profile, WSL, a symlink, or a junction. From the repository root:

```powershell
Set-Location careflow-pilot
npm ci --ignore-scripts
npm run verify:native-runtime
npm test
npm run lint
npm run typecheck
npm run build

$uatDir = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) 'data\uat'))
$uatDb = [System.IO.Path]::GetFullPath((Join-Path $uatDir 'careflow-uat.sqlite'))
if (Test-Path -LiteralPath $uatDb) { throw 'Use a new UAT database file' }
New-Item -ItemType Directory -Path $uatDir -Force | Out-Null
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $uatDir /inheritance:r /grant:r "*${currentSid}:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"
if ($LASTEXITCODE -ne 0) { throw 'UAT directory ACL failed' }
& icacls.exe $uatDir

$env:CAREFLOW_DB_PATH = $uatDb
$env:CAREFLOW_HOST = '127.0.0.1'
$env:CAREFLOW_PORT = '3001'
$env:CAREFLOW_COOKIE_SECURE = 'false'
npm run db:migrate -- "$uatDb"
if ($LASTEXITCODE -ne 0) { throw 'UAT migration failed' }
```

Record the operating system, Node version, exact `$uatDb`, and `icacls.exe` result in the checklist. If the probe, ACL, or migration fails, mark the UAT `BLOCKED`; do not install a compiler or weaken ACLs.
````

- [ ] **Step 5: Add Windows provisioning, host, and health commands**

Under account provisioning, add the exact PowerShell equivalents:

```powershell
$env:CAREFLOW_DB_PATH = $uatDb
npm run users -- create --username uat-assistant --display-name Assistant --role assistant
npm run users -- create --username uat-doctor --display-name Doctor --role doctor
$env:CAREFLOW_HOST = '127.0.0.1'
$env:CAREFLOW_PORT = '3001'
$env:CAREFLOW_COOKIE_SECURE = 'false'
npm start
```

In a second local PowerShell window, health is:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get
```

The account commands retain hidden interactive password prompts. Do not add a PowerShell variable or environment variable containing either password.

- [ ] **Step 6: Add Windows restart, controlled expiry, and lock inspection**

For every new PowerShell window, reconstruct the exact path and environment:

```powershell
Set-Location careflow-pilot
$uatDb = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) 'data\uat\careflow-uat.sqlite'))
$env:CAREFLOW_DB_PATH = $uatDb
$env:CAREFLOW_HOST = '127.0.0.1'
$env:CAREFLOW_PORT = '3001'
$env:CAREFLOW_COOKIE_SECURE = 'false'
```

After stopping the host with `Ctrl-C`, verify no listener and inspect only matching Node processes:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*dist/server/server.js*' } |
  Select-Object ProcessId, CommandLine
Test-Path -LiteralPath "${uatDb}.careflow-running"
```

No listener/process is the restart/maintenance precondition. A remaining lock is `BLOCKED`; do not delete it during UAT. Restart with `npm start` and verify health with `Invoke-RestMethod`.

For Scenario 5, with the host stopped and exactly one active `uat-doctor` session:

```powershell
npm run expire:uat-doctor-session -- --database "$uatDb" --confirm EXPIRE-UAT-DOCTOR-SESSION
```

Expected fixed output: `Doctor UAT session timestamp expired`. Then restart the same path and follow the existing browser assertions.

- [ ] **Step 7: Make the Thai guide and checklist platform-neutral at the tester boundary**

In `guide-th.md`, replace the POSIX-only provisioning command block with links to both platform sections while preserving the two exact account names and hidden-prompt rules:

```markdown
ให้ผู้ดูแลเลือกคำสั่งตามเครื่อง host ใน [admin-runbook.md](admin-runbook.md):

- [macOS/Linux (POSIX)](admin-runbook.md#macoslinux-posix)
- [Windows 11 PowerShell](admin-runbook.md#windows-11-powershell)

ทั้งสองเส้นทางต้องสร้างเพียง `uat-assistant` และ `uat-doctor` ผ่าน hidden interactive prompt ก่อนเปิด host ห้ามบันทึกรหัสผ่านในเอกสาร, command argument, environment, log, screenshot หรือ checklist.
```

In the checklist `ข้อมูลการรัน` table add:

```markdown
| ระบบปฏิบัติการและ Node.js | |
| ผลตรวจสิทธิ์ directory/ACL | |
```

Add preflight row `B-00` requiring Windows to record the native probe and restricted ACL result, or POSIX to record private directory modes; failure is `BLOCKED`.

- [ ] **Step 8: Run the documentation and security contracts GREEN**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
cd ..
rg -n "npm ci --ignore-scripts|verify:native-runtime|Windows 11 PowerShell|icacls.exe|Invoke-RestMethod|Get-NetTCPConnection|expire:uat-doctor-session" \
  careflow-pilot/README.md docs/uat/careflow-pre-pilot
rg -n "(?:password|รหัสผ่าน)\s*[=:]\s*\S+" \
  careflow-pilot/README.md docs/uat/careflow-pre-pilot && exit 1 || true
git diff --check
```

Expected: platform contract PASS, every required Windows term found, credential-assignment scan empty, diff check clean.

- [ ] **Step 9: Commit the Windows UAT operator path**

```bash
git add careflow-pilot/tests/server/windows-platform-contract.test.ts \
  careflow-pilot/README.md \
  docs/uat/careflow-pre-pilot/admin-runbook.md \
  docs/uat/careflow-pre-pilot/guide-th.md \
  docs/uat/careflow-pre-pilot/checklist.md
git diff --cached --check
git commit -m "docs: add native Windows UAT runbook"
```

---

### Task 4: Full Verification and Native Windows Evidence

**Files:**
- Verify only: `careflow-pilot/drizzle/**`
- Verify only: `careflow-webapp/**`
- Verify only: `stitch_careflow_clinic_management_system/**`
- Verify only: repository status and GitHub PR checks

**Interfaces:**
- Consumes: Tasks 1–3 and existing PR #1 on `codex/pre-pilot-uat`.
- Produces: clean local verification plus passing native Windows, Ubuntu Pilot, and frozen demo CI evidence.

- [ ] **Step 1: Run the focused Windows-support gate**

```bash
cd careflow-pilot
npm run verify:native-runtime
npx vitest run --config vitest.server.config.ts \
  tests/server/native-runtime.test.ts \
  tests/server/windows-platform-contract.test.ts
```

Expected: probe PASS and all focused tests PASS.

- [ ] **Step 2: Run the complete local product gate**

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
npm run db:generate
npx drizzle-kit check
```

Expected: client/server tests PASS, 27 Chromium cases PASS, lint/typecheck/build PASS, no schema changes, Drizzle check clean. The existing Vite chunk-size warning is non-blocking unless it becomes a build failure.

- [ ] **Step 3: Verify immutable scope and repository hygiene**

From the repository worktree root:

```bash
git diff 01b1888 -- careflow-pilot/drizzle
git diff --check
git status --short
git ls-files '*.sqlite' '*.sqlite-wal' '*.sqlite-shm' 'dist/**' 'test-results/**' 'playwright-report/**'
```

Expected: no migration diff, whitespace clean, no tracked SQLite/build/browser artifacts, and only intentional plan/implementation commits on the branch.

- [ ] **Step 4: Push the branch and wait for real Windows CI**

```bash
git push origin codex/pre-pilot-uat
gh pr checks 1 --watch --interval 20
```

Expected: all checks PASS, including every `Local Pilot (native Windows)` check and the Ubuntu Pilot/Frozen demo checks created by push and pull-request triggers.

- [ ] **Step 5: Inspect the Windows log for the intended install path**

Use the failing-check inspection helper only if any check is not green. For the passing Windows check, inspect the Actions log and confirm:

- install command is `npm ci --ignore-scripts`
- no `node-gyp rebuild` appears
- `CareFlow native runtime verification complete` appears before tests
- server tests and build exit 0

If the Windows job fails, keep the branch unclaimed and return to a focused RED/GREEN cycle; do not install Visual Studio or weaken the native probe.

- [ ] **Step 6: Record final readiness**

Update the ignored implementation report/progress ledger, if present, with exact local counts, GitHub Windows/Ubuntu check URLs, commit SHAs, unchanged migration evidence, and the remaining boundary: local synthetic Windows UAT only, not deployment or production.
