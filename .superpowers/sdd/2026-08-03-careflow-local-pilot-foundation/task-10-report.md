# Task 10 report — restart, production serving, guarded reset, and browser proof

## Scope delivered

- Added production-only Fastify client serving with known-asset handling, safe SPA deep-link fallback, and JSON-only `/api/**` 404s. `server.ts` enables the seam for the production host while injectable tests keep static serving disabled.
- Added WAL checkpointing to deterministic database close and Clinic Host signal shutdown.
- Added a real-file close/reopen integration test proving Patient, Intake, Visit, revisions, raw sessions, and audit IDs survive restart.
- Added a fail-closed `reset:synthetic` CLI with explicit absolute database + confirmation flags, identity/table/marker/lock guards, maintenance lock, exclusive transaction, ordered deletion, secure deletion, VACUUM/checkpoint verification, and account preservation.
- Reset validation reuses the exact migration hashes/folder timestamps and compares canonical SQLite schema/index/trigger definitions before any writable handle or destructive transaction; the host refuses to start while the maintenance lock exists.
- Added Playwright Chromium fixtures for two independent browser contexts sharing one Visit, plus 375×812, 768×1024, and 1440×900 responsive guardrails.
- Added pilot quick-start/rehearsal/reset/permissions documentation, root prototype-vs-pilot orientation, `.env.example` warning, and Ubuntu/Windows CI jobs.

## RED/GREEN evidence

- RED: the new restart/static/reset test files were added before the corresponding production seams; the focused commands failed on missing acknowledgement payload/static/reset behavior while the seams were incomplete.
- GREEN: after implementation, all focused tests pass and the full server suite is green. The E2E journey initially exposed a real fixture-clock expiry and locator strictness issue; both were corrected minimally, then the complete browser suite passed.

## Verification

From `careflow-pilot/`:

| Command | Result |
| --- | --- |
| `npm run test:server -- tests/server/restart.test.ts tests/server/health.test.ts tests/server/reset-synthetic-data.test.ts` | 12 passed |
| `npm run test:client` | passed (existing client suite) |
| `npm run test:server` | 110 passed across 12 files |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed (Vite client + tsup server) |
| `npm run test:e2e` | 4 passed (build + Chromium installed with `npx playwright install chromium`) |

Manual production smoke: built `dist/server/server.js` started on `127.0.0.1:3001` against a unique temp SQLite file; `/api/health`, `/`, and `/consultations/demo` returned 200; SIGTERM removed the exact `.careflow-running` lock and checkpointed the WAL.

Frozen demo guard: `git diff --exit-code -- ':(top)careflow-webapp'` remains clean.

## Broad final review fix round

- Start Consultation retries now reuse the same per-Visit idempotency attempt after a lost response; revision conflicts clear that attempt and keep the existing fail-closed reload flow.
- `npm run dev` starts the API with `--no-static` so a fresh checkout can use Vite before a client build; production `npm start` still requires the built client. Startup stderr now preserves only safe operator messages and never echoes filesystem/driver paths.
- Patient Search renders a Thai error and explicit retry, Queue and Overview keep valid cached rows visible during transient refresh failures while disabling start actions, and the prototype hard-coded Consultation link was removed.
- Added runtime/client regression coverage and made browser session fixtures relative to the test clock so the suite does not expire at a particular wall-clock time. Removed trailing EOF whitespace in the noted client files.

Fix-round verification from `careflow-pilot/`:

| Command | Result |
| --- | --- |
| `npm run test:client` | 46 passed |
| `npm run test:server` | 113 passed across 13 files |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed |
| `npm run test:e2e` | 4 passed |

`git diff --check` passed and the frozen `careflow-webapp/**` directory remains untouched.
