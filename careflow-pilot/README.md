# CareFlow Local Pilot — SYNTHETIC DATA ONLY

> **PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง**

This is a runnable local, single-host pilot for the CareFlow rural-clinic workflow. It is deliberately limited to synthetic Patient generation, Intake, Queue, and the read-only Consultation workspace. Clinical Note, medication decisions, inventory, finance/payment, backup, HTTPS/Caddy, and real Patient data are **not enabled** in this milestone.

## Quick start (Node 22)

```bash
cd careflow-pilot
nvm use 22                         # or install Node >=22.13
npm ci
cp .env.example .env
mkdir -p data
npm run db:migrate -- "$PWD/data/careflow.sqlite"
npm run users -- create --username assistant --display-name "ผู้ช่วยคลินิก" --role assistant
npm run users -- create --username doctor --display-name "แพทย์คลินิก" --role doctor
npm run dev
```

The `users` command is interactive. Confirm `SYNTHETIC-ONLY`, then enter a 12–128 character password twice. Open `http://127.0.0.1:5173` during development. The production host serves both the API and built SPA from one origin:

```bash
npm run build
npm start
# browse to http://127.0.0.1:3001
```

`CAREFLOW_DB_PATH` must name this pilot's absolute SQLite file in operations. Migration runs before the host listens. On restart, stop the process, start it again, and verify the same queue Visit and Consultation status are present; sessions and audit evidence persist in SQLite.

## Two-browser rehearsal

1. In Browser A, sign in as `assistant`, acknowledge the pilot rules, generate a synthetic Patient, complete the chief complaint, and send the Visit to Queue.
2. In Browser B (a separate private window/context), sign in as `doctor`, acknowledge the rules, reload Queue, and start the Consultation.
3. Reload Browser A and confirm that the same HN/Visit is `กำลังตรวจ`. The browser is not an authority for Patient or Visit state; the server database is.

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

The E2E fixture creates a temporary synthetic-only SQLite file and two isolated browser contexts; it never reads credentials from `.env`.
