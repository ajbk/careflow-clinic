# CareFlow Local Pilot — Finance and Visit Completion Design

**สถานะ:** อนุมัติแบบแล้วเมื่อ 9 สิงหาคม 2026; พร้อมจัดทำ implementation plan หลังผู้ใช้ทบทวนเอกสารนี้

**Milestone:** MVP Milestone 4 — Finance & Visit Completion

**ขอบเขตข้อมูล:** ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้กับข้อมูลผู้ป่วยจริง

## 1. เป้าหมาย

Milestone 4 ต่อจาก Milestone 3 ที่จบเมื่อ Visit อยู่ที่ `AWAITING_CHARGE` และทำให้เส้นทางต่อไปนี้จบอย่างถูกต้อง:

1. ระบบสร้าง Charge จากค่าตรวจและยาที่ส่งมอบจริง
2. Doctor ตรวจและ finalize Charge
3. Assistant หรือ Doctor บันทึก Cash หรือ Doctor ยืนยัน PromptPay แบบ manual
4. Doctor อนุมัติ full waiver จนยอดสุทธิเป็นศูนย์ได้ โดยต้องมีเหตุผล
5. Doctor ปิด Visit เมื่อ financial resolution ครบเท่านั้น
6. Doctor เปิดและพิมพ์ OPD Card ภาษาไทยจากหลักฐานที่ลงนามแล้วได้

Milestone นี้ต้องรักษากฎเดิมเรื่อง named accounts, role permissions, expected revisions, idempotency, append-only evidence, SQLite transaction, restart persistence, synthetic-only banner และ UI/CSS จาก Rural Health Commons

## 2. อำนาจของเอกสารและคำตัดสินที่แก้ความกำกวม

เอกสารนี้ขยาย `2026-08-03-careflow-pilot-design.md` เฉพาะ Milestone 4 การตัดสินใจต่อไปนี้ได้รับอนุมัติจากผู้ใช้โดยตรงและมีอำนาจเหนือข้อความเดิมที่ขัดกัน:

1. **จำนวนเงินทุกค่าเป็นจำนวนเต็มหน่วยบาท** TypeScript/DTO/command fields ใช้ suffix `Baht` และ physical SQLite columns ใช้ suffix `_baht` ไม่มีสตางค์ ไม่มีทศนิยม และไม่มีการปัดเศษ
2. **OPD Card, SOAP และ diagnosis เป็น Doctor-only** Assistant ไม่มี permission และ API finance ที่ Assistant อ่านได้ต้องไม่ส่ง Clinical Note, SOAP หรือ diagnosis
3. Milestone 4 ไม่รวม backup/restore, deployment, HTTPS/Caddy, production hardening หรือการอนุญาตใช้ข้อมูลจริง

ข้อความใน Pilot PRD เดิมที่ระบุให้เก็บเงินเป็นสตางค์ถูกแทนที่ด้วยข้อ 1 สำหรับ implementation นี้ ส่วน state machine, role separation, server-derived Charge และ append-only adjustment ใน PRD เดิมยังมีผล

## 3. ขอบเขตและการแบ่งงาน

Milestone 4 เป็นสเปกเดียวเพราะ Charge, Collection, close gate และ OPD Card ใช้ Visit state และ evidence chain เดียวกัน แต่ implementation แบ่งเป็นสอง vertical slices:

### Slice A — Pricing, Charge และ Collection

- pricing master และ immutable price snapshots
- server-derived Charge preview/finalization
- Cash, PromptPay และ full waiver
- Checkout UI ตาม role และ state
- Queue/Overview สำหรับ `AWAITING_PAYMENT` และ `READY_TO_CLOSE`

### Slice B — Visit Closure และ OPD Card

- Doctor-only close gate
- immutable `VisitClosure` evidence
- Doctor-only OPD projection และ A4 print
- restart, reset, populated-database upgrade และ end-to-end verification

แต่ละ slice ต้องผ่าน server, client และ migration tests ก่อนเริ่ม slice ถัดไป

## 4. Domain language

- **Price Master** — ราคาปัจจุบันที่กำหนดใน Clinic Configuration หรือ Drug Master ใช้สร้าง snapshot ใหม่เท่านั้น
- **Price Snapshot** — ราคาจำนวนเต็มบาทที่ผูกกับ signed Order Item หรือ Dispense Line และแก้ทับไม่ได้
- **Charge Preview** — read model ที่ server คำนวณจาก evidence ปัจจุบัน ยังไม่ใช่หลักฐาน finalized
- **Charge** — รายการคิดเงินที่ Doctor finalize แล้ว หนึ่งรายการต่อ Visit และแก้ทับไม่ได้
- **Charge Line** — รายการค่าตรวจหรือยาที่เป็นองค์ประกอบของ Charge
- **Full Waiver** — negative compensating adjustment ที่เท่ากับยอด Charge ทั้งจำนวน ทำให้ net due เป็นศูนย์ ไม่ใช่ส่วนลดบางส่วน
- **Payment** — หลักฐาน Cash หรือ PromptPay ที่ยืนยันแล้ว หนึ่งรายการต่อ Charge
- **Financial Resolution** — Payment ที่เท่ากับ net due หรือ Full Waiver ที่ทำให้ net due เป็นศูนย์
- **VisitClosure** — หลักฐาน immutable ว่า Doctor ตรวจ close gate และปิด Visit แล้ว
- **OPD Card** — Doctor-only printable projection จาก signed clinical evidence, actual Dispense, finalized finance evidence และ VisitClosure ไม่ใช่ source of truth แยกชุด

คำว่า “Collection” ใน UI เป็นสถานะรวม ส่วนหลักฐานที่บันทึกจริงคือ Payment หรือ Full Waiver

## 5. สถาปัตยกรรม

ระบบยังเป็น Fastify + TypeScript modular monolith บน Clinic Host และ SQLite WAL ผ่าน Drizzle migrations

### 5.1 Pricing Snapshot module

Interface ภายในที่เล็กและใช้ร่วมกันมีหน้าที่:

- `snapshotOrderPrices(tx, medicationDecisionId)` — อ่านราคาจาก Drug Master ฝั่ง server และสร้าง one-to-one Order price snapshots ใน transaction ที่ลงนาม decision
- `snapshotDispensePrices(tx, dispenseId)` — คัดลอกราคาเดิมจาก Order price snapshots ไปยัง Dispense price snapshots ใน transaction ที่ยืนยัน handoff
- `deriveChargeQuote(tx, visitId, expectedClinicPricingRevision)` — ตรวจ source chain และคืน Charge lines/amounts ที่คำนวณจาก snapshots เท่านั้น

Browser ไม่ส่งราคายา ค่าตรวจ line total หรือ grand total มาให้ module นี้เชื่อถือ

### 5.2 Finance module

`createFinanceService(...)` ซ่อน persistence และ arithmetic หลัง interface ต่อไปนี้:

- `getCheckout(visitId, actor)`
- `finalizeCharge(tx, actor, visitId, command)`
- `approveFullWaiver(tx, actor, visitId, command)`
- `recordCash(tx, actor, visitId, command)`
- `confirmPromptPay(tx, actor, visitId, command)`
- `readResolution(tx, visitId)`

Finance module เป็นเจ้าของ Charge, Charge Line, Adjustment และ Payment ไม่ให้ route หรือ UI คำนวณ net due เอง

### 5.3 Visit Completion workflow

`createVisitCompletionWorkflow(...)` ทำหน้าที่ orchestration สองอย่าง:

- `closeVisit(tx, actor, visitId, command)` — re-read finance/clinical evidence, ตรวจ gate, สร้าง VisitClosure และเปลี่ยน Visit เป็น `CLOSED` ใน transaction เดียว
- `getOpdCard(actor, visitId)` — สร้าง Doctor-only projection จาก immutable evidence และ closure snapshots

Visit service ยังเป็นเจ้าของ current Visit projection ส่วน VisitClosure เป็นหลักฐานการปิดที่แก้ทับไม่ได้

## 6. State machine

| สถานะก่อน | คำสั่ง | ผู้มีสิทธิ์ | เงื่อนไข | ผลลัพธ์ |
|---|---|---|---|---|
| `AWAITING_CHARGE` | Read Checkout | Assistant, Doctor | มี signed note และ signed current medication decision | แสดง server-derived preview; ไม่เขียนข้อมูล |
| `AWAITING_CHARGE` | Finalize Charge — collect | Doctor | ORDER ต้องมี current Dispense ที่ครบ; `NO_MEDICATION` ต้องเป็น signed current decision; price snapshots ครบ; revisions ตรง | สร้าง Charge + Lines; `AWAITING_PAYMENT` |
| `AWAITING_CHARGE` | Finalize Charge — full waiver | Doctor | เงื่อนไข Charge ครบและมี waiver reason | สร้าง Charge + Lines + Full Waiver; `READY_TO_CLOSE` |
| `AWAITING_PAYMENT` | Record Cash | Assistant, Doctor | amount เท่ากับ current net due และยังไม่มี Payment/waiver | สร้าง Cash Payment; `READY_TO_CLOSE` |
| `AWAITING_PAYMENT` | Confirm PromptPay | Doctor | amount เท่ากับ current net due, มี manual reference และยังไม่มี Payment/waiver | สร้าง PromptPay Payment; `READY_TO_CLOSE` |
| `AWAITING_PAYMENT` | Approve Full Waiver | Doctor | ยังไม่มี Payment/waiver และมีเหตุผล | สร้าง Full Waiver; `READY_TO_CLOSE` |
| `READY_TO_CLOSE` | Close Visit | Doctor | Charge finalized; resolution ถูกต้อง; IDs/revision ตรง; ไม่มี pending workflow | สร้าง VisitClosure + OPD header snapshots; `CLOSED` |
| `CLOSED` | Read Checkout | Assistant, Doctor | Finance permission | แสดงสรุป read-only โดยไม่ส่ง SOAP/diagnosis |
| `CLOSED` | Read/Print OPD Card | Doctor | มี VisitClosure | แสดง A4 Doctor-only projection |

กฎเพิ่มเติม:

- ก่อน Charge finalize เส้นทาง `NO_MEDICATION` ยังแก้เป็น signed Order revision ได้ตาม Milestone 3
- เมื่อ Charge ถูกสร้างแล้ว medication decision เดิมแก้ไม่ได้
- Full Waiver เป็นทั้งทางเลือกขณะ finalize และ compensating entry หลัง finalize แต่ก่อน Payment เท่านั้น
- ไม่มี partial waiver, partial payment, split tender, overpayment หรือ underpayment
- Payment หรือ waiver ที่สำเร็จแล้วแก้ method, amount, reason หรือ reference ไม่ได้
- Visit ที่ `CLOSED` reopen ไม่ได้ใน Milestone นี้

## 7. Amounts และ pricing snapshots

### 7.1 Integer-Baht invariant

- ทุก DTO, command และ Drizzle property ใช้ integer ที่ลงท้ายด้วย `Baht`; physical SQLite column ที่เป็น snake_case ลงท้ายด้วย `_baht`
- Zod ใช้ `.int()` และ SQLite ใช้ `INTEGER` พร้อม `CHECK`
- JSON จำนวนทศนิยม เช่น `100.5` ถูก reject เป็น validation error
- UI แสดง `350 บาท` ไม่แสดง `.00` และไม่มีช่องสตางค์
- Arithmetic ใช้ `lineTotalBaht = quantity × unitPriceBaht`
- จำนวนยาเป็น integer canonical unit จึงไม่มี rounding branch
- `unitPriceBaht` และ `consultationFeeBaht` ต้องไม่เกิน 1,000,000 บาทต่อหน่วย/Visit
- `grossTotalBaht` ต้องอยู่ระหว่าง 1 ถึง 100,000,000 บาท ทำให้ arithmetic อยู่ใน JavaScript safe-integer range ภายใต้จำนวน line/quantity ของ Pilot

### 7.2 Synthetic pricing fixtures

ค่าที่ migration seed และ reset verification ใช้คือ:

| Source | ราคา |
|---|---:|
| Consultation fee | 100 บาท |
| `DEMO-MED-001` | 5 บาท/หน่วย |
| `DEMO-MED-002` | 10 บาท/หน่วย |
| `DEMO-MED-003` | 50 บาท/หน่วย |
| `DEMO-MED-004` | 15 บาท/หน่วย |

ตัวเลขเหล่านี้เป็น synthetic fixtures ไม่ใช่ข้อเสนอราคาใช้งานจริง และ Milestone 4 ไม่มี price-management UI

### 7.3 Snapshot timing

1. Doctor ลงนาม ORDER: server อ่าน `medications.unit_price_baht` และเขียน Order price snapshot พร้อม medication ID/revision
2. Confirm Handoff: server คัดลอก unit price เดิมไป snapshot ที่ผูกกับ Dispense Line
3. Finalize Charge: server อ่าน consultation fee จาก current Clinic Configuration และอ่านราคายาจาก Dispense price snapshots
4. Charge Line เก็บ description, quantity, unit price และ line total snapshot ของตนเอง
5. การแก้ Price Master ภายหลังไม่เปลี่ยน signed Order, Dispense, Charge, VisitClosure หรือ OPD Card เดิม

ORDER ที่ถูกแบ่งหลายล็อตมี Charge evidence line ต่อ Dispense Line เพื่อ trace กลับล็อตจริงได้ Checkout และ OPD สามารถ group บรรทัดที่มี Order Item และ unit price เดียวกันเพื่อให้อ่านง่าย แต่ total ต้องมาจาก evidence lines เดิม

## 8. Persistence model และ database invariants

Migration ต้องสร้าง schema ต่อไปนี้แบบ additive โดยไม่แก้ migration `0000`–`0015`

### 8.1 Master additions

`clinic_config` เพิ่ม:

- `consultation_fee_baht INTEGER NOT NULL`
- `pricing_revision INTEGER NOT NULL`

`medications` เพิ่ม:

- `unit_price_baht INTEGER NOT NULL`

`pricing_revision >= 1`, consultation fee อยู่ในช่วง 1–1,000,000 บาท และ medication unit price อยู่ในช่วง 0–1,000,000 บาท การเปลี่ยนค่าราคาภายหลังต้องเพิ่ม master revision ที่เกี่ยวข้อง

### 8.2 `medication_order_price_snapshots`

- `id` primary key
- `medication_order_item_id` unique foreign key
- `medication_id`
- `medication_revision`
- `unit_price_baht_snapshot`
- `currency` ต้องเป็น `THB`
- `captured_at`

หนึ่ง signed Order Item ต้องมี snapshot หนึ่งรายการ ราคาต้องเป็น integer 0–1,000,000 บาท ตารางเป็น append-only

### 8.3 `fulfillment_dispense_price_snapshots`

- `id` primary key
- `fulfillment_dispense_line_id` unique foreign key
- `order_price_snapshot_id` foreign key
- `medication_id`
- `unit_price_baht_snapshot`
- `currency` ต้องเป็น `THB`
- `captured_at`

medication ID และราคาต้องตรงกับ Order price snapshot ที่อ้าง ตารางเป็น append-only

### 8.4 `finance_charges`

- `id` primary key
- `clinic_id`
- `visit_id` unique foreign key
- `source_kind` เป็น `ORDER` หรือ `NO_MEDICATION`
- `medication_decision_id` และ `medication_decision_version`
- `fulfillment_dispense_id` nullable; ต้องมีเฉพาะ `ORDER`
- `clinic_pricing_revision`
- `consultation_fee_baht_snapshot`
- `currency` ต้องเป็น `THB`
- `line_count`
- `finalized_by`, `finalized_by_display_name`, `finalized_at`
- `content_hash`

Charge เป็น append-only หนึ่งรายการต่อ Visit `line_count` ต้องอยู่ในช่วง 1–21 และ `content_hash` ครอบ canonical Charge header กับ ordered line payload ที่ finalize พร้อมกัน `grossTotalBaht` ไม่เก็บซ้ำใน header แต่ derive จากผลรวม immutable Charge Lines ทุกครั้ง เพื่อไม่ให้ stored aggregate ค้างหรือขัดกับ evidence rows

การ finalize เขียน Charge header, Charge Lines, Audit Events และ Visit transition ใน transaction เดียว หากจำนวน line ไม่ครบ `line_count`, hash ไม่ตรง หรือ Visit update ไม่สำเร็จ transaction ต้อง rollback ทั้งหมด การมีแถวใน `finance_charges` จึงหมายถึง finalized Charge เสมอและไม่ต้องมี mutable status column เพิ่ม

### 8.5 `finance_charge_lines`

- `id` primary key
- `charge_id` foreign key
- `position` unique ภายใน Charge
- `line_type` เป็น `CONSULTATION` หรือ `MEDICATION`
- `description_snapshot`
- `quantity`
- `unit_price_baht`
- `line_total_baht`
- `medication_order_item_id` nullable
- `fulfillment_dispense_line_id` nullable และ unique เมื่อไม่เป็น null

CONSULTATION ต้องมีหนึ่ง line, quantity 1 และไม่มี medication/dispense source ส่วน MEDICATION ต้องมี Order Item และ Dispense Line จาก Visit/Dispense เดียวกับ Charge `line_total_baht` ต้องเท่ากับ quantity คูณ unit price ตารางเป็น append-only

### 8.6 `finance_charge_adjustments`

- `id` primary key
- `charge_id` unique foreign key
- `kind` ต้องเป็น `FULL_WAIVER`
- `amount_baht`
- `reason`
- `approved_by`, `approved_by_display_name`, `approved_at`
- `content_hash`

`amount_baht` ต้องเท่ากับค่าติดลบของผลรวม `line_total_baht` ทุก Charge Line, reason ต้อง trim แล้วมี 1–500 ตัวอักษร, Charge ต้องยังไม่มี Payment และต้องไม่มี adjustment อื่น ตารางเป็น append-only

### 8.7 `finance_payments`

- `id` primary key
- `charge_id` unique foreign key
- `visit_id` unique foreign key
- `method` เป็น `CASH` หรือ `PROMPTPAY`
- `amount_baht`
- `manual_reference` nullable
- `confirmed_by`, `confirmed_by_display_name`, `confirmed_at`
- `content_hash`

Payment ต้องเท่ากับ current net due, ต้องไม่มี Full Waiver และ Visit/Charge ต้องตรงกัน `PROMPTPAY` ต้องมี reference 1–100 ตัวอักษร ส่วน `CASH` ต้องมี reference เป็น null ตารางเป็น append-only

### 8.8 `visit_closures`

- `id` primary key
- `clinic_id`
- `visit_id` unique foreign key
- `charge_id` unique foreign key
- `payment_id` nullable foreign key
- `waiver_adjustment_id` nullable foreign key
- `clinic_name_snapshot`
- Patient snapshots: ID, HN, display name, birth date, sex
- Doctor snapshots: ID และ display name
- `closed_at`
- `content_hash`

ต้องมี financial resolution เพียงแบบเดียว:

- Payment present และ waiver null โดย Payment เท่ากับ net due หรือ
- Payment null และ Full Waiver present โดย net due เท่ากับศูนย์

Closure source ทุกตัวต้องเป็น clinic/visit เดียวกัน ตารางเป็น append-only และสร้างพร้อม Visit status/revision update ใน transaction เดียว

### 8.9 Defense in depth

Database เพิ่ม:

- foreign keys และ unique indexes ตาม invariants ข้างต้น
- insert guards สำหรับ source clinic/visit, price propagation, arithmetic และ resolution chain
- Payment, waiver และ close guards ตรวจว่า Charge มีจำนวน line ตรง `line_count` ก่อนใช้ผลรวม
- update/delete blockers สำหรับ snapshot/evidence tables ทุกตาราง
- unique constraints ป้องกัน Charge, Payment, Waiver หรือ Closure ซ้ำแม้ application guard ผิดพลาด
- partial unique index บังคับหนึ่ง CONSULTATION line ต่อ Charge
- Visit เปลี่ยนเป็น `CLOSED` ได้ต่อเมื่อมี Closure ของ Visit เดียวกัน และ `visits.closed_at` ต้องเท่ากับ `visit_closures.closed_at`; `CLOSED` เปลี่ยนกลับสถานะอื่นไม่ได้

Audit Event เป็นหลักฐานการกระทำเพิ่มเติม ไม่ใช้แทน domain evidence tables

## 9. Permissions และ privacy

| Permission | Assistant | Doctor |
|---|---:|---:|
| `finance:read` | ✓ | ✓ |
| `finance:finalize-charge` | — | ✓ |
| `finance:record-cash` | ✓ | ✓ |
| `finance:confirm-promptpay` | — | ✓ |
| `finance:waive` | — | ✓ |
| `visit:close` | — | ✓ |
| `opd:read` | — | ✓ |

ข้อบังคับ:

- Assistant เรียก direct API เพื่อ finalize Charge, PromptPay, waiver, close หรือ OPD ต้องได้ `403 FORBIDDEN`
- Doctor ใช้ operational permissions เดิมและบันทึก Cash ได้เมื่อทำงานคนเดียว โดยไม่ impersonate Assistant
- Checkout DTO สำหรับ Assistant มีข้อมูล patient identity ขั้นต่ำและ finance evidence เท่านั้น ไม่มี SOAP, diagnosis, plan, amendment content หรือ clinical hashes
- OPD route ตรวจ `opd:read` ที่ server และ `AuthGate` ที่ client การซ่อน route อย่างเดียวไม่ถือเป็น security control

## 10. API contracts

ทุก mutation ใช้ strict Zod schema, reject unknown/prototype keys, `Idempotency-Key` และ `expectedRevisions`

### 10.1 Read Checkout

`GET /api/checkout/:visitId` — `finance:read`

คืน:

- patient identity ที่จำเป็นและ Visit summary/revision
- preview หรือ finalized Charge และ immutable line IDs
- `grossTotalBaht`, `adjustmentTotalBaht` และ `netDueBaht` ที่ derive จาก immutable lines/adjustments
- Payment หรือ `COLLECTION_NOT_REQUIRED` state
- `collectionState` ที่เป็น `PENDING_CHARGE`, `AWAITING_COLLECTION`, `PAID_CASH`, `PAID_PROMPTPAY`, `COLLECTION_NOT_REQUIRED` หรือ `CLOSED`
- `allowedActions` ที่ใช้ค่า `FINALIZE_CHARGE`, `APPROVE_FULL_WAIVER`, `RECORD_CASH`, `CONFIRM_PROMPTPAY`, `CLOSE_VISIT` หรือ `READ_OPD` และคำนวณจาก actor permission + Visit state
- `closeBlockers` ที่ไม่เปิดเผย clinical content

ก่อน `AWAITING_CHARGE` ตอบ `FINANCE_NOT_READY`; ตั้งแต่ `AWAITING_CHARGE` ถึง `CLOSED` อ่านได้

Shared Visit DTO เพิ่ม `closedAt: string | null` ค่าเป็น null ก่อน close และต้องเท่ากับ Closure timestamp หลัง close

### 10.2 Finalize Charge

`POST /api/checkout/:visitId/charge-finalizations` — `finance:finalize-charge`

```text
expectedRevisions: { visit, clinicPricing }
payload:
  { settlementIntent: "COLLECT" }
  | { settlementIntent: "FULL_WAIVER", waiverReason }
```

ไม่มี amount หรือ client-computed line ใน request

### 10.3 Approve Full Waiver หลัง finalize

`POST /api/checkout/:visitId/waivers` — `finance:waive`

```text
expectedRevisions: { visit }
payload: { chargeId, reason }
```

ใช้ได้เฉพาะ `AWAITING_PAYMENT` ที่ยังไม่มี Payment/waiver

### 10.4 Cash

`POST /api/checkout/:visitId/payments/cash` — `finance:record-cash`

```text
expectedRevisions: { visit }
payload: { chargeId, amountBaht }
```

`amountBaht` เป็น integer และต้องตรง net due ฝั่ง server

### 10.5 PromptPay

`POST /api/checkout/:visitId/payments/promptpay` — `finance:confirm-promptpay`

```text
expectedRevisions: { visit }
payload: { chargeId, amountBaht, manualReference }
```

`manualReference` เป็นข้อความอ้างอิงที่ Doctor ตรวจจากหลักฐานภายนอก ไม่ใช่ผลยืนยันจากธนาคาร และไม่มี upload ใน MVP

### 10.6 Close Visit

`POST /api/visits/:visitId/close` — `visit:close`

```text
expectedRevisions: { visit }
payload:
  { chargeId, resolution: { kind: "PAYMENT", paymentId } }
  | { chargeId, resolution: { kind: "COLLECTION_NOT_REQUIRED", waiverAdjustmentId } }
```

server re-reads source chain ทุกตัว ห้ามเชื่อ IDs จาก client โดยไม่ตรวจความสัมพันธ์

### 10.7 OPD Card

`GET /api/visits/:visitId/opd-card` — `opd:read`

ใช้ได้เฉพาะ `CLOSED` และคืน Doctor-only OPD DTO จาก signed evidence กับ closure snapshots

### 10.8 Idempotency และ concurrency

- operation names แยกและ versioned เช่น `finance.finalize-charge.v1`, `finance.record-cash.v1`, `finance.confirm-promptpay.v1`, `finance.approve-waiver.v1`, `visit.close.v1`
- scope ทุก command ผูกกับ Visit ID
- key + payload เดิมคืน evidence IDs และ response เดิม; first commit `201`, replay `200`
- key เดิม + payload ต่างตอบ `IDEMPOTENCY_CONFLICT` โดยไม่มี write
- replay reference ต้อง pin Charge/Adjustment/Payment/Closure IDs และอ่าน immutable evidence เดิม ไม่ประกอบ response จาก current master
- ใช้ audited transaction แบบ `BEGIN IMMEDIATE`, conditional Visit revision update และ unique constraints
- Cash, PromptPay และ waiver ที่ชนกันสำเร็จได้เพียงหนึ่งคำสั่ง อีกคำสั่งตอบ state/revision conflict โดยไม่เกิด partial write

## 11. Stable errors

| Code | HTTP | ความหมาย |
|---|---:|---|
| `FINANCE_NOT_READY` | 409 | Visit ยังไม่ถึงขั้นคิดเงิน |
| `CHARGE_SOURCE_INCOMPLETE` | 409 | signed decision, Dispense หรือ source chain ไม่ครบ |
| `PRICE_SNAPSHOT_MISSING` | 409 | Order/Dispense price snapshot ขาดหรือไม่ตรง source |
| `CHARGE_ALREADY_FINALIZED` | 409 | Visit มี Charge แล้ว |
| `WAIVER_NOT_ALLOWED` | 409 | มี Payment/waiver แล้วหรือ state ไม่อนุญาต |
| `PAYMENT_AMOUNT_MISMATCH` | 409 | amount ไม่เท่ากับ current net due |
| `PAYMENT_ALREADY_RECORDED` | 409 | Charge มี Payment หรือ financial resolution แล้ว |
| `VISIT_CLOSE_BLOCKED` | 409 | Charge/resolution/pending items ยังไม่ครบ |
| `OPD_CARD_NOT_READY` | 409 | Visit ยังไม่ `CLOSED` หรือไม่มี Closure evidence |

ใช้ `VALIDATION_FAILED`, `FORBIDDEN`, `INVALID_STATE`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT` และ `INTERNAL_ERROR` เดิมต่อ

Missing waiver reason, PromptPay reference หรือ amount ที่ไม่ใช่ integer เป็น `422 VALIDATION_FAILED` Close blocker ที่แก้ได้ส่งใน `fieldErrors` โดยใช้ key คงที่ เช่น `charge`, `collection`, `visitState` และไม่ส่ง clinical text ให้ Assistant

## 12. Audit taxonomy

เพิ่ม actions:

- `charge.finalized` — reason optional; metadata มี decision/dispense/pricing revision, line IDs และ `grossTotalBaht`
- `charge.waiver-approved` — reason required; metadata มี Charge ID, `grossTotalBaht` และ `adjustmentAmountBaht`
- `payment.cash-recorded` — reason optional; metadata มี Charge/Payment IDs และ `amountBaht`
- `payment.promptpay-confirmed` — reason optional; metadata มี Charge/Payment IDs, `amountBaht` และ manual reference
- `visit.closed` — reason optional; metadata มี Charge, Payment/waiver, Closure IDs และ transition `READY_TO_CLOSE → CLOSED`

Audit actor, role, UTC time, entity ID/revision และ metadata ต้องตรงกับ domain evidence ใน transaction เดียวกัน ห้ามสร้าง duplicate legacy action สำหรับเหตุการณ์เดียว

## 13. Thai Checkout UI

เปลี่ยน placeholder `/checkout/:visitId` เป็น `CheckoutScreen` โดยใช้ existing `PageHeader`, `PatientHeader`, `Card`, `SectionHeading`, `StatusBadge`, `ActionButton`, form controls และ `.checkout-grid`, `.invoice-lines`, `.payment-options` เดิม ไม่ redesign shell หรือ frozen Stitch files

### Layout

- ซ้าย: ค่าตรวจ, รายการยาที่ส่งมอบจริง, gross total, waiver และยอดสุทธิ
- ขวา: action เดียวที่เหมาะกับ role/state
- ยอดทุกตัวแสดงเป็นจำนวนเต็ม เช่น `350 บาท`
- header แสดง patient identity, Visit status และ revision โดยไม่มี SOAP/diagnosis

### Role/state modes

- Doctor + `AWAITING_CHARGE`: “ยืนยันยอดเพื่อรับชำระ” และ secondary full-waiver action ที่เปิด reason dialog
- Assistant + `AWAITING_CHARGE`: read-only “รอแพทย์ยืนยันยอด”
- Assistant + `AWAITING_PAYMENT`: Cash confirmation เท่านั้น
- Doctor + `AWAITING_PAYMENT`: Cash, PromptPay และ Full Waiver; PromptPay เปิดช่อง manual reference
- Assistant + `READY_TO_CLOSE`: read-only “รับชำระแล้ว รอแพทย์ปิด Visit”
- Doctor + `READY_TO_CLOSE`: ตรวจ financial chain และกด “ปิด Visit”
- `CLOSED`: finance summary read-only; Doctor เห็นลิงก์ OPD Card, Assistant ไม่เห็นและเปิด direct URL ไม่ได้

หน้าจอต้นแบบ Stitch รวม “รับชำระและปิด Visit” ไว้ปุ่มเดียว แต่ implementation ต้องแยกสองคำสั่ง เพราะ Assistant รับ Cash ได้แต่ไม่มีสิทธิ์ close

### Client safety

- ไม่มี optimistic success; สำเร็จเมื่อ server commit แล้วเท่านั้น
- mutation retry อัตโนมัติปิด แต่ deliberate retry ใช้ idempotency attempt เดิม
- reason/reference draft อยู่ต่อเมื่อ network, validation หรือ conflict error
- conflict ระงับ action และให้โหลดข้อมูลล่าสุดก่อนสร้าง attempt ใหม่
- loading, empty, denied, stale, validation และ server-unavailable states ใช้รูปแบบเดิม
- query invalidation อัปเดต Checkout, Queue, Dashboard และ Consultation/Dispensing terminal CTA หลัง commit

Queue/Overview เพิ่ม `AWAITING_PAYMENT` และ `READY_TO_CLOSE` เป็น active states พร้อม role-aware link ไป Checkout; `CLOSED` ถูกนำออกจาก active queue Dashboard เพิ่ม counters ที่มีชื่อคงที่ `awaitingPayment` และ `readyToClose`

## 14. Doctor-only OPD Card

เปลี่ยน placeholder `/visits/:visitId/opd-card` เป็น `OpdCardScreen` และรักษา `.opd-card`, `@page opd-card { size: A4 }` กับ print-hiding rules เดิม

OPD Card แสดง:

- banner “PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้รักษาจริง” ทั้ง screen และ print
- clinic name snapshot, Visit ID, วัน/เวลาปิดแบบ Asia/Bangkok และปี พ.ศ.
- patient HN/name/birth date/sex snapshots
- chief complaint และ intake vitals
- signed SOAP และ diagnoses
- signed amendments แยกเป็น addendum พร้อมผู้ลงนาม เวลา และเหตุผล
- actual Dispense medicines, quantities, unit, directions และ `NO_MEDICATION` reason ตามเส้นทาง
- Charge breakdown, Full Waiver หรือ payment method/amount
- Doctor display-name snapshot, signed/closed time และ content hashes ที่จำเป็นต่อการตรวจสอบ

ไม่แสดงข้อมูลที่ระบบไม่มีหรืออยู่นอก scope ได้แก่ clinic address/phone ที่ไม่ได้ configure, เลขใบประกอบวิชาชีพ, patient portal QR, bank QR, ลายเซ็นรับรองตามกฎหมาย หรือข้อความว่าเป็นใบเสร็จ/ใบกำกับภาษี

OPD Card เป็น projection ไม่ใช่ฐานข้อมูลอีกชุด Patient/clinic identity ใช้ closure snapshots เพื่อไม่เปลี่ยนภายหลัง Clinical Note, decision, Dispense, Charge, Payment และ Closure ใช้ immutable source rows หาก Doctor ลงนาม note amendment หลัง close การเปิด OPD ภายหลังแสดง amendment เป็น append-only addendum โดยไม่แก้ original note หรือ VisitClosure

Print อาจใช้หลายหน้า A4 เมื่อเนื้อหายาว แต่ต้องไม่ล้นขอบ, ไม่ตัด line สำคัญกลางบรรทัด และไม่มี sidebar, topbar, action controls หรือ URL chrome ภายใน document content การเก็บ signed PDF binary/versioned print artifact ไม่อยู่ใน Milestone นี้

## 15. Migrations

สร้าง migration ใหม่เท่านั้น:

### `0016_finance_pricing_snapshots`

- เพิ่ม master price fields และ checks
- seed synthetic fixtures ที่ระบุในหัวข้อ 7.2
- สร้าง Order/Dispense price snapshot tables, foreign keys, guards และ append-only triggers
- backfill snapshots สำหรับ signed Order/Dispense ที่มีอยู่โดยอ้าง deterministic synthetic master mapping
- ไม่ update/delete existing append-only Order/Dispense rows และไม่เปลี่ยน IDs/revisions

### `0017_charge_collection_ledger`

- สร้าง Charge, Charge Line, Adjustment และ Payment tables
- เพิ่ม unique/check/source-integrity triggers และ append-only triggers
- ไม่มี finance row ถูกสร้างให้ Visit เก่าโดย migration; ผู้ใช้ต้อง finalize ผ่าน API จาก current valid `AWAITING_CHARGE`

### `0018_visit_closure_integrity`

- สร้าง VisitClosure table
- เพิ่ม close source/resolution integrity triggers และ append-only triggers
- เพิ่ม Visit close guards ที่บังคับ Closure-before-`CLOSED`, timestamp equality และห้าม reopen
- เพิ่ม indexes สำหรับ checkout/close reads และ Drizzle metadata

ห้ามแก้ SQL หรือ metadata ของ migration `0000`–`0015` Populated-upgrade test ต้องยืนยัน hash/journal เดิมและ migration count/order ใหม่

## 16. Reset, restart และ upgrade

### Synthetic reset

- เพิ่ม finance/closure/snapshot tables ใน exact table allowlist
- ลบตาม dependency order: Closure → Payment/Adjustment → Charge Lines → Charge → Dispense Price Snapshots → Order Price Snapshots → existing fulfillment/clinical parents
- drop/recreate append-only triggers เฉพาะใน guarded reset transaction
- เพิ่ม audit predicates สำหรับ `charge.%` และ `payment.%`; `visit.%` ครอบคลุม close อยู่แล้ว
- ล้าง idempotency records ที่อ้าง synthetic finance commands
- รักษา Clinic/Medication masters และตรวจ exact integer-Baht fixture values/revisions หลัง reset
- foreign-key check, trigger check, zero-row check และ VACUUM ต้องผ่าน

### Restart

หลังปิด/เปิด service ต้องอ่าน identifiers, Visit status/revision, Charge/Lines, waiver/Payment, Closure, amounts, actor snapshots, UTC times และ content hashes เดิมกลับมาได้ รวม idempotent replay ของ command สำคัญ

### Populated upgrade

ทดสอบ upgrade จากฐานข้อมูล migration `0015` ที่มีอย่างน้อย:

- signed ORDER และ `NO_MEDICATION`
- Dispense หลายล็อตและ Stock Movements
- Visit ที่ `AWAITING_CHARGE`

หลัง migrate ต้องมี price snapshots ครบ, foreign keys เปิด, `PRAGMA foreign_key_check` ว่าง และ Patient/Visit/clinical/fulfillment/inventory IDs, revisions, hashes, quantities และ stock totals เดิมไม่เปลี่ยน

## 17. Testing strategy

ใช้ TDD และ SQLite file จริงแบบชั่วคราวตาม convention ปัจจุบัน

### Pure/unit tests

- integer-Baht arithmetic: one/many medication lines, multi-lot, zero-price medication, maximum boundaries และ overflow guard
- reject decimal input และพิสูจน์ว่าไม่มี rounding path
- full waiver เท่ากับ negative gross เท่านั้น
- close-gate truth table สำหรับ Charge/Payment/waiver/state ทุก combination
- Thai whole-Baht formatting

### Schema/migration tests

- one Charge/Payment/Waiver/Closure constraints
- cross-clinic/cross-Visit/cross-Dispense source rejection
- exact line arithmetic และ PromptPay/Cash method-specific checks
- update/delete ของ evidence ทุกตารางถูก block
- fresh migration และ populated `0015 → current` upgrade
- migration `0000`–`0015` immutability

### Server integration tests

- ORDER Charge ใช้ actual Dispense lines; multi-lot total ถูกต้อง
- `NO_MEDICATION` มี consultation line และไม่มี medication line
- เปลี่ยน master price หลัง Order/Handoff แล้ว quote/final Charge ใช้ snapshot เดิม
- Doctor finalize; Assistant direct finalize ถูก 403
- Assistant/Doctor Cash success; Assistant PromptPay/waiver/close/OPD ถูก 403
- PromptPay reference required และ exact amount
- mismatched amount มี zero writes
- idempotent first 201/replay 200/same-key conflict
- stale Visit/pricing revisions
- concurrent Cash/PromptPay/waiver สำเร็จไม่เกินหนึ่ง
- rollback เมื่อ line, audit, Payment, Closure หรือ Visit update ล้มเหลว
- no decision revision after Charge
- close blockers และ Doctor-only close
- post-close amendment ปรากฏเป็น OPD addendum โดย Closure เดิมไม่เปลี่ยน

### Client tests

- Checkout role/state modes ทุกสถานะ
- no clinical content in Assistant fixtures/rendering
- loading, denied, stale, conflict, validation, server unavailable
- reason/reference draft preservation
- deliberate idempotency attempt reuse และ no automatic mutation retry
- Queue/Overview links/counters และ terminal links จาก Consultation/Dispensing
- CLOSED Assistant ไม่มี OPD link; direct route denied
- A4 print CSS และ Thai date/amount formatting

### End-to-end acceptance

ใช้ Doctor และ Assistant สอง browser contexts กับฐานข้อมูลเดียว:

1. ORDER → Dispense → Doctor finalize → Assistant Cash → Doctor close → Doctor OPD
2. ORDER → Doctor finalize → Doctor PromptPay → close
3. `NO_MEDICATION` → Doctor finalize with Full Waiver → close
4. stale revision, retry, double-click และ concurrent financial resolution
5. restart ระหว่าง finalized Charge กับ Payment และระหว่าง Payment กับ close

ทุก flow ตรวจ Visit status, exact integer-Baht totals, evidence IDs, actor roles, audit metadata และ absence of duplicate rows

## 18. Acceptance criteria

Milestone 4 ถือว่าเสร็จเมื่อ:

1. เส้นทาง ORDER และ `NO_MEDICATION` จบถึง `CLOSED` ผ่าน API/UI โดยไม่แก้ฐานข้อมูลด้วยมือ
2. Charge มาจาก consultation fee กับ actual Dispense snapshots ฝั่ง server เท่านั้น
3. จำนวนเงินทุก field เป็น integer `*Baht`; decimal input ถูก reject และไม่มี rounding
4. Price Master เปลี่ยนแล้ว Order/Dispense/Charge/OPD เดิมไม่เปลี่ยน
5. Cash/PromptPay/waiver retry ไม่สร้างหลักฐานซ้ำ และ race มีผู้ชนะได้หนึ่งคำสั่ง
6. Assistant บันทึก Cash ได้ แต่ finalize, PromptPay, waiver, close และ OPD ไม่ได้แม้เรียก API ตรง
7. Full Waiver ต้องมีเหตุผลและทำให้ net due เป็นศูนย์พอดี
8. Visit ปิดได้เฉพาะ Doctor เมื่อ financial resolution ครบ
9. Closure กับ Visit `CLOSED` commit หรือ rollback พร้อมกัน
10. OPD Card เป็น Doctor-only, ภาษาไทย, A4, ไม่มี app chrome และไม่เปิดเผย clinical content ผ่าน finance API
11. reset/restart/populated-upgrade/foreign-key/append-only checks ผ่าน
12. full server/client/E2E suites, lint, typecheck, build และ `git diff --check` ผ่าน

## 19. Explicit non-goals

- สตางค์, decimal prices หรือ rounding
- partial payment, split tender, credit/AR, outstanding debt
- overpayment, underpayment หรือ cash-change calculator
- partial discount/waiver
- refund, void, charge correction UI หรือ reopen Visit
- bank/PromptPay integration, generated bank QR, webhook หรือ reconciliation
- receipt, tax invoice, accounting export หรือ ERP
- price-management UI หรือ multi-price lists
- insurance, NHSO หรือ claims
- Assistant access to OPD, SOAP, diagnosis หรือ Clinical Note
- stored PDF, legal digital certificate หรือ patient portal QR
- backup/restore drill, deployment, HTTPS/Caddy, LAN certification และ production hardening
- analytics และ revenue reporting
- ข้อมูลผู้ป่วยจริงหรือการประกาศว่าพร้อมใช้รักษาจริง

## 20. Design closure

สเปกนี้ไม่มีจุดตัดสินใจค้างอยู่:

- amount unit ถูกล็อกเป็น integer Baht
- OPD/clinical content ถูกล็อกเป็น Doctor-only
- waiver เป็น full waiver เท่านั้น
- Cash/PromptPay ต้องเท่ากับ net due
- Charge/Payment/Closure เป็น immutable append-only evidence
- OPD เป็น projection จาก evidence ไม่ใช่ฐานข้อมูลใหม่
- backup/deployment/hardening อยู่นอก Milestone 4

ขั้นถัดไปหลังผู้ใช้ทบทวนไฟล์นี้คือจัดทำ implementation plan แบบ TDD โดยยังไม่เริ่ม implementation จนกว่าแผนจะได้รับอนุมัติ
