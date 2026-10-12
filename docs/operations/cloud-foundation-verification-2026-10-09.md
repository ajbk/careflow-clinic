# CareFlow cloud foundation verification — 9 October 2026

This handoff covers provider-independent F1–F3 implementation on synthetic data. It does **not** authorize deployment or real-patient use and does not establish production readiness.

## Working state and deliverables

- Isolated checkout: `/Users/ajbk/Documents/Codex/2026-10-02/task-2/careflow-foundation`.
- Branch: `codex/cloud-foundation-implementation`.
- HEAD: `416425bb1627a2ee7786950c91f3a6d3ea75b6d4` — the written design commit. **Product implementation is uncommitted.**
- [Thai design specification](../superpowers/specs/2026-10-02-careflow-cloud-foundation-design.md), [implementation scope/checklist](../superpowers/plans/2026-10-09-careflow-cloud-foundation.md), [operations runbook](cloud-foundation.md), [configuration reference](../../careflow-pilot/ops/cloud.env.example).
- Original checkout remains at `dce62ea783b3c5eade2e27536b61fcfd941bd645`; its pre-existing `.DS_Store` and `stitch_careflow_clinic_management_system/` were preserved. PR3 was not updated, merged or deployed. Published migrations 0000–0023 and the frozen demo were not edited.

## Delivered behavior

| Area | Result |
| --- | --- |
| Cloud request boundary | HTTPS origin, explicit loopback proxy peers, secure host cookie, CSRF, forwarding-header validation, bounded ingress and no-store API responses. |
| Accounts and evidence | Existing doctor/assistant permissions retained; durable account/IP password admission with concurrency/cardinality limits; append-only auth/access evidence with no raw clinical URL or credential payload. |
| Uncertain command results | Actor/generation-bound attempts, opaque browser breadcrumbs, explicit status/retry/cancel, atomic cancellation fencing. Context changes reset protected forms/cache; delayed old-context responses cannot erase recovery evidence. |
| Durability | Open-existing cloud identity/schema checks, consistent online SQLite snapshots, standard OpenPGP SEIPDv2 AES-256/GCM encryption, verified immutable storage/receipt interface. Local storage adapter is a synthetic fixture. |
| Recovery | New isolated target, full schema/FK/clinical/fulfillment/stock/finance/closure checks, session invalidation, generation rotation and account quarantine. Fresh credentials and documented doctor/operator reconciliation are required before reopening. |
| Maintenance | Encrypted pre-migration backup and migrated-copy validation, host-lock cleanup, CLI, health/write holds, injectable backup coordinator and bounded synthetic import dry run. |

## Verification evidence

Executor: connected Mac, darwin arm64, Node 24.16.0, SQLite 3.53.4. Build target is Node 22; actual deployment runtime/native modules need their own verification.

Raw logs are retained outside the repository at `/Users/ajbk/Documents/Codex/2026-10-02/task-2/verification/`.

| Check | Result | Evidence |
| --- | --- | --- |
| ESLint / TypeScript / production build | Passed | `quality-final-3.log` and `build-final-3.log` |
| Full client suite | 227 passed / 15 files | `client-final-3.log` |
| Full server suite | 498 passed / 48 files | `server-final-3.log` |
| HTTPS cloud browser journeys | 7 passed | `cloud-browser-final-4.log` |
| Full browser regression | 29 passed | `e2e-full-final-3.log` |
| Native SQLite runtime / Drizzle snapshot chain / whitespace | Passed | `verify:native-runtime`, `drizzle-kit check`, `git diff --check` |

The HTTPS journeys include separate doctor/assistant sessions, shared-cookie account changes, lost replies after handoff and cash collection, reload/restart, competing final-stock reservations, unknown/allergy cases, NO_MEDICATION/full waiver, and a nonempty clinical/stock/finance/closure backup and isolated restore. These seven tests overlap the full browser suite; the counts are not additive coverage claims.

Fault regressions include SIGKILL before and after an actual synthetic patient transaction commit, SQLite `SQLITE_FULL` during command-evidence persistence, staging permission failure, snapshot writes during backup, ciphertext tampering with a forged transport checksum, wrong key/environment, receipt publication failure, and local metadata failure after externally indexing a recoverable archive. They also cover historical fulfillment-chain corruption with restored exact triggers and valid foreign keys, closure hash corruption, stale snapshot age after slow transfer, and failed read-audit writes withholding the API payload.

## Independent review

One fresh whole-change reviewer examined the implementation and performed focused follow-ups. Findings repaired with regressions: cross-account attempt reuse; incomplete fulfillment/closure recovery validation; backup freshness measured from upload; migration lock leakage during staging setup; a custom cryptographic envelope; late old-generation responses clearing breadcrumbs; and OpenPGP recipient preferences silently selecting a legacy cipher mode. Final read-only follow-up found no remaining material findings in F1–F3. The reviewer independently passed 25 client and 21 server tests, demonstrated delayed responses across context changes away and back retain evidence, and confirmed SEIPDv1 downgrade rejection before plaintext file creation. The browser also exposed an initial recovery-notice subscription issue after reload; the final HTTPS rerun passes. A later full-suite run stalled before app startup: a stack sample located the main thread in Node CpSyncCopyDir/fcopyfile while copying built assets. The harness now serves the immutable build directly; test databases and TLS keys remain isolated. No test mutates those assets, and no product code was changed for this setup issue. The interrupted run and stack evidence are retained as e2e-full-final-2.log and e2e-fixture-copy-stack.txt.

## Remaining gates

Provider, data region, cost/retention and backup-age policy; remote backup adapter and independent failure domain; DNS/TLS and private-key custody; external alert delivery; target-host reboot/filesystem-full/interrupted maintenance drills; clean-host portability; MFA and full real-patient schema/security review; reconciliation of missing physical events; actual printer/scanner acceptance; legacy access/export mapping; and explicit deployment/go-live authorization. No RPO/RTO guarantee is asserted. No cloud service, persistent key, purchase or live clinic record was created or accessed.

## Transfer to a cloud coding executor

A source-only transfer bundle is prepared outside this repository under `../handoff/careflow-cloud-foundation-2026-10-09/`. It applies to PR3 base `dce62ea783b3c5eade2e27536b61fcfd941bd645` and includes the local design commit content plus all current tracked and untracked source changes. It contains no Git configuration, installed dependencies, build output, runtime database, generated key, browser profile, screenshot or raw log. Synthetic **test source** remains included so checks can run with freshly generated temporary fixtures. The accompanying manifest records every changed file and SHA-256. No commit or push is necessary for this file-based handoff; Git-based transfer would need separate permission to commit and push an explicitly named branch. A coding executor is separate from product hosting.
