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
