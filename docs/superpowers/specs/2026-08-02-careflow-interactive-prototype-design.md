# CareFlow Interactive Prototype Design

**Status:** Approved for implementation on 2026-08-02  
**Primary references:** `stitch_careflow_clinic_management_system/careflow_master_blueprint_final.md`, `stitch_careflow_clinic_management_system/careflow_product_requirements_document_prd.md`, and `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md`

## Goal

Build a polished, responsive, Thai-first interactive prototype of CareFlow that covers all 14 supplied screens and demonstrates a coherent rural-clinic patient journey using realistic seeded data stored on the device.

## Product Scope

The prototype supports one doctor and one assistant. It demonstrates role-focused navigation, but it does not claim to provide real authentication, API-level authorization, encryption, durable multi-device storage, or production offline synchronization.

The primary happy path is:

1. Assistant records patient identity, vitals, and chief complaint.
2. The patient enters the waiting queue.
3. Doctor opens the consultation, reviews history and vitals, records SOAP notes, selects a diagnosis, adds medication, and signs the visit.
4. The patient moves to dispensing.
5. Assistant verifies every medication, prints labels, and confirms dispensing; inventory decreases.
6. Assistant records Cash or PromptPay payment.
7. The visit becomes complete and an OPD summary is available to print.

Inventory receiving and appointment creation update their corresponding views. Dashboard and analytics derive their display from the same local demo state.

## Routes

- `/` — Clinic Overview
- `/intake` — Patient Intake
- `/queue` — Clinic Queue
- `/consultations/demo-visit` — Doctor Consultation Room
- `/visits/demo-visit/opd-card` — OPD Card Summary
- `/dispensing/demo-visit` — Medication Dispensing
- `/dispensing/demo-visit/labels` — 80×100 mm Drug Labels
- `/checkout/demo-visit` — Cash Collection
- `/patients/demo-patient/history` — Patient History Archive
- `/inventory` — Drug Inventory Dashboard
- `/inventory/receive` — Stock Reception
- `/appointments` — Appointment Calendar
- `/appointments/new` — New Appointment
- `/analytics` — Monthly Clinic Analytics

## Visual Source of Truth

`rural_health_commons/DESIGN.md` is authoritative. Implementation must use its tokens and rules rather than inventing a new visual direction.

- Primary: `#003629`
- Primary container / brand green: `#1b4d3e`
- Background and surface: `#f9faf7`
- Lowest surface / cards: `#ffffff`
- Secondary container / sidebar tone: `#d5e5ea`
- Text: `#191c1b`; supporting text: `#404945`
- Outline: `#707974`; subtle outline: `#c0c9c3`
- Error: `#ba1a1a`; error container: `#ffdad6`
- Typography: Be Vietnam Pro with a Thai-capable fallback only where the primary font lacks a glyph
- Type sizes: 32/700 headline, 26/700 mobile headline, 24/600 section heading, 18/400 large body, 16/400 body, 14/600 labels
- Spacing: 8 px base rhythm, 16 px mobile margin, 24 px gutter, 48 px desktop margin, 1120 px normal content maximum
- Cards and primary buttons: 1 rem radius; status chips: fully rounded
- Cards: `0 4px 20px` shadow at 5% opacity
- Controls: minimum 48 px touch target; inputs retain visible labels
- Focus: 2 px primary stroke

The app uses a shared sidebar shell for operational screens and a focused task shell for transactional flows. Mobile layouts collapse to one column and expose a compact navigation drawer or bottom navigation. Animation is limited to state transitions, hover feedback, progress, and toasts.

## Information Architecture and Components

The shell provides semantic navigation, search, clinic status, role switching, prototype labeling, and reset-demo-data control. Assistant mode hides doctor-only navigation such as clinical notes, longitudinal history, and analytics; this is demonstrative UI compartmentalization only.

Shared components include:

- `AppShell`, `Sidebar`, `MobileNav`, `PageHeader`
- `Card`, `MetricCard`, `StatusBadge`, `EmptyState`, `Toast`
- `PatientHeader`, `VitalsGrid`, `PatientJourneyTable`, `QueueBoard`
- `Field`, `UnitField`, `RadioCard`, `CheckboxCard`, `FormActions`
- `MedicationCard`, `InventoryTable`, `StockImpactSummary`
- `WeekCalendar`, `AnalyticsChart`
- `PrintableDocument`, `DrugLabel`

## Local Data Model

The prototype state contains patients, visits, inventory items and batches, appointments, transactions, the active role, and transient notifications. A versioned local-storage envelope persists mutations. Invalid or outdated stored data falls back to the seed state without breaking rendering.

Core workflow transitions are explicit:

- `intake → waiting`
- `waiting → consulting`
- `consulting → awaiting-dispensing`
- `awaiting-dispensing → awaiting-payment`
- `awaiting-payment → complete`

Signed clinical data becomes read-only in the interface. Dispensing is blocked until every medication is checked. Payment completion requires a selected method. Stock reception requires medicine, positive quantity, batch number, and future expiry date. Appointment creation prevents selecting a seeded unavailable slot.

## Printing

OPD summary uses A4 print CSS and removes application chrome. Medication labels use an explicit `80mm × 100mm` page size, high-contrast typography, and dosing symbols. Browser print preview is part of prototype validation; physical printer calibration is outside scope.

## Error and Empty States

Forms show Thai-first inline validation and preserve entered values. Successful workflow actions show concise toasts and navigate to the next logical step. Search with no results, empty queues, empty charts, and absent inventory alerts each have designed empty states. Local-storage parse failures silently restore the demo seed and announce that demo data was reset.

## Verification

- Unit tests cover workflow transitions, stock calculations, role-filtered navigation, persistence fallback, and appointment conflicts.
- Component tests cover intake validation, dispensing gating, payment selection, and reset behavior.
- The production build must pass.
- Manual checks cover every route, keyboard focus, mobile/desktop layouts, the complete patient journey, appointment creation, stock reception, A4 printing, and 80×100 mm label printing.

## Non-Goals

- Production authentication or authorization
- Real patient data or regulatory compliance claims
- PouchDB/CouchDB synchronization
- Real PromptPay confirmation
- Hardware printer drivers
- Real PDF export service
- Multi-user conflict resolution

