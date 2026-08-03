# Task 10 report — restart, production serving, guarded reset, and browser proof

## Scope delivered

- Added production-only Fastify client serving with known-asset handling, safe SPA deep-link fallback, and JSON-only `/api/**` 404s. `server.ts` enables the seam for the production host while injectable tests keep static serving disabled.
- Added WAL checkpointing to deterministic database close and Clinic Host signal shutdown.
- Added a real-file close/reopen integration test proving Patient, Intake, Visit, revisions, raw sessions, and audit IDs survive restart.
- Added a fail-closed `reset:synthetic` CLI with explicit absolute database + confirmation flags, identity/table/marker/lock guards, maintenance lock, exclusive transaction, ordered deletion, secure deletion, VACUUM/checkpoint verification, and account preservation.
- Added Playwright Chromium fixtures for two independent browser contexts sharing one Visit, plus 375×812, 768×1024, and 1440×900 responsive guardrails.
- Added pilot quick-start/rehearsal/reset/permissions documentation, root prototype-vs-pilot orientation, `.env.example` warning, and Ubuntu/Windows CI jobs.

## RED/GREEN evidence

- RED: the new restart/static/reset test files were added before the corresponding production seams; the focused commands failed on missing acknowledgement payload/static/reset behavior while the seams were incomplete.
- GREEN: after implementation, all focused tests pass and the full server suite is green. The E2E journey initially exposed a real fixture-clock expiry and locator strictness issue; both were corrected minimally, then the complete browser suite passed.

## Verification

From `careflow-pilot/`:

| Command | Result |
| --- | --- |
| `npm run test:server -- tests/server/restart.test.ts tests/server/health.test.ts tests/server/reset-synthetic-data.test.ts` | 11 passed |
| `npm run test:client` | passed (existing client suite) |
| `npm run test:server` | 108 passed across 12 files |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed (Vite client + tsup server) |
| `npm run test:e2e` | 4 passed (Chromium installed with `npx playwright install chromium`) |

Manual production smoke: built `dist/server/server.js` started on `127.0.0.1:3001` against a unique temp SQLite file; `/api/health`, `/`, and `/consultations/demo` returned 200; SIGTERM removed the exact `.careflow-running` lock and checkpointed the WAL.

Frozen demo guard: `git diff --exit-code -- ':(top)careflow-webapp'` remains clean.
