# CareFlow MVP Milestone 3 — Fulfillment Completion and Stock Integrity Design

## Status and approval boundary

The product direction in this document was approved by the user on 9 August 2026 after a read-only GPT-5.6 Sol Max review.

This written specification is still awaiting the user's explicit review and approval. It does not authorize implementation. After approval, the next deliverable is a separate step-by-step implementation plan. Code work starts only after the user approves that plan and the implementation-model choice.

This document completes **Milestone 3: Medication Safety** from the Local Pilot PRD. It does not claim that the whole Local Pilot is complete; Finance, Payment, Visit close, and the final Pilot hardening rehearsal remain later milestones.

## Goal

Finish the medication path that currently stops at a hard FEFO reservation:

1. A signed Order produces an immutable current Label version.
2. Assistant or Doctor starts preparation and receives a hard FEFO reservation.
3. Every exact allocation is confirmed by medication-level barcode or by manual confirmation with a reason.
4. Doctor performs final release or rejects the preparation.
5. Assistant or Doctor confirms handoff exactly once.
6. The server creates Dispense evidence, consumes the reservation, writes negative lot-level Stock Movements, and advances the Visit to AWAITING_CHARGE in one transaction.
7. Inventory corrections remain append-only, and unsafe lots can be quarantined without silently changing historical evidence.

The result remains a synthetic-data Local Pilot. It is not authorization to use CareFlow with real patient data or as a production medication-dispensing system.

## Existing baseline that must be preserved

Phase 2A and Phase 2B already provide:

- server-backed medication and lot inventory;
- append-only receipt movements;
- aggregate on-hand, reserved, and available quantities;
- deterministic multi-lot FEFO allocation;
- hard reservations tied to a signed Order version;
- one immediate transaction for reserve or release;
- exact idempotent response replay;
- revision checks, audit events, and role enforcement;
- a shared Pick List at /dispensing/:visitId for Doctor and Assistant;
- release of an active reservation after abandon, Order revision, or allergy safety change;
- real temporary SQLite integration tests and a two-browser E2E path.

This work extends those boundaries. It must not replace the UI design system, create a second inventory balance, accept browser-selected FEFO allocations, or weaken any existing idempotency, revision, audit, or transaction guarantee.

The following visual sources are frozen and must not be edited:

- careflow-webapp/
- stitch_careflow_clinic_management_system/

The implementation reuses the current React components, global tokens, responsive behavior, print styles, route shell, and the “one screen, one job” rule.

## Scope

### Slice 2C — Label and preparation evidence

- Add a unique synthetic internal barcode to every active demo Medication.
- Create one immutable Label version for the current signed Order version.
- Add an 80 × 100 mm Thai label preview and browser print flow.
- Record a print-request event before opening the browser print dialog.
- Create one preparation run in the same transaction that creates the hard reservation.
- Confirm every exact reservation allocation using barcode or manual reason.
- Complete preparation only when every allocation is confirmed.
- Abandon preparation with a required reason, invalidate that preparation, release its reservation, and return the Visit to AWAITING_PREPARATION.

### Slice 2D — Doctor final release, rejection, and invalidation

- Allow only Doctor to release medication.
- Require the current signed Order, Label, qualifying Label print request, preparation, and reservation to match exactly.
- Allow Doctor to reject with a required reason.
- Reuse the same Label version after rejection when the Order has not changed, but require a new print-request event before the next release.
- Invalidate old Label, preparation, and release evidence when Order or relevant allergy evidence changes before handoff.
- Prevent Assistant from releasing through both UI and direct API.

### Slice 2E — Handoff, Dispense, and stock-out

- Allow Assistant or Doctor to confirm handoff exactly once.
- Create immutable Dispense and Dispense Line evidence for every exact reservation allocation.
- Write one negative Stock Movement per allocated lot.
- Mark the reservation CONSUMED.
- Advance AWAITING_HANDOFF to AWAITING_CHARGE.
- Commit all those effects together or roll all of them back.

### Slice 2F — Compensating stock adjustment and lot quarantine

- Add append-only, reasoned stock adjustments that reference an existing Stock Movement.
- Permit Assistant or Doctor to quarantine an unreserved lot for safety.
- Permit only Doctor to release a lot from quarantine.
- Prevent any correction from making on-hand negative or lower than the quantity currently hard-reserved.
- Preserve the movement ledger as the only source of inventory quantity.

## Explicitly deferred

The following are not part of this design:

- Charge, Payment, waiver, PromptPay confirmation, Visit close, or OPD Card completion;
- physical-printer drivers, printer acknowledgements, calibration, or proof that paper actually emerged;
- GS1, GTIN, lot-level barcode, serialization, or controlled-substance workflows;
- partial fill, substitution, unit conversion, split handoff, returns, or refund;
- automatic reservation timeout;
- procurement, purchase orders, supplier management, or formal inventory counts;
- real patient or real medication data;
- cloud sync, FHIR, Bahmni integration, or other external integrations;
- redesign of the existing UI/CSS.

## Architecture

### Module ownership

A new fulfillment module owns the clinical-to-operational chain:

- Label creation and print-request evidence;
- preparation runs and confirmations;
- Doctor release and rejection;
- artifact invalidation;
- handoff and Dispense orchestration;
- the read model used by /api/dispensing routes.

The inventory module continues to own:

- lots and lot status;
- FEFO selection;
- hard reservations and allocation availability;
- reservation release or consumption;
- Stock Movement ledger and aggregate quantities;
- receipt, adjustment, quarantine, and unquarantine commands.

The medication module remains the owner of signed Medication Decisions and immutable Order Items. The visit module remains the owner of Visit state and revision. Fulfillment may call inventory and Visit operations inside one caller-owned audited transaction, but it does not duplicate their rules or balances.

The existing public URL family /api/dispensing/... and client route /dispensing/:visitId remain stable. Responsibility moves behind those routes incrementally; there is no wholesale refactor.

### Transaction boundary

Every command uses the existing audited immediate SQLite transaction:

1. authenticate the named actor and enforce permission;
2. strict-parse path, body, and Idempotency-Key;
3. acquire the immediate write transaction;
4. re-read Visit, current signed Order, artifact validity, reservation, lots, and revisions;
5. validate every precondition;
6. write domain evidence, Visit transition, Audit Events, and idempotency result;
7. commit once.

No response may describe success before commit. Any failure must leave every table, Visit revision, reservation, movement sum, and audit stream unchanged.

## Domain vocabulary

- **Current signed Order** is the latest non-invalidated Medication Decision of kind ORDER for the Visit.
- **Label version** is an immutable rendering snapshot created from exactly one signed Order version. Reprinting creates another Print Request, not another Label version.
- **Print Request** proves only that CareFlow recorded a request to open/send the current label to browser printing. It does not prove physical printer success.
- **Preparation** is one work run tied to one reservation, one Label version, and one signed Order version.
- **Preparation Confirmation** proves that one exact reservation allocation was confirmed by a medication barcode or manual reason.
- **Release** is immutable Doctor evidence that the exact current chain passed final review.
- **Rejection** is immutable Doctor evidence that a preparation was rejected with a reason.
- **Artifact Invalidation** makes a Label, Preparation, or Release unusable without deleting or rewriting it.
- **Handoff** is the once-only operational confirmation that creates Dispense and stock-out.
- **Dispense** is immutable Visit-level evidence of handoff. Each Dispense Line maps one-to-one to an immutable reservation allocation and one negative Stock Movement.
- **Compensating Adjustment** is a new signed ledger movement that references an earlier movement. It never edits the earlier row.
- **Quarantine** removes a lot from future FEFO eligibility. It does not change quantity.

## State machine

| Current Visit state | Command | Role | Required evidence | Result |
|---|---|---|---|---|
| AWAITING_PREPARATION | Start Preparation | Assistant or Doctor | Current signed Order, current valid Label, sufficient sellable stock | Create FEFO reservation and Preparation; move to PREPARING |
| PREPARING | Confirm Allocation | Assistant or Doctor | Current Preparation and exact unconfirmed allocation | Append confirmation; Visit remains PREPARING |
| PREPARING | Complete Preparation | Assistant or Doctor | Every allocation confirmed; all artifacts current | Mark Preparation complete; move to AWAITING_RELEASE |
| PREPARING | Abandon Preparation | Assistant or Doctor | Required reason | Invalidate Preparation, release reservation; move to AWAITING_PREPARATION |
| AWAITING_RELEASE | Reject Preparation | Doctor | Current Preparation and required reason | Append Rejection, invalidate Preparation, release reservation; move to AWAITING_PREPARATION |
| AWAITING_RELEASE | Release | Doctor | Current complete Preparation, current Label and qualifying Print Request, active reservation, sellable allocations | Append Release; move to AWAITING_HANDOFF |
| AWAITING_HANDOFF | Confirm Handoff | Assistant or Doctor | Current valid Release and complete active reservation | Append Dispense/Lines and negative movements, consume reservation; move to AWAITING_CHARGE |
| AWAITING_PREPARATION, PREPARING, AWAITING_RELEASE, or AWAITING_HANDOFF | Relevant Allergy Change | Doctor | New allergy revision and reason | Invalidate current artifacts, release active reservation, move to AWAITING_ORDER_REVISION |
| AWAITING_ORDER_REVISION, AWAITING_PREPARATION, PREPARING, AWAITING_RELEASE, or AWAITING_HANDOFF | Sign Order Revision | Doctor | New signed ORDER or NO_MEDICATION and reason where required | Invalidate old artifacts and release active reservation; ORDER creates new Label and moves to AWAITING_PREPARATION, NO_MEDICATION moves to AWAITING_CHARGE |

After handoff, later allergy updates apply to future work and do not rewrite the Dispense or Stock Movements. A Medication Decision cannot be revised after Dispense or after Charge finalization.

An expired or quarantined lot is rechecked at preparation completion, release, and handoff. The reservation has no automatic timeout, but it is not a promise that stock remains clinically sellable forever. If the clinic date changes after release, handoff is blocked until Doctor creates a safe new Order revision and the medication is prepared and released again. No hidden mutation occurs on that failed handoff.

## Core invariants

1. Every Label, Preparation, Release, and Dispense references the same current signed Order ID and version.
2. A Label version and its items are immutable.
3. There is at most one Label version per signed ORDER decision and one current valid Label per Visit.
4. One reservation has exactly one Preparation. Re-preparation uses a new reservation and a new Preparation.
5. There is at most one confirmation for each preparation/allocation pair.
6. Barcode identifies Medication at Drug Master level. Allocation ID identifies the exact lot and Order Item. Barcode never selects a lot.
7. Barcode mismatch writes no confirmation, audit event, Visit transition, or idempotent success result.
8. Manual confirmation requires a trimmed non-empty reason and records actor, UTC time, signed Order version, allocation, lot, and Medication.
9. Preparation cannot complete until every allocation is confirmed exactly once.
10. Release is Doctor-only and references exact Label, qualifying Print Request, Preparation, reservation, decision, and Visit revision.
11. A Label must have at least one Print Request before release.
12. After Doctor rejection without an Order change, the Label version is reused, but release requires a Print Request created after that rejection.
13. Invalidated evidence remains readable for history but cannot be printed, completed, released, or handed off.
14. One reservation can have at most one valid Release and one Dispense.
15. One allocation can appear in at most one Dispense Line and one DISPENSE Stock Movement.
16. Handoff is all-or-nothing across Dispense, lines, movements, reservation consumption, Visit state, Audit Events, and idempotency storage.
17. Before handoff, available equals on-hand minus active reservation allocations. After handoff, on-hand and reserved both fall by the same quantity, so available does not jump incorrectly.
18. The sum of append-only Stock Movement quantity_delta values is the only on-hand balance.
19. No transaction may make a lot's on-hand or available quantity negative.
20. Quarantined or expired lots cannot be reserved, completed, released, or handed off.
21. A lot with an active allocation cannot be quarantined. The operator must abandon, reject, or clinically invalidate the preparation first.
22. Same idempotency key and same request returns the original stored result unchanged; only the replayed metadata changes to true. Same key with different input returns conflict. A different key is still protected by domain uniqueness and revisions.
23. Actor identity always comes from the authenticated session, never from the browser payload.
24. UTC is stored canonically; business-date checks use Asia/Bangkok.

## Persistence design

### Medication barcode

Add internal_barcode to Medication:

- unique among active demo medications;
- normalized as trimmed uppercase;
- 1–64 visible ASCII characters;
- deterministic synthetic backfill using CF-DEMO- plus the existing three-digit Medication suffix;
- returned only where preparation requires it.

Because Medication already has child foreign keys, the migration is additive. It must not rebuild the Medication table. Existing active demo rows are backfilled before a partial unique index and insert/update enforcement are enabled.

### fulfillment_label_versions

Fields:

- id, clinic_id, visit_id;
- medication_decision_id and medication_decision_version;
- version, created_at, created_by;
- patient_hn_snapshot and patient_display_name_snapshot;
- clinic_name_snapshot.

One row is created in the same transaction as each new signed ORDER. Its version equals that Medication Decision version. The row is immutable and unique by signed decision.

For an existing current signed synthetic ORDER at upgrade time, a deterministic Label row and Label Items are backfilled from the signed evidence. Existing superseded Orders do not receive fabricated historical print evidence.

### fulfillment_label_items

Fields:

- id, label_version_id, medication_order_item_id, position;
- medication_id and medication_revision;
- display_name, strength, dosage_form, quantity, canonical_unit, and directions snapshots;
- internal_barcode_snapshot.

Rows are immutable. One Label Item maps to one signed Order Item. A medication spanning several lots still produces one medication label page, while Preparation keeps the separate lot allocations.

### fulfillment_label_print_events

Fields:

- id, label_version_id, sequence;
- requested_at, requested_by;
- renderer_version and media_size snapshot.

Rows are append-only and unique by Label/sequence. media_size is fixed to 80x100mm in this Pilot.

The UI records this event before invoking browser print. The wording is “ส่งคำขอพิมพ์แล้ว” or “เปิดหน้าพิมพ์แล้ว”, never “เครื่องพิมพ์สำเร็จ”.

### fulfillment_preparations

Fields:

- id, clinic_id, visit_id, reservation_id;
- medication_decision_id and medication_decision_version;
- label_version_id;
- revision and status ACTIVE or COMPLETED;
- minimum_print_sequence;
- created_at, created_by;
- completed_at, completed_by.

The row has a unique reservation ID. Revision starts at 1 and advances only through guarded preparation mutations. Completion fields are both null for ACTIVE and both present for COMPLETED.

For an active Phase 2B reservation that exists during upgrade, a deterministic ACTIVE Preparation is backfilled with no confirmations.

minimum_print_sequence is 1 for an initial preparation. After Doctor rejection, the Rejection records the Label's latest sequence and the next Preparation requires that sequence plus one. Abandon alone does not force reprinting.

### fulfillment_preparation_confirmations

Fields:

- id, preparation_id, reservation_allocation_id;
- medication_order_item_id, medication_id, lot_id, quantity;
- method BARCODE or MANUAL;
- barcode_snapshot for BARCODE, or manual_reason for MANUAL;
- confirmed_at and confirmed_by.

Rows are append-only and unique by preparation/allocation. A database check enforces exactly one method-specific evidence branch. Manual reason is 1–500 trimmed characters.

### fulfillment_artifact_invalidations

Fields:

- id, clinic_id, visit_id;
- artifact_type LABEL, PREPARATION, or RELEASE;
- artifact_id;
- trigger ABANDON, REJECT, ALLERGY_REVISION, or ORDER_REVISION;
- reason, invalidated_at, invalidated_by;
- replacement_decision_id when an Order revision created a replacement.

Rows are append-only and unique by artifact type/ID. Validity is derived from the absence of an invalidation row; immutable evidence is never overwritten or deleted.

Because artifact_id is polymorphic, database insert triggers verify that the named Label, Preparation, or Release exists and belongs to the same Clinic and Visit before accepting an invalidation.

### fulfillment_releases

Fields:

- id, clinic_id, visit_id;
- medication_decision_id and medication_decision_version;
- label_version_id and label_print_event_id;
- preparation_id, preparation_revision, reservation_id;
- released_at and released_by.

Rows are immutable. reservation_id is unique. The actor foreign key and route permission make the Doctor identity explicit.

### fulfillment_rejections

Fields:

- id, clinic_id, visit_id;
- preparation_id, reservation_id, label_version_id;
- print_sequence_at_rejection;
- reason, rejected_at, rejected_by.

Rows are immutable and unique by Preparation. They preserve why that run was rejected without invalidating the reusable Label version.

### fulfillment_dispenses

Fields:

- id, clinic_id, visit_id;
- medication_decision_id and medication_decision_version;
- label_version_id, preparation_id, release_id, reservation_id;
- handed_off_at and handed_off_by.

Rows are immutable. visit_id, release_id, and reservation_id are each unique for a successful medication path.

### fulfillment_dispense_lines

Fields:

- id, dispense_id, reservation_allocation_id;
- medication_order_item_id, medication_id, lot_id, quantity;
- medication name, strength, dosage form, unit, lot number, expiry, and directions snapshots.

Rows are immutable. reservation_allocation_id is unique. Every line has one matching negative Stock Movement.

### Reservation consumption

Add consumed_at, consumed_by, and consumed_dispense_id to inventory_reservations. They are null unless status is CONSUMED, and all are required for CONSUMED.

This is an additive migration with transition triggers. The parent reservation table must not be rebuilt because populated databases already contain allocation rows that reference it.

Allowed reservation transitions are:

- ACTIVE to RELEASED with required release evidence;
- ACTIVE to CONSUMED with required Dispense evidence.

RELEASED and CONSUMED are terminal.

### Generalized inventory_stock_movements

The receipt-only leaf table evolves to:

- movement_type RECEIPT, DISPENSE, or ADJUSTMENT;
- signed non-zero quantity_delta;
- source_type matching movement_type;
- source_id;
- reason, occurred_at, and actor_id.

Sign rules are:

- RECEIPT is positive;
- DISPENSE is negative;
- ADJUSTMENT may be positive or negative.

The polymorphic source uses database insert triggers:

- RECEIPT source must resolve to a receipt containing the same lot;
- DISPENSE source must resolve to a Dispense Line with the same lot and the negative of its quantity;
- ADJUSTMENT source must resolve to an Adjustment with the same lot and delta.

A unique source/lot constraint and append-only update/delete triggers prevent duplicate or rewritten movements.

The old source_id foreign key is receipt-specific. Migration therefore rebuilds only this leaf ledger table, copies every existing receipt movement without changing IDs or totals, recreates indexes/triggers, and verifies row count plus per-lot sums before commit. It does not rebuild Medication, Lot, Reservation, or Allocation parents.

### inventory_adjustments

Fields:

- id, clinic_id, lot_id;
- corrects_movement_id;
- quantity_delta;
- reason, adjusted_at, adjusted_by.

Rows are append-only. The referenced movement must belong to the same clinic and lot. The command may add or subtract, but the resulting on-hand must remain non-negative and at least as large as all active allocations on that lot.

### inventory_lot_status_events

Fields:

- id, clinic_id, lot_id;
- previous_status and next_status;
- reason, occurred_at, actor_id.

Rows are append-only. inventory_lots remains the current status summary and gains a revision field. Each command that changes that lot's on-hand, reserved, available, or sellability advances the revision once for that command. This includes receipt into an existing lot, reservation creation, reservation release, handoff/consumption, adjustment, quarantine, and unquarantine.

Allowed status changes are AVAILABLE to QUARANTINED and QUARANTINED to AVAILABLE. Unquarantine is rejected when the lot is expired on the current Bangkok clinic date.

## Migration safety

Every change is a new numbered migration. Previously committed migration files and hashes are immutable.

Required migration tests:

1. migrate a fresh empty database;
2. build a database at the current 0008 boundary with receipts, lots, an ACTIVE reservation, allocation rows, audit, and idempotency records;
3. enable foreign_keys before migration and prove it remains enabled;
4. migrate forward without deleting or changing identifiers;
5. verify all foreign-key checks, row counts, per-lot movement sums, reservation availability, and append-only triggers;
6. restart the application against the upgraded database;
7. reset synthetic data and prove new triggers and tables are restored correctly.

Changing PRAGMA foreign_keys inside Drizzle's migration transaction is not a valid strategy because SQLite ignores that change within an active transaction.

## API contract

All bodies and query strings use strict shared schemas with unknown-key and prototype-key rejection. Every mutation requires Idempotency-Key and the expected revision of each mutable record it changes.

### Read routes

- GET /api/dispensing/:visitId
  - permission: fulfillment:read;
  - returns Visit, patient summary, current signed Order, current Label and print summary, reservation and exact allocations, Preparation confirmations, Release, warnings, and server-derived allowed actions.

- GET /api/dispensing/:visitId/labels
  - permission: fulfillment:read;
  - returns only the current valid printable Label version and its items.

- GET /api/inventory/medications/:medicationId/lots
  - permission: inventory:read;
  - returns lot revision, status, expiry, on-hand, reserved, available, and movement references needed for safe adjustment.

### Preparation commands

- POST /api/dispensing/:visitId/reservations
  - permission: fulfillment:prepare;
  - expected revisions: Visit and Medication Decision;
  - payload includes current label_version_id;
  - creates reservation, allocations, Preparation, Visit transition, and audit atomically.

- POST /api/dispensing/:visitId/preparation-confirmations
  - permission: fulfillment:prepare;
  - expected revisions: Visit and Preparation;
  - payload is a strict union:
    - BARCODE: preparation_id, allocation_id, barcode;
    - MANUAL: preparation_id, allocation_id, reason.

- POST /api/dispensing/:visitId/complete-preparation
  - permission: fulfillment:prepare;
  - expected revisions: Visit and Preparation;
  - payload names preparation_id and reservation_id.

- POST /api/dispensing/:visitId/reservation-release
  - permission: fulfillment:prepare;
  - retains the existing public path;
  - expected revisions: Visit and Preparation;
  - payload names preparation_id, reservation_id, and required reason;
  - becomes the artifact-aware Abandon Preparation command.

### Label commands

- POST /api/dispensing/:visitId/labels/:labelVersionId/print-events
  - permission: label:print;
  - expected revisions: Visit;
  - payload names the current Medication Decision version;
  - appends a Print Request only when the Label remains current and valid.

### Doctor final-check commands

- POST /api/dispensing/:visitId/release
  - permission: fulfillment:release;
  - expected revisions: Visit and Preparation;
  - payload names decision/version, Label, qualifying Print Request, Preparation, and reservation.

- POST /api/dispensing/:visitId/reject
  - permission: fulfillment:release;
  - expected revisions: Visit and Preparation;
  - payload names Preparation/reservation and required reason.

### Handoff command

- POST /api/dispensing/:visitId/handoff
  - permission: fulfillment:handoff;
  - expected revisions: Visit;
  - payload names current Release and reservation;
  - creates the complete Dispense/stock-out transaction.

### Inventory-integrity commands

- POST /api/inventory/lots/:lotId/adjustments
  - permission: inventory:adjust;
  - expected revisions: Lot;
  - payload names corrects_movement_id, non-zero quantity_delta, and required reason.

- POST /api/inventory/lots/:lotId/quarantine
  - permission: inventory:quarantine;
  - expected revisions: Lot;
  - payload requires reason.

- POST /api/inventory/lots/:lotId/unquarantine
  - permission: inventory:release-quarantine;
  - expected revisions: Lot;
  - payload requires reason.

The server never accepts browser-supplied actor IDs, FEFO allocation choices, IDs for newly created movements, Dispense quantities, Visit status, or balance totals. The adjustment command may name an existing movement only as the required correction target; the server creates the new Adjustment and Movement IDs.

Stable domain errors include:

- ARTIFACT_STALE;
- BARCODE_MISMATCH;
- ALLOCATION_ALREADY_CONFIRMED;
- PREPARATION_INCOMPLETE;
- LABEL_PRINT_REQUIRED;
- RESERVATION_NOT_SELLABLE;
- RELEASE_REQUIRED;
- HANDOFF_ALREADY_CONFIRMED;
- LOT_RESERVED;
- STOCK_WOULD_BE_NEGATIVE;
- REVISION_CONFLICT;
- IDEMPOTENCY_CONFLICT.

Every successful POST in this design creates durable evidence and returns 201 on the first commit. A same-key replay returns 200 with replayed true while preserving the original stored result data exactly.

## Permissions

| Permission | Assistant | Doctor |
|---|---:|---:|
| fulfillment:read | Yes | Yes |
| fulfillment:prepare | Yes | Yes |
| label:print | Yes | Yes |
| fulfillment:release | No | Yes |
| fulfillment:handoff | Yes | Yes |
| inventory:read | Yes | Yes |
| inventory:receive | Yes | Yes |
| inventory:quarantine | Yes | Yes |
| inventory:release-quarantine | No | Yes |
| inventory:adjust | No | Yes |

Doctor receives the operational permissions needed to work alone, as required by the PRD. Assistant may take the safety-conservative action of quarantining an unreserved lot, but only Doctor may return it to sellable status or change quantity through adjustment.

The client hides unavailable actions, but every direct API request is independently checked. Assistant denial for release, unquarantine, and adjustment must occur before the server reads or reveals privileged clinical evidence beyond the normal Pick List read model.

## Audit evidence

New audit actions:

- label.version-created;
- label.print-requested;
- preparation.allocation-confirmed;
- visit.preparation-completed;
- preparation.rejected;
- medication.release-created;
- fulfillment.artifacts-invalidated;
- dispense.handoff-confirmed;
- inventory.stock-dispensed;
- visit.handoff-confirmed;
- inventory.stock-adjusted;
- inventory.lot-quarantined;
- inventory.lot-unquarantined.

Existing inventory.reservation-created, inventory.reservation-released, visit.preparation-started, and visit.preparation-abandoned remain.

Manual confirmation, abandon, rejection, artifact invalidation, adjustment, quarantine, and unquarantine require reasons under the audit policy. Barcode confirmation and ordinary release do not invent a reason.

Audit metadata must include the exact decision/version, artifact IDs, Visit transition, and relevant allocation metadata. Reservation, release, and handoff events include lot ID, lot-number snapshot, quantity, and unit for every allocation. Audit text must report the actual next Visit state and must never infer a state from a hard-coded generic value.

## UI and interaction design

### Dispensing screen

The current /dispensing/:visitId screen remains one route with one primary job selected by server state and role:

- AWAITING_PREPARATION: review current Order/Label and start FEFO preparation;
- PREPARING: confirm allocations, complete, or abandon;
- AWAITING_RELEASE:
  - Doctor sees final check with Release and Reject;
  - Assistant sees a read-only “รอแพทย์ตรวจปล่อย” state;
- AWAITING_HANDOFF: Assistant or Doctor confirms handoff once;
- AWAITING_CHARGE: read-only handoff completion summary and link to the later Checkout milestone.

The current cards, typography, spacing, colors, status badges, mobile behavior, and error components are reused. The obsolete “later Pilot phase” placeholder is removed only when the corresponding server capability exists.

### Barcode and manual confirmation

- One keyboard-wedge input is auto-focused only while the preparation task is active.
- Scanner characters followed by Enter submit the highlighted allocation.
- The UI displays Medication, exact lot number, expiry, and quantity for the allocation being confirmed.
- A Medication-level scan can confirm only an allocation for that Medication.
- Multi-lot allocations are confirmed separately even though they use the same Medication barcode.
- Mismatch keeps focus, preserves progress, writes nothing, and displays a Thai corrective error.
- Manual confirmation is a secondary action and requires a visible reason field that is preserved after validation, conflict, permission, or network errors.
- Important controls remain keyboard-accessible and at least 48 px.

### Label screen and print

/dispensing/:visitId/labels becomes a real protected route:

- preview uses signed snapshots only;
- one medication per 80 × 100 mm page;
- sidebar, top bar, buttons, and non-label content are hidden in print CSS;
- all required Thai fields fit within the page;
- invalid or superseded Label versions cannot be printed;
- clicking Print records the Print Request and only then opens browser print;
- cancellation or printer failure is not described as physical success.

### Inventory integrity UI

The existing Inventory screen gains a focused lot panel instead of a new visual system:

- all users with inventory:read can inspect on-hand, reserved, available, expiry, status, revision, and recent movement references;
- Assistant and Doctor can quarantine an eligible lot with a reason;
- Doctor can unquarantine or append a compensating adjustment;
- forms preserve reason and quantity after non-success responses;
- no control edits a balance or prior movement directly.

### Queue and dashboard

Queue and Overview include PREPARING, AWAITING_RELEASE, and AWAITING_HANDOFF as server-backed pending states. Labels and counts are Thai and lead to the role-appropriate work on the existing Dispensing route.

## Validation, concurrency, and failure behavior

- Every mutable command checks its expected revision after the immediate lock is acquired.
- Complete Preparation, Release, and Handoff re-read the full current artifact chain.
- Every stock-affecting command derives on-hand and active reserved quantity inside the same transaction.
- Two connections competing for the last stock can produce at most one success.
- Concurrent handoff requests can create at most one Dispense and one movement per allocation.
- Concurrent adjustment and handoff cannot make stock negative or consume stock held by another reservation.
- A network retry cannot create another confirmation, Print Request, Release, Rejection, Dispense, Adjustment, or status event under the same key.
- A domain duplicate under a different key returns a stable already-completed/conflict result without new evidence.
- All error responses are Thai-friendly and name the recovery action: reload latest data, rescan the shown Medication, enter a reason, ask Doctor to release, or prepare a new Order version.
- Form input is retained after validation, stale revision, permission, or server-unavailable responses.

## Testing strategy

Implementation follows test-first vertical slices.

### Server and database

- deterministic Label creation and current-Order backfill;
- label immutability and invalidation;
- Print Request replay and current-version blocking;
- barcode success, mismatch no-write, and normalized input;
- manual reason requirement and recorded evidence;
- exact allocation association for duplicate Medication items and multi-lot Orders;
- incomplete Preparation block and complete transition;
- abandon/reject release reservation and restore availability;
- required reprint after rejection without creating a new Label version;
- Doctor-only Release and Assistant direct-call 403;
- real active-reservation invalidation through allergy and Order revision from PREPARING, AWAITING_RELEASE, and AWAITING_HANDOFF;
- stale Label/Preparation/Release blocking;
- handoff one-time success and exact per-lot negative movements;
- all-or-nothing rollback at every injected failure point;
- reservation CONSUMED terminal state;
- receipt, Dispense, and Adjustment movement trigger enforcement;
- adjustment reference/reason and negative/reserved balance protection;
- quarantine role, active-allocation block, and expired unquarantine block;
- exact idempotency replay and collision behavior for every command;
- two-connection last-stock, handoff, and adjustment races;
- Bangkok date rollover between reservation, release, and handoff;
- populated 0008-to-current upgrade with foreign keys on;
- restart persistence, migration identity, health count, and full synthetic reset.

### Client

- role/state-specific primary action;
- barcode keyboard-wedge input and focus recovery;
- manual reason preservation;
- multi-lot progress and exact allocation rows;
- incomplete, mismatch, stale, unavailable, and permission states;
- Doctor Release/Reject controls and Assistant read-only state;
- Print Request before browser print;
- 80 × 100 mm print markup and hidden application chrome;
- handoff single-submit behavior;
- Inventory adjustment/quarantine permissions and draft preservation;
- Queue and Overview status coverage;
- 375 px, 768 px, and 1440 px layouts.

### Two-browser E2E

At minimum:

1. Assistant receives two sellable lots, Doctor signs an Order, Assistant prints Label, reserves FEFO, confirms all allocations, Doctor reloads and releases, Assistant reloads and hands off, and both see the same AWAITING_CHARGE state and reduced per-lot on-hand after service restart.
2. Doctor rejects a complete Preparation, availability is restored, the same Label version is reused, a new print request is required, and the second Preparation can complete.
3. Allergy or Order revision invalidates real active artifacts and blocks old print/release/handoff URLs.
4. A barcode mismatch and a manual confirmation without reason write nothing.
5. Two sessions compete for last stock and at most one completes reservation/handoff without a negative balance.
6. Quarantine and adjustment commands produce append-only evidence and survive restart.

The complete client, server, E2E, lint, typecheck, production build, migration, reset, and restart suites must remain green.

## Definition of done for Milestone 3

Milestone 3 is complete only when:

- the signed ORDER path reaches AWAITING_CHARGE through Label, Preparation, Doctor Release, Handoff, Dispense, and stock-out;
- the NO_MEDICATION path still creates none of those fulfillment artifacts;
- every old artifact is blocked after relevant Order/allergy change;
- all role denials are enforced by API;
- FEFO, hard reservation, exact allocation association, and no-negative-stock guarantees remain true;
- Print Request evidence is truthful about its physical-printer limitation;
- stock adjustment and quarantine are append-only and audited;
- data and identifiers survive service restart and populated migration;
- the frozen visual directories remain untouched;
- the final branch verification passes;
- a fresh GPT-5.6 Sol Max review reports no unresolved Critical or Important finding.

Passing this gate authorizes planning for **Milestone 4: Finance & Close**. It does not by itself complete the entire Local Pilot.

## Delivery order after this design is approved

1. Write and review the executable implementation plan.
2. Implement Slice 2C and review it.
3. Implement Slice 2D and review it.
4. Implement Slice 2E and review it.
5. Implement Slice 2F and review it.
6. Run whole-branch verification, restart/migration evidence, and two-browser E2E.
7. Request the final GPT-5.6 Sol Max read-only review.
8. Stop for user acceptance before starting Finance & Close.

No implementation step begins merely because this design file exists. The user approves the written design, the implementation plan, and the implementation start as separate gates.
