# Task 3 report — Preparation and Label client workflow

## Delivered

- Replaced the obsolete inventory-reservation client model with the fulfillment Pick List contract.
- Added strict, retry-disabled mutations for start preparation, print request, allocation confirmation, completion, and abandonment. Each UI action creates a new immutable idempotency attempt; query invalidation occurs only after command success.
- Added the protected `/dispensing/:visitId/labels` screen. It shows only a current signed label, records the print request before `window.print()`, and clearly describes that the action is a request rather than proof of a physical print.
- Reworked Dispensing into fulfillment-state views: start preparation, focused barcode keyboard-wedge input, allocation confirmation rows, manual confirmation reason, local no-progress mismatch/error handling, completion guard, abandonment reason, and later-milestone release/handoff/charge messaging.
- Updated consultation next-step copy for preparation, release, and handoff statuses while leaving checkout/OPD placeholders intact.
- Added focused client regression coverage for label, scan, mismatch, manual-error preservation, incomplete completion, abandonment, and request-before-print behavior; updated the consultation CTA expectation and router permissions fixture.

## Validation

- `npm run typecheck:client` — passed.
- `npm run lint` — passed.
- `npm run build:client` — passed (the existing Vite chunk-size warning remains).
- RED follow-up: `npm run test:client -- tests/client/dispensing.test.tsx tests/client/router.test.tsx tests/client/consultation.test.tsx tests/client/query-client.test.ts` initially failed two focused assertions. The dispensing Pick List request was served and passed `fulfillmentPickListSchema`; its test expected standalone `lot-early` and `10`, whereas the deliberate UI strings are `ล็อต lot-early` and `จำนวน 10`. The medication catalogue fixture omitted contract-required `internalBarcode`, so strict response decoding correctly withheld the selectable result.
- GREEN follow-up: after making those deterministic fixture/visible-copy expectations contract-complete, the exact focused command passed: 4 files, 43 tests.
- `npm run typecheck:client` — passed again after the follow-up.

## Self-review

- No frozen directories were edited.
- Route access is guarded by `fulfillment:read`, matching server reads.
- UI command availability is gated by both returned `allowedActions` and the relevant client permission.
- Invalid/missing labels have no printable rendering or print action.
- No command mutation is configured with retries, and local drafts remain after errors.

## Review fixes — immutable labels and resilient preparation (RED/GREEN)

### RED

- Added failing client coverage for the current-label loading boundary, null/error/invalid responses, stale-version blocking, print permission/non-printable preview behavior, every immutable clinic/patient/medication snapshot, two-allocation scanner focus after success and API error, and repeated failed command attempts.
- Added server route assertions that the current-label GET response carries the stored `label_version` and `label_item` snapshots rather than live catalog fields.

### GREEN

- Extended `fulfillmentCurrentLabelSchema` and `labelFor` with clinic/patient snapshots plus medication revision, name, strength, dosage form, quantity, unit, Thai directions, and barcode snapshots.
- `LabelScreen` now takes its printable content only from `useCurrentLabel`; stale, null, invalid, and permission-blocked labels cannot produce printable output. Preview/status controls and unauthorized previews are excluded by label-page print CSS, with one medicine per 80 × 100 mm page.
- Confirmation success and API-error paths restore the keyboard-wedge scanner when another allocation remains. Deliberate retries create fresh idempotency keys; mutations remain retry-disabled and failed commands do not replace or invalidate cached Pick List state.

## Review-fix verification

- `npm run test:client -- tests/client/dispensing.test.tsx tests/client/router.test.tsx tests/client/consultation.test.tsx tests/client/query-client.test.ts` — passed, 4 files / 56 tests.
- `npm run test:server -- tests/server/fulfillment-routes.test.ts tests/server/fulfillment-completion.test.ts` — passed, 2 files / 12 tests.
- `npm run typecheck:client` — passed.
- `npm run typecheck:server` — passed.
- `npm run lint` — passed.
- `npm run build:client` — passed; the existing Vite chunk-size warning remains.
- A full `npm run test:client` run still has four pre-existing inventory fixture failures because those fixtures omit the now-required medication barcode; no inventory files were changed in this review.

## Follow-up — stale-refetch print race and complete client fixtures (RED/GREEN)

### RED

- Added a regression test that first renders a printable cached label, then triggers background refetches for both the current label and Pick List. Before the fix, the print action remained available while either request was unresolved.
- Added a Pick List request-error assertion to ensure a failed freshness check cannot leave a print action available.

### GREEN

- `LabelScreen` now requires a settled, error-free current-label and Pick List query before enabling print. During a background fetch it reports `CHECKING`, keeps the preview non-printable, and withholds the print action; Pick List failures report `UNAVAILABLE` and remain non-printable.
- `useDispensingPickList` and `useCurrentLabel` explicitly use `retry: false`, preserving deliberate command-attempt semantics and preventing automatic freshness retries.
- Completed all client medication fixtures with contract-required `internalBarcode` values, removing the prior inventory decoding failures.

### Follow-up verification

- RED: stale-refetch regression failed while the print action remained visible during pending requests.
- GREEN: `npm run test:client -- tests/client/dispensing.test.tsx tests/client/router.test.tsx tests/client/consultation.test.tsx tests/client/query-client.test.ts` — passed, 4 files / 58 tests.
- `npm run test:client` — passed, 10 files / 122 tests.
- `npm run typecheck` — passed (client and server).
- `npm run lint` — passed.
- `npm run build` — passed (client and server; existing Vite chunk-size warning remains).
