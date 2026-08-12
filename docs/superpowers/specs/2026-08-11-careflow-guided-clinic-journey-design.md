# CareFlow Guided Clinic Journey and Intake Allergy Design

**วันที่:** 2026-08-11

**สถานะ:** อนุมัติ design ในบทสนทนาแล้ว รอผู้ใช้ตรวจเอกสารฉบับเขียนก่อนจัดทำ implementation plan

**ขอบเขต:** Local synthetic-only pre-pilot remediation; ยังไม่อนุญาตข้อมูลผู้ป่วยจริงหรือ deployment

## 1. เป้าหมาย

ทำให้ผู้ช่วยและแพทย์มองเห็นเส้นทางของ Visit ตั้งแต่รับผู้ป่วยจนปิด Visit ได้โดยไม่ต้องรู้ชื่อ state ภายในระบบ และทำให้คำถามประวัติแพ้ยาเป็นส่วนบังคับของ Intake แบบ `ไม่แพ้` หรือ `แพ้` ก่อนส่งผู้ป่วยเข้าคิว

ระบบต้องบอกให้ชัดเจนว่า:

- Visit อยู่ขั้นใด
- ขั้นใดเสร็จแล้ว ถูกข้าม กำลังทำ รอ หรือถูกบล็อก
- บทบาทใดเป็นผู้ทำงานถัดไป
- ผู้ใช้ปัจจุบันมีสิทธิ์ทำงานใด
- ถ้าทำต่อไม่ได้ สาเหตุคืออะไรและต้องไปแก้ที่ใด

งานนี้รักษา state machine, immutable evidence, audit, idempotency, optimistic concurrency, inventory safety และ role privacy ที่มีอยู่แล้ว ไม่สร้าง workflow คู่ขนานและไม่ให้ Client เดาสถานะเอง

## 2. หลักฐานจาก UAT วันที่ 10–11 สิงหาคม 2026

เดิน workflow ด้วยข้อมูลสังเคราะห์จริงผ่าน production UI สำเร็จครบเส้นทาง:

1. Assistant ทำ Intake และส่งเข้า Queue
2. Doctor บันทึก SOAP/Diagnosis และลงนาม `ORDER`
3. การเริ่มจัดยาล้มเหลวอย่างปลอดภัยเพราะ Medication มี stock พร้อมใช้ 0
4. Assistant รับยา 10 เม็ด ล็อต `UAT-FLOW-001`
5. Assistant กัน stock 3 เม็ด พิมพ์ Label ยืนยัน barcode และเตรียมยา
6. Doctor release
7. Assistant handoff; stock ลดจาก 10 เหลือ 7 และ reservation กลับเป็น 0
8. Doctor finalise Charge 115 บาท: ค่าตรวจ 100 บาท และยา 3 × 5 บาท
9. Assistant รับ Cash 115 บาท
10. Doctor ปิด Visit และเปิด Doctor-only OPD Card
11. OPD Card แสดง SOAP, Diagnosis, Medication, lot, expiry, Charge, Payment และ Closure ครบ
12. Visit ที่ปิดแล้วหายจาก active Queue

ข้อสรุปจาก UAT:

- Backend vertical slice ทำงานได้ครบ ไม่ได้ขาดการจ่ายยาหรือคิดเงิน
- ปัญหาหลักคือ workflow ถูกแบ่งหลายหน้าและหลายบทบาทโดยไม่มีตัวนำทางร่วม
- เมื่อ stock ไม่พอ ระบบแสดงข้อความปลายทาง แต่ไม่แสดงจำนวนที่ขาด งานถัดไป ผู้รับผิดชอบ หรือปุ่มแก้ไข
- Allergy model รองรับ `UNKNOWN`, `NONE_KNOWN`, `PRESENT` อยู่แล้ว แต่ Intake ไม่ถาม และ dialog ปัจจุบันแสดงชื่อ enum ภาษาอังกฤษ
- Session หมดอายุสามารถพากลับหน้าเดิมได้ แต่บริบทที่ผู้ใช้กำลังทำและสาเหตุของการหยุดยังไม่ชัด

## 3. ขอบเขต

### 3.1 อยู่ในขอบเขต

- การ์ดประวัติแพ้ยาแบบบังคับใน Assistant Intake
- คำตอบสองทาง `ไม่แพ้` หรือ `แพ้`; ไม่มี `UNKNOWN` เป็นตัวเลือกใน Intake ใหม่
- รายการสาร/ยาที่แพ้ อาการแพ้ ระดับความรุนแรง และหมายเหตุเมื่อเลือก `แพ้`
- การแสดงประวัติเดิมและการยืนยันใหม่ทุก Visit
- การบันทึก Intake, Allergy revision, Patient revision, audit และ idempotency result ใน transaction เดียว
- การแปล Allergy review UI เดิมเป็นภาษาไทยที่เข้าใจได้
- server-derived Journey projection สำหรับ Assistant และ Doctor
- Journey ribbon, next-task card และ blocker/recovery card บนหน้าที่เกี่ยวข้องกับ Visit
- stock-readiness projection แบบอ่านอย่างเดียวสำหรับ Order ที่รอเตรียมยา
- ทางกลับจาก Receive Stock ไปยัง Visit เดิม
- ข้อความ session-expired และ stale-state ที่ไม่ถูกนำเสนอเป็น validation ของแบบฟอร์ม
- Client, Server, integration, reset/restart และ two-role browser acceptance tests
- ปรับคู่มือและ checklist UAT ให้ตรงกับหน้าจอใหม่

### 3.2 ไม่อยู่ในขอบเขต

- ประกัน การแบ่งชำระ คืนเงิน ใบเสร็จภาษี หรือระบบบัญชีเต็มรูปแบบ
- Inventory forecasting, purchase orders หรือ supplier management
- Analytics เชิงบริหาร
- Appointment workflow
- เปลี่ยน Clinic, Patient, Visit, Clinical, Fulfillment หรือ Finance state machine เดิม
- เปิดสิทธิ์ Assistant ให้อ่าน SOAP, Diagnosis, Clinical Note หรือ OPD Card
- Backup/restore, HTTPS, LAN deployment, real-data readiness หรือ production deployment
- การแก้ session timeout duration; งานนี้แก้เฉพาะการอธิบายและ return path
- การเปลี่ยน frozen Stitch reference

## 4. แนวทางที่พิจารณา

### Option A — Server-guided Journey และ atomic Intake Allergy — เลือกใช้

ขยาย Intake command ให้บันทึก Allergy revision ใน transaction เดียว และสร้าง Journey read model จากสถานะและหลักฐานจริงของ Server จากนั้นให้ทุกหน้าจอใช้ projection เดียวกัน

ข้อดีคือข้อมูลไม่เกิดครึ่งเดียว, UI ไม่ drift จาก state machine, role/privacy คงเดิม และ stock blocker มีทางแก้ที่ตรวจสอบได้

### Option B — แก้เฉพาะ Client

เพิ่มปุ่มแพ้ยาและ map `visit.status` เป็นข้อความบน Client โดยไม่เปลี่ยน command หรือ read model

ไม่เลือก เพราะ Intake อาจสำเร็จแต่ Allergy ล้มเหลว, logic จะซ้ำหลายหน้า และ Client อาจแสดง action ที่ Server ไม่อนุญาตแล้ว

### Option C — Cross-role wizard เดียว

รวม Intake, Consultation, Dispensing และ Checkout เป็น wizard เดียว

ไม่เลือก เพราะขัดกับ role separation, ทำให้ session handoff ไม่ชัด และเป็นการรื้อ composition ที่ผ่าน UAT แล้วโดยไม่จำเป็น

## 5. หลักการออกแบบ

1. **Server เป็นแหล่งความจริง:** Journey และ next task มาจาก committed state, evidence, permissions และ stock-readiness ของ Server
2. **หนึ่ง command หนึ่งผลลัพธ์:** Intake และ Allergy review สำเร็จหรือ rollback พร้อมกัน
3. **ไม่สร้าง truth ชุดใหม่:** ใช้ `patient_allergy_revisions` และ `patient_allergy_items` เดิม
4. **ไม่ใช้สีอย่างเดียว:** ทุกสถานะมีข้อความและสัญลักษณ์สำหรับ accessibility
5. **หนึ่งหน้าหนึ่งงาน:** Journey นำทาง แต่ไม่ย้ายฟอร์มของบทบาทหนึ่งเข้าไปใน workspace ของอีกบทบาท
6. **Fail closed:** ปุ่มมาจาก Server authorization; stale/forged action ยังถูกปฏิเสธก่อนเขียนข้อมูล
7. **Advisory read, transactional command:** stock-readiness ช่วยอธิบาย แต่คำสั่ง reserve ต้องตรวจซ้ำใน immediate transaction
8. **Synthetic-only:** Banner และข้อห้ามข้อมูลจริงยังแสดงทุกหน้าตามเดิม

## 6. Intake Allergy

### 6.1 พฤติกรรมผู้ใช้

หลังเลือกหรือสร้าง Patient แล้ว Intake แสดงการ์ด `ประวัติแพ้ยา` ก่อนปุ่มส่งเข้าคิว:

- แสดง Allergy assessment ล่าสุดแบบอ่านอย่างเดียว ถ้ามี
- ถามว่า `วันนี้ผู้ป่วยยืนยันว่าแพ้ยาหรือไม่?`
- ไม่มีคำตอบที่เลือกไว้ล่วงหน้า ผู้ช่วยต้องกด `ไม่แพ้` หรือ `แพ้` ใน Visit นี้
- ปุ่มใช้ semantics แบบ radio group และใช้งานด้วย keyboard ได้
- ถ้าเลือก `ไม่แพ้` แสดงสรุป `ยืนยันว่าไม่มีประวัติแพ้ยาที่ทราบในครั้งนี้`
- ถ้าเลือก `แพ้` เปิด editor อย่างน้อยหนึ่งรายการ
- แต่ละรายการบังคับ `ชื่อยา/สารที่แพ้` และ `อาการแพ้`
- `ระดับความรุนแรง` เลือก `ยังไม่ทราบ`, `เล็กน้อย`, `ปานกลาง`, `รุนแรง`; ค่าเริ่มต้นคือ `ยังไม่ทราบ`
- `หมายเหตุ` ไม่บังคับ
- เพิ่มได้สูงสุด 20 รายการตาม contract เดิม
- ถ้าข้อมูลล่าสุดเป็น `PRESENT` และเลือก `แพ้` ให้ prefill รายการเดิมเพื่อทบทวน แต่ยังต้องกดคำตอบใน Visit ปัจจุบัน
- ถ้าคำตอบใหม่เปลี่ยนจาก `NONE_KNOWN` เป็น `PRESENT` หรือจาก `PRESENT` เป็น `NONE_KNOWN` ให้แสดงคำเตือนและบังคับ `เหตุผลที่ข้อมูลเปลี่ยน`
- ถ้าข้อมูลเดิมเป็น `UNKNOWN` ไม่ต้องกรอกเหตุผลการเปลี่ยน
- เมื่อ validation ล้มเหลว ให้ focus คำถามหรือช่องแรกที่ผิดและรักษาค่าร่างไว้

### 6.2 Canonical mapping

Client ใช้คำตอบง่าย แต่ Server map เข้าสู่โมเดลเดิม:

| คำตอบ Intake | Allergy state | Items |
|---|---|---|
| `NO` | `NONE_KNOWN` | ต้องว่าง |
| `YES` | `PRESENT` | 1–20 รายการที่ผ่าน schema |

`UNKNOWN` ยังคงเป็น canonical state สำหรับ Patient ที่ยังไม่เคยทบทวนและข้อมูลเก่า แต่ไม่เป็นตัวเลือกของ Intake ใหม่

Server กำหนด provenance สำหรับ Intake เอง:

- `sourceText`: `ผู้ป่วยตอบระหว่าง Intake`
- `reason`: เหตุผลการเปลี่ยนที่ผู้ใช้กรอก หรือ `ทบทวนก่อนส่งเข้าคิว`
- `reviewedBy`: Assistant actor
- `reviewedAt`: เวลาเดียวกับ Intake transaction

Client ห้ามส่ง `sourceText`, `reviewedBy`, `reviewedAt` หรือ canonical state โดยตรงจากฟอร์ม Intake

### 6.3 Contract

เพิ่ม discriminated union ใน `SubmitIntakeBody.payload`:

```ts
type IntakeAllergyAnswer =
  | {
      answer: "NO";
      items: [];
      changeReason: string | null;
    }
  | {
      answer: "YES";
      items: Array<{
        substance: string;
        reaction: string;
        severity: "UNKNOWN" | "MILD" | "MODERATE" | "SEVERE";
        note: string | null;
      }>;
      changeReason: string | null;
    };
```

กฎเพิ่มเติมของ Server:

- unknown key และ prototype-pollution key ถูกปฏิเสธตาม contract เดิม
- `changeReason` ต้องมี 1–500 ตัวอักษรถ้า canonical state ใหม่ต่างจาก latest state ที่ไม่ใช่ `UNKNOWN`
- `changeReason` เป็น `null` ได้ถ้า latest state เป็น `UNKNOWN` หรือ state ไม่เปลี่ยน
- Server ตรวจ state ล่าสุดใน transaction เดียวกับ expected Patient revision; Client ไม่เป็นผู้ตัดสินว่าต้องมีเหตุผลหรือไม่
- เปลี่ยน idempotency operation เป็น `visit.submit-intake.v2` เพราะ request contract และ response evidence เปลี่ยน

### 6.4 Transaction และ audit

`POST /api/visits/intake` ยังเป็น authenticated Assistant command เดิม แต่ work function ทำตามลำดับใน audited immediate transaction เดียว:

1. ตรวจ permission และ strict body ก่อนเปิดงานเขียน
2. ตรวจ Patient revision และ active Visit
3. สร้าง Visit `WAITING` revision 1
4. สร้าง Intake Observation
5. append Allergy revision/items และ increment Patient revision หนึ่งครั้ง
6. append `allergy.updated` พร้อม `visitId`, previous/new state และ item count
7. append `visit.intake-submitted` พร้อม Allergy revision ID/state
8. สร้าง Queue response จาก row ที่ commit ชุดเดียวกัน
9. เก็บ exact idempotent envelope

ความล้มเหลวที่ขั้นใดต้องเหลือ Visit, Observation, Allergy, Patient revision, audit และ idempotency record เท่ากับก่อนคำสั่งทุก byte

ถ้ามี active Visit อยู่แล้ว ต้องคืน conflict โดยไม่ append Allergy revision ใหม่

### 6.5 Existing Visit และ review dialog

- Queue และ Consultation ยังมี `Review Allergy` สำหรับแก้ไขภายหลัง
- เปลี่ยนปุ่ม raw enum เป็นข้อความไทย:
  - `UNKNOWN` → `ยังไม่ทราบ`
  - `NONE_KNOWN` → `ยืนยันว่าไม่แพ้`
  - `PRESENT` → `มีประวัติแพ้ยา`
- Journey แสดง blocker `ยังไม่ได้ถามประวัติแพ้ยา` สำหรับ Visit เก่าที่ latest state เป็น `UNKNOWN`
- Doctor เริ่ม Consultation ได้เพื่ออ่านข้อมูลและบันทึกร่าง แต่ `FINALIZE_CONSULTATION` ต้องถูก Server ปฏิเสธจน Allergy state เป็น `NONE_KNOWN` หรือ `PRESENT`
- การทบทวนหลังมี signed Order ใช้ invalidation/release safety เดิม ไม่เปลี่ยนกฎ

### 6.6 Persistence และ migration boundary

- งานนี้ใช้ตาราง Allergy, Patient, Visit, Intake, Audit และ Idempotency เดิมทั้งหมด
- ไม่มี schema migration ใหม่สำหรับ Intake Allergy หรือ Journey read model
- Migration `0000`–`0022` และ snapshot เดิมต้องคง byte-identical
- Synthetic reset ใช้ลำดับลบและ trigger restoration เดิม แต่เพิ่ม assertion ว่า Intake-created Allergy revisions ถูกล้างครบและ reset รอบสองยัง idempotent
- Restart ต้องอ่าน Allergy revision และ Journey จาก committed evidence เดิมโดยไม่ backfill หรือสร้างข้อมูลใหม่

## 7. Visit Journey Projection

### 7.1 ขอบเขตของ read model

สร้าง application workflow ที่ `server/workflows/journey.ts` โดยมีหน้าที่ดังนี้:

- อ่านผ่าน public interfaces ของ Visit, Patient, Clinical, Fulfillment, Inventory, Finance และ Closure เท่านั้น
- ไม่เขียนข้อมูลและไม่เปิด transaction
- รับ Actor เพื่อคำนวณ `allowedActions` และข้อความ role-aware
- ไม่คืน SOAP, Diagnosis, Note text, Patient phone, content hash หรือ evidence ที่ Assistant ไม่มีสิทธิ์อ่าน
- ใช้เวลา `Asia/Bangkok` เฉพาะการแสดงผล; canonical timestamps ยังเป็น UTC ISO

เพิ่ม endpoint:

```text
GET /api/visits/:visitId/journey
```

Assistant และ Doctor ที่มี `visit:read-queue` อ่านได้ แต่ projection ต่างกันตาม Actor

Queue item เพิ่ม `journeySummary` จาก builder เดียวกันเพื่อไม่ให้ Queue Client map raw status เอง ส่วนหน้าที่มี Visit ID ใช้ endpoint เต็มร่วมกัน

### 7.2 Journey DTO

```ts
type JourneyStepCode =
  | "INTAKE"
  | "SCREENING"
  | "CONSULTATION"
  | "MEDICATION_DECISION"
  | "PREPARATION"
  | "HANDOFF"
  | "PAYMENT"
  | "CLOSURE";

type JourneyStepState =
  | "COMPLETE"
  | "CURRENT"
  | "UPCOMING"
  | "SKIPPED"
  | "BLOCKED";

type VisitJourneyDto = {
  visit: { id: string; status: VisitStatus; revision: number };
  steps: Array<{
    code: JourneyStepCode;
    labelTh: string;
    state: JourneyStepState;
  }>;
  nextTask: null | {
    action: JourneyAction;
    labelTh: string;
    primaryRole: "assistant" | "doctor";
    permittedRoles: Array<"assistant" | "doctor">;
    availability: "AVAILABLE" | "WAITING_FOR_ROLE" | "BLOCKED";
  };
  blockers: JourneyBlocker[];
  allowedActions: JourneyAction[];
  refreshedAt: string;
};
```

`JourneyAction` เป็น semantic action ไม่ใช่ URL เช่น `START_CONSULTATION`, `REVIEW_ALLERGY`, `OPEN_CONSULTATION`, `START_PREPARATION`, `PRINT_LABEL`, `CONFIRM_ALLOCATION`, `COMPLETE_PREPARATION`, `RELEASE_MEDICATION`, `HANDOFF_MEDICATION`, `FINALIZE_CHARGE`, `RECORD_CASH`, `RECORD_PROMPTPAY`, `APPROVE_FULL_WAIVER`, `CLOSE_VISIT`, `OPEN_OPD_CARD`, `RECEIVE_STOCK`

Client มี mapping กลางจาก semantic action ไป route; ห้ามแต่ละ Screen map status เอง

### 7.3 Step mapping

| Domain state/evidence | Current Journey step | Primary next role/action |
|---|---|---|
| Intake form ยังไม่ submit | `INTAKE`/`SCREENING` | Assistant บันทึก Intake + Allergy |
| `WAITING` | `CONSULTATION` | Doctor `START_CONSULTATION` |
| `CONSULTING` | `CONSULTATION`/`MEDICATION_DECISION` | Doctor บันทึกและลงนาม |
| `AWAITING_ORDER_REVISION` | `MEDICATION_DECISION` | Doctor ทบทวน Order |
| `AWAITING_PREPARATION` | `PREPARATION` | Assistant เป็น primary; Doctor ทำแทนได้ตาม permission เดิม |
| `PREPARING` | `PREPARATION` | ผู้เตรียมพิมพ์/ยืนยัน/เสร็จสิ้น |
| `AWAITING_RELEASE` | `PREPARATION` | Doctor release |
| `AWAITING_HANDOFF` | `HANDOFF` | Assistant เป็น primary; permitted roles มาจาก Server |
| `AWAITING_CHARGE` | `PAYMENT` | Doctor finalise Charge |
| `AWAITING_PAYMENT` | `PAYMENT` | Assistant Cash เป็น primary; Doctor alternatives ตาม permission |
| `READY_TO_CLOSE` | `CLOSURE` | Doctor close |
| `CLOSED` + Closure | ทุกขั้น complete/skipped | Doctor `OPEN_OPD_CARD`; Assistant ไม่มี clinical action |

กรณี `NO_MEDICATION`:

- `PREPARATION` และ `HANDOFF` เป็น `SKIPPED`
- ไป `PAYMENT` โดยตรง

กรณี full waiver:

- งาน collection เป็น `SKIPPED`
- ไป `CLOSURE` โดยตรง

Step state ต้องสอดคล้องกับ committed evidence ไม่ใช่ดู `visit.status` อย่างเดียว เช่น `CLOSED` ต้องมี Closure ที่ถูกต้อง

## 8. Stock Readiness และ Recovery

### 8.1 Read-only readiness

Inventory public service เพิ่ม read operation สำหรับ signed `ORDER` ที่ยังไม่ reserve:

```ts
type ReservationReadiness = {
  ready: boolean;
  lines: Array<{
    medicationId: string;
    displayNameSnapshot: string;
    required: number;
    available: number;
    shortfall: number;
    unitSnapshot: string;
  }>;
};
```

- คำนวณ available จาก movement ledger ลบ active reservation ตามกฎเดิม
- รวม demand ของ Order items ที่เป็น Medication เดียวกันก่อนเปรียบเทียบ
- ไม่นับ lot ที่ quarantine หรือหมดอายุตามวันที่คลินิก
- ไม่มีการสร้าง allocation, reservation, audit หรือ revision
- เป็น advisory เท่านั้น; reserve command ตรวจ FEFO, revision และ sellability ซ้ำใน immediate transaction

### 8.2 Blocker UX

ถ้า `ready=false` Journey แสดง `PREPARATION` เป็น `BLOCKED` และคืน blocker ต่อ Medication:

```text
จัดยายังไม่ได้
[ชื่อยา] ต้องการ 3 เม็ด · พร้อมใช้ 0 เม็ด · ขาด 3 เม็ด
งานถัดไป: ผู้ช่วยรับยาเข้าคลัง
```

- Actor ที่มี `inventory:receive` เห็น `RECEIVE_STOCK`
- Actor ที่ไม่มีสิทธิ์เห็นข้อความ `รอผู้ช่วยรับยาเข้าคลัง` โดยไม่มีปุ่มปลอม
- Receive Stock route รับ `medicationId` และ `returnTo` ที่ Client สร้างจาก semantic action
- เมื่อรับยาสำเร็จ ให้กลับ Visit เดิมและ refetch Journey
- Draft รับยายังคงใช้ idempotency attempt เดิมเมื่อ retry หลัง network/server error
- ถ้า stock เปลี่ยนหลัง readiness และ reserve คืน `RESERVATION_NOT_SELLABLE`, Client ต้อง refetch Journey แล้วแสดง blocker ล่าสุด; ห้าม retry อัตโนมัติด้วยคำสั่งใหม่

## 9. Client Components

เพิ่ม component ขอบเขตชัดเจน:

### `IntakeAllergyCard`

- รับ latest Allergy assessment, answer draft, item draft และ field errors
- ไม่มี network call ของตัวเอง
- แสดง radio semantics, conditional item editor, prior-state warning และ change reason

### `VisitJourneyRibbon`

- รับ `VisitJourneyDto.steps`
- render เป็น `<nav aria-label="เส้นทางผู้ป่วย">`
- ใช้ `aria-current="step"` กับขั้นปัจจุบัน
- แสดง icon + text; ไม่ใช้สีอย่างเดียว
- Desktop แสดง 8 ขั้นเรียงต่อกัน
- Mobile แสดงขั้นปัจจุบันและก่อน/ถัดไปโดยยังเข้าถึงรายการเต็มได้
- ไม่เป็นผู้ตัดสิน allowed action

### `JourneyNextTaskCard`

- แสดงงานถัดไป primary role และ CTA จาก `nextTask`/`allowedActions`
- ถ้าบทบาทปัจจุบันทำไม่ได้ แสดงข้อความรออีกบทบาทโดยไม่แสดง disabled mutation button
- ถ้า blocked ส่งรายละเอียดให้ `JourneyBlockerCard`

### `JourneyBlockerCard`

- แสดงสาเหตุ จำนวน และ recovery action
- รองรับ Allergy unknown, stock shortage, stale state และ session-return message
- error summary ใช้ `role="alert"`; focus ไป summary หลัง command ล้มเหลว

ใช้ component เหล่านี้บน Queue cards, Consultation, Dispensing, Checkout และ OPD header โดยไม่รื้อ component/CSS composition เดิม

## 10. Role และ Privacy

- Server คำนวณ `allowedActions` จาก Actor ทุกครั้ง
- Assistant ไม่ได้รับ Clinical Note, SOAP, Diagnosis, decision content hash หรือ OPD data ผ่าน Journey endpoint
- Assistant Journey ใช้ข้อความกว้าง เช่น `รอแพทย์ตรวจและสั่งการรักษา`
- Doctor สามารถเห็นรายละเอียดที่มีอยู่แล้วเฉพาะผ่าน Doctor endpoint; Journey ไม่เป็นทางลัดเพื่อขยายสิทธิ์
- Direct API call ที่ role ไม่อนุญาตต้องคืน 403 ก่อน parsing command body หรืออ่าน clinical evidence
- CTA บน Client เป็นการอำนวยความสะดวก ไม่ใช่ security boundary
- Allergy items แสดงได้กับ Assistant เพราะ permission เดิมอนุญาตให้ทบทวน Allergy; ขอบเขตนี้ไม่เปลี่ยนสิทธิ์อื่น

## 11. Concurrency, Idempotency และ Error Handling

- Intake v2 ใช้ expected Patient revision และ exact response replay
- การกดซ้ำด้วย key เดิมคืน response เดิมโดยไม่ append Allergy/Visit/audit ซ้ำ
- key อื่นสำหรับ active Visit คืน stable conflict และไม่มี write
- ถ้า Patient/Allergy เปลี่ยนจากอีก session ให้คืน revision conflict; Client refetch Patient/Allergy, รักษา Intake/vitals draft และบังคับเลือก Allergy answer ใหม่ถ้าฐานข้อมูลเปลี่ยน
- ถ้า session หมดอายุ ให้ login ด้วย `returnTo` เดิมและแสดง `เซสชันหมดอายุ งานยังไม่ได้ถูกบันทึก` หลังกลับมา ห้ามแปลง 401 เป็น validation `กรอกข้อมูลไม่ครบ`
- ไม่เก็บ SOAP, Diagnosis หรือข้อมูล clinical ใหม่ใน local storage เพื่อแก้ session expiry
- Server error 500 แสดง recovery/retry เฉพาะ command attempt เดิม; ไม่สร้าง idempotency key ใหม่โดยอัตโนมัติ
- Journey read failure ไม่ซ่อนฟอร์มหลัก แต่แสดง stale banner และปิด mutation CTA จนโหลด authority ล่าสุด

## 12. Testing

### 12.1 Shared contract tests

- `NO`/`YES` discriminated union
- `NO` rejects items; `YES` requires 1–20 valid items
- Unicode length boundaries, severity enum, strict unknown keys และ prototype keys
- Journey DTO strict parsing, step/action enums และ privacy-safe fields

### 12.2 Server integration tests

- New Patient `UNKNOWN` → Intake `NO` → `NONE_KNOWN`
- New Patient `UNKNOWN` → Intake `YES` พร้อมหลาย items → `PRESENT`
- Existing `PRESENT` → `NO` ต้องมี change reason
- Existing `NONE_KNOWN` → `YES` ต้องมี change reason
- Same-state review append revision ใหม่พร้อม reviewed timestamp
- Intake, Observation, Allergy, Patient revision, two audits และ idempotency commit พร้อมกัน
- injected failure หลังทุก write stage rollback byte-for-byte
- active Visit conflict ไม่ append Allergy
- same-key replay exact; different-key duplicate conflict
- Patient revision race มีผู้ชนะหนึ่งคำสั่ง
- Finalise Consultation ถูกปฏิเสธเมื่อ Allergy ยัง `UNKNOWN` โดยไม่มี Note/Decision/audit/idempotency write
- Journey truth table ครบทุก Visit state, `NO_MEDICATION`, full waiver และ `CLOSED`
- Assistant/Doctor projection และ direct-route privacy
- stock readiness: zero stock, multi-lot, quarantine, expiry, active reservation, duplicate Medication Order items
- readiness race: read ready แต่ reserve ล้มเหลวอย่างปลอดภัยและ stock ไม่ติดลบ
- reset/restart รักษา Allergy revision, Journey truth และ blockers

### 12.3 Client tests

- Intake answer ไม่มี default และ submit ถูกปิดจนตอบ
- conditional fields, change warning/reason, add/remove items และ focus first error
- raw enum ไม่ปรากฏใน UI
- Journey ribbon semantics, `aria-current`, text state และ mobile rendering
- role-specific next task และไม่มี forbidden CTA แม้ fixture ส่ง stale local state
- stock blocker แสดง required/available/shortfall และ return path
- 401, 409, 500 รักษา draft ตามกฎและไม่สร้าง duplicate command
- stale Journey fail closed จน refetch สำเร็จ

### 12.4 Browser/E2E acceptance

ใช้สอง BrowserContexts ที่แยก session บน synthetic temporary database:

1. Assistant Intake ตอบ Allergy `NO`
2. Doctor ตรวจ ลงนาม `ORDER`
3. Journey แสดง stock blocker พร้อมจำนวนขาด
4. Assistant รับ stock ผ่าน CTA และกลับ Visit เดิม
5. Assistant prepare/print/barcode/complete
6. Doctor release
7. Assistant handoff; ตรวจ movement และ stock
8. Doctor finalise Charge
9. Assistant Cash
10. Doctor close และเปิด OPD
11. Assistant direct OPD/clinical access ถูก 403
12. Restart แล้ว Journey, Allergy, stock, Charge, Payment และ Closure เท่าเดิม

เพิ่มเส้นทาง `YES` พร้อม Allergy item และเส้นทาง `NO_MEDICATION` ที่ข้าม dispensing อย่างชัดเจน

## 13. UAT Guide Update

คู่มือ UAT ต้อง:

- เพิ่มคำถามแพ้ยาในทุก Scenario และใช้ชื่อปุ่มจริง
- อธิบาย Journey state ที่ควรเห็นหลังแต่ละ action
- ใช้คำว่า `เปิดฉลากยา` และระบุให้กด Enter หลังสแกน barcode
- เตรียม stock หรือบอก recovery path ก่อนเริ่ม Order scenario
- วาง role checks ใน state ที่ action นั้นยังมีอยู่ ไม่ตรวจหลัง Visit ปิดทั้งหมด
- ให้หยุด UAT ทั้งชุดเมื่อพบ HTTP 500, clinical data รั่วข้าม role, stock ติดลบ, ยอดเงินผิด, Closure ไม่ถูกต้อง หรือ evidence หายหลัง restart
- ไม่บันทึกรหัสผ่านหรือข้อมูลผู้ป่วยจริง

## 14. Acceptance Criteria

งานนี้ผ่านเมื่อ:

- Assistant ส่ง Intake ใหม่ไม่ได้จนตอบคำถามแพ้ยา
- Intake และ Allergy เป็น atomic audited idempotent command
- ไม่มี raw `UNKNOWN`, `NONE_KNOWN`, `PRESENT` ใน user-facing Allergy controls
- ทุกหน้า Visit ที่อยู่ในขอบเขตแสดง Journey จาก Server projection เดียวกัน
- ทุก state มีงานถัดไปหรือเหตุผลที่ไม่มีงานถัดไปอย่างชัดเจน
- stock shortage แสดง Medication, required, available, shortfall, primary role และ recovery CTA
- หลังรับ stock ผู้ใช้กลับ Visit เดิมและจัดยาต่อได้
- `ORDER`, `NO_MEDICATION`, Cash, PromptPay/full waiver และ Closure mapping ไม่ขัด state machine เดิม
- Assistant ไม่ได้รับ clinical text/hash/OPD data ผ่าน Journey
- race/retry/restart ไม่สร้าง partial evidence, duplicate evidence, negative stock หรือจำนวนเงินผิด
- ชุดทดสอบ Client, Server, E2E, lint, typecheck, build, migration identity และ diff check ผ่าน
- UAT guide/checklist สอดคล้องกับหน้าจอ production build ใหม่

## 15. Deliverables

- Shared Intake Allergy และ Journey contracts
- Atomic Intake + Allergy server workflow และ audit metadata
- Read-only Journey/stock-readiness service และ route
- Intake Allergy card และ localized review dialog
- Journey ribbon, next-task และ blocker components บนหน้าหลักของ Visit
- Receive Stock return path
- Client/Server/E2E regression coverage
- UAT guide และ checklist ฉบับปรับปรุง
- Implementation report และ final review ก่อน merge/push

## 16. ข้อจำกัดหลังงานนี้

แม้ workflow จะทดลองได้ชัดขึ้น ระบบยังเป็น Local synthetic-only Pilot การนำไปใช้จริงยังต้องมีงานแยกสำหรับ deployment hardening, backup/restore rehearsal, access provisioning/rotation, operational monitoring, real-data/privacy review, clinical governance และการอนุมัติ Pilot scope อย่างเป็นทางการ
