# CareFlow Cloud Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans and test-driven-development. The user's 2026-10-09 instruction explicitly authorizes implementation without another planning approval. Leave product changes uncommitted until commit permission is obtained.

**Goal:** Deliver and verify the provider-independent F1–F3 foundation using synthetic data on the connected Mac.
**Architecture:** One Fastify application and SQLite writer; cloud ingress trusts only explicit loopback proxy peers. Existing business transactions and synthetic restrictions remain authoritative.
**Tech Stack:** React, Fastify, Drizzle/better-sqlite3, OpenPGP.js 6.3.2, Vitest, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-02-careflow-cloud-foundation-design.md` (commit 416425bb1627a2ee7786950c91f3a6d3ea75b6d4).

## Global Constraints

- Preserve workflow, synthetic-only guards, migrations 0000–0023, frozen demo, original checkout and its untracked files.
- No provider purchases, persistent credentials, real records, production deployment, push, merge or product commit.
- Local profile compatibility is retained; cloud enforcement is fail-closed. Development tests generate only temporary synthetic accounts and ephemeral encryption keys.
- F4 clinical schema/MFA and F5 provider/region/physical devices remain explicit gates.
- Keep a verification ledger outside the repository in `../verification/progress.md`; preserve evidence until handoff.

## Review Focus

- Proxy/header spoofing and CSRF must not bypass cloud restrictions, including nonstandard Host and direct-origin requests.
- Late commands and lost responses must not turn unknown results into new drug/stock/payment effects.
- Restore must not revive old sessions, disabled accounts, credentials, or stale browser commands.
- Wrong keys, corrupt/foreign backups, missing mounts and migration failures must preserve source data and keep writes closed.
- Sensitive payloads must never leak through status, logs, browser persistence or import reports.

## Task 1: F1 runtime, sessions, ingress and security evidence

**Files:** `src/server/config.ts`, `app.ts`, `auth/{hooks,routes,security,throttle}.ts`, `modules/platform/{sessions,schema,audit}.ts`, new migration, `src/shared/contracts.ts`, `src/client/lib/api-client.ts`, `src/client/auth/AuthProvider.tsx`; tests `cloud-security.test.ts`, `cloud-throttle.test.ts`, client API/auth tests. Paths below `careflow-pilot` unless stated.
**Interfaces:** Optional `AppConfig.cloud` holds canonical public origin, exact trusted loopback peers and environment identity. Session response provides CSRF/runtime generation metadata. Throttle exposes admission/release and durable expiry-bounded buckets; audit records only allowlisted metadata.
- [x] Write/run failing cloud config and spoofing/CSRF/cookie/no-store tests.
- [x] Implement optional cloud profile and request/session boundary; wire browser headers from authenticated metadata.
- [x] Write/run failing restart, cross-IP account, bounded-bucket and password-endpoint throttle tests; implement durable limiter.
- [x] Add auth/access audit coverage and dependency upgrade; run targeted tests, typecheck and existing suite.

## Task 2: F2 command recovery

**Files:** `modules/platform/{idempotency,operations}.ts`, new operation schema/migration, cloud hooks, shared contracts, `src/client/lib/{idempotency,api-client,command-recovery}.ts`, recovery UI and tests `command-recovery.test.ts`, client recovery tests, synthetic browser scenario.
**Interfaces:** Authorized operation status returns COMMITTED/CANCELLED/UNKNOWN without clinical payload; cancellation atomically inserts a tombstone unless already committed. Every cloud command carries the generation captured at intent creation; restoration changes it. Breadcrumbs contain only opaque identifiers/operation kind/generation.
- [x] Test and observe failure for cancellation-vs-late-write, different actors, unknown lookup, restart and stale generation.
- [x] Add transactional command fencing and status/cancel routes; maintain domain unique constraints and immutable replay behavior.
- [x] Test lost-response/reload/re-login client behavior before implementation; show unresolved operations and require explicit resolution before a new intent.
- [x] Verify handoff/payment/stock effects occur at most once with same/different keys and actor races.

## Task 3: F3 durability and maintenance

**Files:** `db/client.ts`, `host-lock.ts`, `maintenance/{backup,restore,integrity,migrations,operations-cli}.ts`, `scripts/operations.ts`, runtime health, `import/staging.ts`; tests `backup-restore.test.ts`, `cloud-database.test.ts`, `import-staging.test.ts`; operational README/config examples.
**Interfaces:** Open-existing mode never creates or migrates a cloud DB. Snapshot/manifest use the completed backup's identity, schema hashes and evidence counts. Standard authenticated hybrid encryption consumes an operator-supplied public/private key; no production key generator. Backup storage is an injected interface, exercised with a synthetic local store; provider installation is gated. Restore creates a new isolated destination, clears sessions, rotates generation, quarantines restored accounts and leaves maintenance active pending recorded reconciliation.
- [x] Observe failing tests for missing/foreign/drifted DB and non-migrating startup; implement explicit initialization/migration and volume identity checks.
- [x] Observe failing concurrent-snapshot/encryption/wrong-key/tampering tests; implement consistent snapshot, encrypted archive and validated storage receipts.
- [x] Observe failing restore/session/generation/account/reconciliation tests; implement fail-closed restore and recovery reporting.
- [x] Add explicit maintenance CLI, diagnostic health, backup age monitoring and runbook; retain operator-controlled stale-lock recovery.
- [x] Test synthetic import staging validation/repeat/conflicts; implement schema-independent envelope/dry-run only.

## Task 4: Integrated verification and delivery

- [x] Run lint, typecheck, all client/server tests, build and browser E2E; record failures by name.
- [x] Verify complete two-role clinic journey, intentional network failure and recovery with synthetic fixtures.
- [x] Obtain one fresh whole-change review; fix material findings with regression tests and rerun affected/full checks as justified.
- [x] Deliver changed files, evidence, provider/device/real-data gates and exact uncommitted state; request only commit/push authorization that is actually missing.

**Final evidence:** See `docs/operations/cloud-foundation-verification-2026-10-09.md`. Source-only cloud executor handoff is prepared; no product commit/push/deploy has been performed.
