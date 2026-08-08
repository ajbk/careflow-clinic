# Task 2 report — label, preparation, clinical invalidation, and authenticated API

## Implemented

- Added a fulfillment service and route module. The service reads the current signed chain, creates immutable label versions, starts preparation in the caller transaction using inventory reservation primitives, records deterministic label print sequences, confirms allocations by normalized barcode or a required manual reason, completes fully confirmed preparations, abandons preparation with a released reservation, and reads the handoff chain.
- Replaced the legacy dispensing route ownership in inventory with fulfillment-owned authenticated routes. Commands use strict schemas, stable idempotency operations, and return 201 for the committed request and 200 for replay.
- Added fulfillment permissions and audit action policy entries. Assistant may read/prepare/print/abandon preparation; doctor additionally holds future release/handoff and inventory integrity permissions.
- Integrated label creation into signed ORDER finalization and decision revision. Clinical allergy and medication changes now invalidate label/preparation/release artifacts and accept safety changes through `AWAITING_RELEASE` and `AWAITING_HANDOFF`.
- Updated the fulfillment route tests for the current Pick List contract and added an end-to-end start → print → normalized barcode confirmation → completion test.

## Verification

- RED: `npm run test:server -- tests/server/fulfillment-routes.test.ts` initially failed with 404 for the missing current-label API.
- Focused GREEN: fulfillment route and clinical workflow tests pass (50 tests).
- Full: `npm run test:server` passes (219 tests); `npm run typecheck:server` and `npm run lint` pass; `git diff --check` is clean.

## Notes

- The existing Task 1 reset logic already deletes fulfillment children before parents and includes the fulfillment tables/triggers; no reset change was required for this task's existing schema.
- No migrations were created: Task 2 uses the established 0009/0010 persistence foundation unchanged.

## Follow-up review fixes

- Clinical safety transitions now release an active reservation from `PREPARING`, `AWAITING_RELEASE`, and `AWAITING_HANDOFF` before the Visit update. The preparation-abandoned audit records the actual previous status and computed ORDER/NO_MEDICATION next status. ORDER revisions create the replacement label in the same transaction.
- Abandonment now requires `PREPARING`, an active non-invalidated Preparation, and the exact active reservation. Preparation and Visit conditional writes check affected-row counts; stale or clinically invalidated artifacts cannot print, complete, abandon, or release.
- Assistant abandonment uses `fulfillment:prepare`; `fulfillment:release` remains doctor-only for the future release command. Fulfillment/Inventory are mandatory Clinical Workflow dependencies, preventing silent safety bypasses.
- Added regression coverage for all three late clinical states, both decision kinds, allocation immutability, actual audit transitions, barcode mismatch zero writes, incomplete completion, stale/invalidated old-artifact commands, and the permission boundary.
- Fulfillment route audit timestamps use the injected clock; unused fulfillment service dependencies were removed.

## Re-review fixes

- Duplicate reservation requests with different idempotency keys now return the existing chain without appending reservation-created or preparation-started audit evidence; the route reports 200 for that existing-chain command.
- Duplicate allocation confirmation now pre-reads the preparation/allocation key and returns `ALLOCATION_ALREADY_CONFIRMED` (409) without attempting a second append.
- Unimplemented release/handoff actions are no longer advertised in Pick List `allowedActions`; Assistant can abandon preparation through `fulfillment:prepare`, while the doctor-only `fulfillment:release` permission remains reserved for a future release command.
