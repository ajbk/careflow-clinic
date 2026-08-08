# CareFlow Local Pilot — SYNTHETIC DATA ONLY

> **PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง**

This is a runnable local, single-host pilot for the CareFlow rural-clinic workflow. It is deliberately limited to synthetic Patient generation, Intake, a shared Queue, the Doctor Consultation workspace, and the Phase 2A medication inventory dashboard/receiving flow. The enabled clinical slice records an append-only Allergy review, a SOAP Note and diagnosis draft, then an immutable signed clinical Note and exactly one synthetic medication decision: `ORDER` from the four repository-seeded `[DEMO]` medicines, or `NO_MEDICATION` with a reason.

Signing an `ORDER` moves the Visit to `รอจัดยา`; signing `NO_MEDICATION` moves it to `รอคิดเงิน`. These are deliberately pending states only: this pilot does not prepare, dispense, charge, or close a Visit. Assistants can receive synthetic medication lots from the Inventory screen; stock reservation, FEFO allocation, preparation, dispensing, and handoff remain later phases. Signed hashes, revisions, Queue/dashboard status, and received inventory survive a restart because they are stored in the local SQLite file.

## Quick start (Node 22)

```bash
cd careflow-pilot
nvm use 22                         # or install Node >=22.13
npm ci
cp .env.example .env
install -d -m 700 data
export CAREFLOW_DB_PATH="$PWD/data/careflow.sqlite"
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

1. In Browser A, sign in as `assistant`, acknowledge the pilot rules, generate a synthetic Patient, complete the chief complaint, send the Visit to Queue, and review Allergy as `NONE_KNOWN` or `UNKNOWN` with the visible form.
2. In Browser B (a separate private window/context), sign in as `doctor`, acknowledge the rules, reload Queue, start the Consultation, complete all SOAP fields and a diagnosis, then choose one path:
   - `ORDER`: select `[DEMO] ยาทดสอบชนิด A`, set a synthetic quantity and directions, save the draft, then sign.
   - `NO_MEDICATION`: enter a synthetic reason, save the draft, then sign.
3. Reload Browser B and confirm the signed hash and decision version remain. Reload Browser A and confirm the same HN/Visit is `รอจัดยา` for `ORDER`, or `รอคิดเงิน` for `NO_MEDICATION`. Assistant must not open the Doctor Consultation URL; the server returns `403` before clinical data is read.
4. In Browser A, open `คลังยา`, choose `รับยาเข้าคลัง`, search `DEMO`, select a seeded medication, enter a positive quantity, a unique lot number, a future expiry date, and a synthetic supplier, then confirm the dashboard shows the new quantity and status. In Browser B, open `คลังยา` to verify the same stock is readable; the doctor has no receive action and the server rejects a direct receipt request with `403`.

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

The E2E fixture creates a temporary synthetic-only SQLite file and two isolated browser contexts; it never reads credentials from `.env`.

## Explicitly unavailable

Stock reservation, FEFO allocation, preparation, labeling, dispensing, Finance/payment, Visit close, backup/restore, deployment, HTTPS/Caddy, external integrations, analytics, and real Patient data are **disabled** for this local pilot. Inventory summary and synthetic stock reception are enabled as Phase 2A. The database reset command is a synthetic-data maintenance tool, not a backup or deployment mechanism.
