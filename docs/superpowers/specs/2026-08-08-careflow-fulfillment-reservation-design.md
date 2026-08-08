# CareFlow Phase 2B — Fulfillment Reservation and FEFO Pick List Design

## Status

Approved for implementation by the user's instruction to continue the pilot. This is a bounded second slice of Medication & Inventory Safety. It makes the signed clinical `ORDER` actionable for stock planning without claiming that preparation, dispensing, payment, or handoff are complete.

## Goal

Connect a signed medication order to real synthetic inventory lots through one authoritative, transactional workflow:

1. A staff member opens a Visit in `AWAITING_PREPARATION`.
2. The server verifies the current signed `ORDER` and allocates every ordered item across sellable lots using FEFO.
3. The server creates a hard reservation and moves the Visit to `PREPARING` in the same immediate transaction.
4. Both browser sessions can reload the same Pick List, including exact lot allocations and the remaining inventory summary.
5. An explicit abandon or a doctor safety/order revision releases the reservation before the Visit returns to a state that can be prepared again.

The response is truthful about the boundary: an active reservation is a hard hold, but no barcode confirmation, label, final release, handoff, dispense movement, or charge is created in this slice.

## Scope

### Included

- Hard reservations tied to `visitId`, signed `medicationDecisionId`, and decision version.
- Immutable allocation rows tied to signed medication order items and exact inventory lots.
- Deterministic FEFO allocation by expiry date ascending, then lot id ascending; allocation can span multiple lots.
- Immediate transaction that checks stock, inserts all allocations, creates the reservation, and advances Visit `AWAITING_PREPARATION → PREPARING`.
- A persisted Pick List API and React screen at `/dispensing/:visitId`.
- Explicit abandon/release with a required reason; release returns the Visit to `AWAITING_PREPARATION` and does not mutate historical allocation rows.
- Safety hooks: doctor allergy review or medication-decision revision releases an active reservation in the same enclosing transaction before the Visit is moved to its next state.
- Inventory aggregates subtract active allocation quantities from on-hand without storing a balance column.
- Assistant and Doctor may read Pick Lists and start/abandon preparation; the server remains authoritative.
- Idempotent reserve/release commands with exact full-envelope replay.
- Audit evidence for reservation creation, release, preparation start, and preparation abandonment.

### Deferred to follow-up vertical slices

- Barcode/manual confirmation, preparation-item completion, labels, doctor final check/release/reject UI, handoff, dispense records, stock-out movements, adjustment, Finance, Payment, Visit close, and external integrations.
- Real patient or medication data. The pilot remains synthetic-only.

## Alternatives considered

1. **Reservation inside the existing inventory module (chosen).** Inventory owns lot availability, FEFO, reservation allocations, and the Pick List API while consuming immutable medication and Visit evidence. This preserves the Phase 2A module seam and keeps stock rules in one place.
2. **Put reservation state in the clinical workflow.** Rejected because clinical evidence should remain immutable and should not know how lot balances are derived; the workflow only invokes the inventory release hook at safety boundaries.
3. **Store a mutable `reserved_quantity` on each lot.** Rejected because it would create a second balance truth and make retries/races difficult to audit. Active allocations are the source of reserved quantity.
4. **Create a UI-only Pick List first.** Rejected because a visual list that does not hold stock would allow two browser sessions to promise the same last units.

## Domain vocabulary and invariants

- **Signed Order** is the immutable `ORDER` medication decision for one Visit and version. `NO_MEDICATION` can never create a reservation.
- **Reservation** is a hard hold for one signed Order version. Its status is `ACTIVE`, `RELEASED`, or `CONSUMED`; this slice creates and releases `ACTIVE` reservations only. There is no automatic timeout.
- **Reservation allocation** is an immutable quantity held from one exact lot for one exact order item. Release changes only the Reservation status; it never edits or deletes an allocation row.
- **Sellable lot** means `inventory_lots.status = AVAILABLE`, expiry strictly after the current clinic date in `Asia/Bangkok`, and positive ledger on-hand.
- **Available quantity** is `on-hand − active reservation allocations`. It is never stored directly.
- FEFO is deterministic: earliest sellable expiry first, then lexicographic lot id. A medication item can consume more than one lot.
- A reserve command is all-or-nothing across the entire signed Order. If any item lacks enough available quantity, no reservation, allocation, or Visit status update is committed.
- A Visit can have at most one active reservation for a signed decision. A new decision version cannot reuse an old reservation.
- Reserve requires the expected Visit revision and signed decision version. A stale command returns `REVISION_CONFLICT` and cannot allocate stock.
- Release requires a non-empty reason, is idempotent, and returns the Visit to `AWAITING_PREPARATION`. Release is only allowed while the Visit is `PREPARING` and the reservation is `ACTIVE`.
- Doctor allergy review and medication-decision revision release an active reservation in the same transaction before moving to `AWAITING_ORDER_REVISION`, `AWAITING_PREPARATION`, or `AWAITING_CHARGE`.
- `PREPARING` remains a pending fulfillment state, but the later preparation/dispense controls are deliberately not exposed yet.

## Persistence model

### `inventory_reservations`

`id`, `clinic_id`, `visit_id`, `medication_decision_id`, `medication_decision_version`, `status`, `created_at`, `created_by`, `released_at`, `released_by`, `release_reason`.

Foreign keys point to Clinic, Visit, signed Medication Decision, and Staff Account. A partial unique index enforces one `ACTIVE` reservation per `(clinic_id, visit_id, medication_decision_id, medication_decision_version)`. Checks allow only the documented statuses, require positive decision versions, and require a release timestamp/actor/reason whenever status is `RELEASED`.

### `inventory_reservation_allocations`

`id`, `reservation_id`, `medication_order_item_id`, `lot_id`, `position`, `quantity`, `lot_number_snapshot`, `expiry_date_snapshot`, `unit_snapshot`, `allocated_at`.

The row references the Reservation, signed order item, and Inventory Lot. Lot number, expiry, and unit snapshots make the Pick List stable even if a future catalog/lot display changes. Allocation rows are append-only at the database boundary; release is represented by the parent Reservation status. A unique key prevents duplicate allocation rows for the same reservation/order-item/lot.

Existing `inventory_stock_movements` remains receipt-only in this slice. Reserved quantity is derived with a grouped subquery over active allocations, so joins cannot multiply movements and make stock appear larger or smaller.

## API contract

- `GET /api/dispensing/:visitId` — requires `inventory:read`; returns the current Visit summary, synthetic patient identity, signed `ORDER`, and the active/released Reservation with item allocations. It never returns a draft or an unsigned order.
- `POST /api/dispensing/:visitId/reservations` — requires `inventory:reserve` and `Idempotency-Key`. Body:

```json
{
  "expectedRevisions": { "visit": 2, "medicationDecision": 1 },
  "payload": {}
}
```

  The command validates the Visit status, decision identity/version, lot sellability, and complete stock before writing. The first successful reservation returns `201`; a same-key retry returns the exact stored envelope with `replayed: true`. If the same decision is already actively reserved under another key, the command returns the existing Pick List without creating duplicate rows.

- `POST /api/dispensing/:visitId/reservation-release` — requires `inventory:reserve` and `Idempotency-Key`. Body:

```json
{
  "expectedRevisions": { "visit": 3 },
  "payload": { "reason": "ผู้ช่วยยกเลิกการจัดยาเพื่อทบทวนรายการ" }
}
```

  The command marks the active Reservation `RELEASED`, records the reason, advances `PREPARING → AWAITING_PREPARATION`, and returns the exact post-release Pick List envelope. A retry never creates a second release or changes the historical allocations.

All command bodies use strict shared Zod contracts with prototype-key rejection. Unknown fields, missing/short Idempotency-Key, stale revisions, wrong Visit state, expired/quarantined lots, and insufficient stock have stable API error codes. The endpoint never accepts a browser-supplied lot allocation; FEFO is server-owned.

## Permissions and audit

- Assistant: `inventory:read`, `inventory:receive`, `inventory:reserve`.
- Doctor: `inventory:read`, `inventory:reserve` (the existing medication-signing and clinical permissions remain unchanged).
- New audit actions:
  - `inventory.reservation-created` (optional reason) with Visit, decision, reservation, and lot/quantity metadata.
  - `inventory.reservation-released` (required reason) with release actor and allocation metadata.
  - `visit.preparation-started` and `visit.preparation-abandoned` (optional/required reason respectively).

The client hides command controls when the session lacks `inventory:reserve`, but direct API calls are rejected by the server. Clinical workflow release hooks run inside the same audited transaction as the allergy/order revision.

## UI behavior

- `/dispensing/:visitId` replaces the old unavailable placeholder with a Pick List screen that reuses `PageHeader`, `Card`, `SectionHeading`, `StatusBadge`, `.dispensing-body`, `.medication-card`, and existing CareFlow spacing/typography tokens.
- Before reservation, the screen shows the signed order, total quantities, a clear stock-availability warning, and one `เริ่มจองล็อตตาม FEFO` action for permitted staff.
- After reservation, the screen shows `PREPARING`, each exact lot/expiry/quantity allocation, the hard-reserved total, and a concise note that scanning, labels, final release, and handoff are later Pilot phases.
- A required-reason abandon control is available for an active reservation. The form preserves its reason on validation/conflict/network errors and refreshes the Pick List after success.
- Doctor and Assistant see the same server-backed Pick List after reload; the Doctor can also use the existing revision/safety workflow, which invalidates the reservation atomically.
- Existing `/dispensing/:visitId/labels` remains an explicit later-phase placeholder. No frozen visual directory or reference Stitch asset is edited.

## Testing strategy

- Server service tests use real temporary SQLite databases to cover two-lot FEFO, multi-item all-or-nothing behavior, expired/quarantined exclusion, exact available/reserved aggregates, insufficient-stock rollback, duplicate active reservation protection, release, append-only allocations, and Bangkok date boundaries.
- Route tests cover authentication, assistant/doctor permissions, strict validation, idempotency replay/conflict, audit events, stale Visit/decision revisions, and direct doctor/assistant behavior.
- Clinical workflow tests cover reservation release when an allergy safety review or signed decision revision invalidates a `PREPARING` Visit.
- Client tests cover Pick List loading/error states, FEFO allocation display, role-aware reserve/release controls, draft reason preservation, and route protection.
- One Playwright flow creates a synthetic Visit with a signed `ORDER`, receives two lots with different expiry dates, opens Pick List as Assistant, reserves across the earlier lot first, reloads as Doctor, and verifies the same allocation. A second command attempt proves insufficient stock does not leave a reservation or move the Visit.
- Existing Phase 2A, clinical, restart, reset, lint, typecheck, build, and E2E suites must remain green.

## Non-goals and rollout

No new external service or dependency is required. The migration is applied by the existing startup path. The feature is synthetic-only and intentionally stops at a hard, auditable reservation and Pick List. The next slice may add preparation confirmation, labels, release, and handoff while preserving these immutable allocation and revision boundaries.
