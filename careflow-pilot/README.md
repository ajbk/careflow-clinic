# CareFlow Local Pilot — SYNTHETIC DATA ONLY

> **PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง**

This is a runnable local, single-host pilot for the CareFlow rural-clinic workflow. It is deliberately limited to synthetic Patient generation, Intake, a shared Queue, the Doctor Consultation workspace, fulfillment, medication inventory, Charge collection, Visit closure, and a Doctor-only OPD Card. The enabled clinical slice records an append-only Allergy review, a SOAP Note and diagnosis draft, then an immutable signed clinical Note and exactly one synthetic medication decision: `ORDER` from the four repository-seeded `[DEMO]` medicines, or `NO_MEDICATION` with a reason.

Signing an `ORDER` moves the Visit to `รอจัดยา`; signing `NO_MEDICATION` moves it to `รอคิดเงิน`. For an `ORDER`, the enabled Milestone 4 path is: immutable Label → FEFO reservation → barcode/manual preparation evidence → Doctor release or reject → Assistant handoff → append-only per-lot stock-out → Doctor Charge finalization → one Cash, PromptPay, or full-waiver resolution → Doctor Visit closure → Doctor-only A4 OPD Card. A `NO_MEDICATION` Visit can be finalized directly for collection or atomically finalized with a full waiver. Rejecting preparation releases the reservation and requires a new print request before a later release. Assistants can receive or quarantine synthetic lots; Doctors can receive, release quarantine, and make a reasoned stock correction against a recorded movement. Signed hashes, revisions, pricing snapshots, finance evidence, closure evidence, Queue/dashboard status, and inventory survive a restart because they are stored in the local SQLite file.

## Quick start (Node 22)

### macOS/Linux

```bash
cd careflow-pilot
nvm use 22                         # or install Node >=22.13
npm ci
cp .env.example .env
install -d -m 700 data
export CAREFLOW_DB_PATH="$PWD/data/careflow.sqlite"
npm run db:migrate -- "$PWD/data/careflow.sqlite"
npm run dev
```

Open `http://127.0.0.1:5173` during development. The local UAT owner provisions synthetic-only role access outside this document; do not put sign-in material in repository files, documentation, tickets, or logs. The built local host serves both the API and SPA from one origin:

```bash
npm run build
npm start
# browse to http://127.0.0.1:3001
```

`CAREFLOW_DB_PATH` must name this pilot's absolute SQLite file in operations. Migration runs before the host listens. On restart, stop the process, start it again, and verify the same queue Visit and Consultation status are present; sessions and audit evidence persist in SQLite.

### Windows 11 PowerShell

หากเป็นการติดตั้งครั้งแรก ให้เริ่มจาก [คู่มือติดตั้ง Windows สำหรับผู้เริ่มต้น](../docs/uat/careflow-pre-pilot/windows-install-guide-th.md) ซึ่งแบ่งขั้นตอนเป็น Checkpoint พร้อมผลที่ต้องเห็นและจุดหยุดเมื่อไม่ผ่าน.

Run PowerShell as the dedicated local UAT account from either the repository root or its `careflow-pilot` directory:

```powershell
$startingDirectory = [System.IO.Path]::GetFullPath((Get-Location).Path)
$pilotRoot = if ([System.IO.Path]::GetFileName($startingDirectory) -eq 'careflow-pilot') {
  $startingDirectory
} else {
  [System.IO.Path]::GetFullPath((Join-Path $startingDirectory 'careflow-pilot'))
}
$pilotManifest = [System.IO.Path]::GetFullPath((Join-Path $pilotRoot 'package.json'))
if (-not (Test-Path -LiteralPath $pilotManifest -PathType Leaf -ErrorAction Stop)) {
  throw 'CareFlow pilot root not found; UAT is BLOCKED'
}
$pilotPackage = Get-Content -LiteralPath $pilotManifest -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
if ($pilotPackage.name -ne 'careflow-pilot') {
  throw 'CareFlow pilot root is invalid; UAT is BLOCKED'
}
Set-Location -LiteralPath $pilotRoot -ErrorAction Stop
npm ci --ignore-scripts
npm run verify:native-runtime
npm run build
```

Before creating the UAT directory or database, complete the administrator runbook using its [Windows 11 PowerShell instructions](../docs/uat/careflow-pre-pilot/admin-runbook.md#windows-11-powershell). It establishes and verifies the exact restricted ACL, migrates the database, provisions exactly two interactive UAT accounts, and only then starts the loopback host. Browse only to `http://127.0.0.1:3001`, and use that runbook for every restart/session-expiry check before starting the Thai Journey checklist.

Deployment, Windows service installation, backup/restore, network exposure, and real-data use remain explicitly disabled.

## Two-browser rehearsal

Run the executable [Thai Journey guide](../docs/uat/careflow-pre-pilot/guide-th.md) with its [result checklist](../docs/uat/careflow-pre-pilot/checklist.md) and [local administrator runbook](../docs/uat/careflow-pre-pilot/admin-runbook.md). It uses separate Assistant and Doctor browser contexts and the current visible labels: select `ไม่แพ้` or `แพ้` at Intake, use `เปิดฉลากยา`, press Enter after every barcode, verify role ownership while the action exists, and stop the entire UAT for the stated safety events.

The browser is not an authority for Patient or Visit state; the server database is. Never enter real clinical prose, real medication directions, or real Patient identity in this rehearsal.

## Explicit synthetic reset

Stop the Clinic Host first. Then run the exact guarded command:

```bash
npm run reset:synthetic -- \
  --database "$PWD/data/careflow.sqlite" \
  --confirm RESET-SYNTHETIC-PILOT
```

The command rejects relative paths, directories, symlinks, foreign databases, unknown tables, non-synthetic clinic markers, and a live host lock. It uses a distinct maintenance lock, an exclusive transaction, foreign-key order, secure deletion, WAL checkpoint/VACUUM verification, and preserves Clinic, Staff Accounts, and `account.*` audit rows. It prints success only after all checks pass. Never target a production or real-patient database.

## Filesystem and lock operations

On POSIX systems run the host under a dedicated OS account. Keep the data directory at `0700`, the SQLite database/WAL/SHM at `0600`, and the running/maintenance lock directories at `0700`. On Windows, use a dedicated service account and ACL the data directory to that account plus Administrators; do not grant broad interactive access. HTTPS termination and Caddy are outside this pilot.

A `.careflow-running` directory is intentionally not auto-deleted. If it remains after a crash, first verify that no CareFlow process is running, then remove only that exact stale lock directory with the host stopped. Do not delete the database, WAL, or SHM files as lock recovery.

## Deterministic checks

```bash
npm run lint
npm run typecheck
npm run test:client
npm run test:server
npm run build
npx playwright install chromium       # once per machine/CI image
npm run test:e2e
```

The E2E fixture creates a temporary synthetic-only SQLite file and two isolated browser contexts; it never reads local sign-in material from `.env`.

## Pre-pilot UAT

- [Thai tester guide](../docs/uat/careflow-pre-pilot/guide-th.md)
- [Result checklist](../docs/uat/careflow-pre-pilot/checklist.md)
- [Administrator runbook](../docs/uat/careflow-pre-pilot/admin-runbook.md)

## Milestone 4 and explicit limits

Synthetic Milestone 4 is complete: immutable pricing snapshots, Charge collection, full waiver, Visit close, and the Doctor-only A4 OPD Card are enabled only for this synthetic local pilot. Backup/restore, deployment, HTTPS/Caddy, external integrations, analytics, receipts/tax, QR/bank integration, partial collection, price-management UI, and all real-data use are **disabled**. The database reset command is a synthetic-data maintenance tool, not a backup or deployment mechanism. Never enter real Patient data, and do not treat this pilot as a clinical, billing, backup, or deployment system.
