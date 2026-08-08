# CareFlow Phase 2A — Inventory Foundation Design

## Status

Approved for implementation by the user's explicit instruction to start Phase 2. This is a bounded first slice of Medication & Inventory Safety. It does not implement dispensing, reservation, stock-out, finance, or visit close.

## Goal

Give the local synthetic-only pilot one authoritative way to receive medication stock and inspect aggregate availability. The slice must preserve the existing CareFlow visual shell and make the resulting stock trustworthy for the later dispensing workflow.

## Scope

### Included

- Medication inventory lots with medication revision and display snapshots.
- Append-only stock movements. A receipt creates the first positive movement; no balance is written directly.
- Atomic stock reception: receipt record, lot, receipt line, stock movement, and audit event commit together.
- Inventory aggregate read model with on-hand, reserved, allocatable, lot count, nearest expiry, and status.
- Synthetic medication search for the receiving assistant without widening the existing catalog permission.
- Assistant read/receive permissions and doctor read-only permissions.
- Idempotent receipt commands and audit trail.
- `/inventory` and `/inventory/receive` routes using the existing frozen visual language and CSS classes.

### Deferred to follow-up vertical slices

- Hard reservations, FEFO allocation, preparation, barcode/manual confirmation, labels, doctor release/reject, handoff, dispense records, stock-out, adjustment, finance, and visit close.
- Real patient or real medication data. The pilot remains synthetic-only.

## Alternatives considered

1. **Inventory module in the modular monolith (chosen).** Keep medication master data in `medication`, add an `inventory` module for lots, receipts, movements, service, routes, and client features. This preserves the existing boundary and leaves a clean seam for FEFO/reservation later.
2. Put inventory writes inside the medication module. This is smaller initially, but mixes a stable drug master with event history and makes later fulfillment state harder to reason about.
3. Build a UI-only mock first. This is visually quick, but it would create a second source of truth and invalidate the safety requirements as soon as dispensing starts.

## Domain vocabulary and invariants

- **Medication** is the stable synthetic Drug Master entry. It is not stock.
- **Inventory lot** is one received batch of one medication revision, identified by medication plus lot number and carrying expiry, supplier, status, and immutable medication display snapshots.
- **Stock movement** is an append-only ledger entry with a signed quantity delta and a source reference. In this slice the only movement type is `RECEIPT`; future slices add reservation/release/consume/adjustment entries without mutating old rows.
- **On-hand** is the sum of movement deltas for a lot, including stock that has become unusable.
- **Reserved** is `0` in this slice and is included in the API shape so later reservations do not change the dashboard contract.
- **Allocatable/available** is on-hand from lots that are not quarantined and whose expiry date is after the clinic date in `Asia/Bangkok`.
- A lot is expired when `expiryDate < clinicDate`; a lot expiring today is not accepted at reception because reception requires a future date.
- Quantity is a positive integer in the medication's canonical unit. No unit conversion happens in this slice.
- A medication/lot-number pair is unique within the clinic. Receiving the same lot again is rejected; merging receipts is deferred until a receiving workflow explicitly supports it.
- Stock balances are never stored or updated directly. All writes go through the receipt command and movement ledger.
- Receipt, lot, receipt line, movement, and audit event are one SQLite immediate transaction.
- Repeating an `Idempotency-Key` with the same request replays the original response. Reusing it with a different request is an `IDEMPOTENCY_CONFLICT`. For this synthetic-only inventory receipt DTO, the command stores the standard full `{ data, replayed }` envelope so its aggregate snapshot remains byte-equivalent after later receipts or a clinic-date rollover; it does not use a reference rebuild.

## Persistence model

Add an `inventory` module and one migration with these tables:

### `inventory_lots`

`id`, `clinic_id`, `medication_id`, `medication_revision`, `display_name_snapshot`, `strength_snapshot`, `dosage_form_snapshot`, `unit_snapshot`, `lot_number`, `expiry_date`, `supplier_name`, `status` (`AVAILABLE` or `QUARANTINED`), `created_at`, `created_by`.

The unique key is `(clinic_id, medication_id, lot_number)`. The medication foreign key and revision snapshot prevent a catalog edit from silently changing historical stock meaning.

### `inventory_receipts`

`id`, `clinic_id`, `supplier_name`, `note`, `received_at`, `received_by`.

### `inventory_receipt_lines`

`id`, `receipt_id`, `lot_id`, `quantity`, `unit_snapshot`.

The first API accepts one line per command, while this shape does not block a future multi-line receiving screen.

### `inventory_stock_movements`

`id`, `clinic_id`, `lot_id`, `movement_type` (`RECEIPT`), `quantity_delta`, `source_type`, `source_id`, `reason`, `occurred_at`, `actor_id`.

Database triggers reject update and delete operations on receipt, receipt-line, and stock-movement rows. The service computes aggregate stock with `SUM(quantity_delta)` and never writes a balance column.

## API contract

- `GET /api/inventory` — requires `inventory:read`; returns all active synthetic medications with aggregate rows sorted by display name and id.
- `GET /api/inventory/medications?q=...` — requires `inventory:receive`; reuses the medication search service for receiving without changing the existing `/api/medications` permission behavior.
- `POST /api/inventory/receipts` — requires `inventory:receive` and `Idempotency-Key`. Body uses the existing command envelope:

```json
{
  "expectedRevisions": { "medication": 1 },
  "payload": {
    "medicationId": "DEMO-MED-001",
    "quantity": 100,
    "lotNumber": "PCM-2608",
    "expiryDate": "2027-08-31",
    "supplierName": "องค์การเภสัชกรรม",
    "note": "รับเข้ารอบเช้า"
  }
}
```

The response is the standard `{ data, replayed }` command envelope and contains the receipt, lot, medication snapshot, and resulting aggregate for that medication. Inventory receipt retries use exact envelope replay because this synthetic-only DTO is non-sensitive and includes a historical aggregate snapshot that must not be recomputed.

Validation is handled by shared Zod contracts and server-side checks: quantity `1..999999`, lot `1..100` trimmed characters, supplier `1..200`, note `0..500`, future ISO date, active medication, and exact medication revision. Duplicate lots use `INVALID_STATE`; stale medication revisions use `REVISION_CONFLICT`.

## Permissions and audit

- Assistant: `inventory:read`, `inventory:receive`.
- Doctor: `inventory:read` only.
- New audit action: `inventory.stock-received` with optional reason from the receiving note and metadata containing receipt, lot, medication, and quantity.

The client hides receive actions for doctors, but the server remains authoritative and rejects direct unauthorized requests.

## Aggregate status

The server returns `OK`, `LOW`, `OUT`, or `EXPIRED`:

- `OUT`: available is `0` and on-hand is `0`.
- `EXPIRED`: available is `0` while on-hand is greater than `0`.
- `LOW`: available is `1..10` canonical units.
- `OK`: available is greater than `10`.

The threshold `10` is a named synthetic-pilot policy constant in the inventory module and is covered by tests; it is not presented as a clinic-wide reorder policy.

## UI behavior

- `InventoryScreen` reuses the existing `PageHeader`, `Card`, `SectionHeading`, `StatusBadge`, table, summary-card, and urgent-list styles already present in `globals.css`.
- The screen shows total medicines, available medicines, and attention-needed medicines; search filters the aggregate table locally; a receive action links to the receive form.
- `StockReceptionScreen` reuses the existing two-column form/impact layout. Medication search is server-backed and shows the canonical unit. The form preserves its draft on validation, stale-revision, duplicate-lot, or network errors. Success returns to `/inventory` and invalidates the inventory query.
- Both screens retain the existing `PILOT — ข้อมูลสังเคราะห์เท่านั้น` banner supplied by `AppShell`.
- Navigation adds a `คลังยา / Inventory` item for both roles; the receive CTA is only rendered for assistants.

## Testing strategy

- Server contract/service tests for aggregate calculations, expiry handling, low/out status, medication revision checks, duplicate lot rejection, append-only triggers, permissions, audit, idempotent replay/conflict, and atomic rollback.
- Client tests for inventory/reception query contracts, role-aware routing/nav, loading/error/success states, draft preservation, and status labels.
- One Playwright smoke flow: assistant logs in, searches a medication, receives a future-expiry lot, sees it in the inventory dashboard, and doctor can read the dashboard but cannot post a receipt.
- Existing clinical and medication tests must remain green.

## Non-goals and rollout

No new external service or dependency is required. The migration must be applied by the existing database startup path. The frozen `careflow-webapp/` and `stitch_careflow_clinic_management_system/` directories are read-only design references and must not be modified.
