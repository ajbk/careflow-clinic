# CareFlow Local Pilot — Product Requirements Document (PRD)

**สถานะ:** อนุมัติให้จัดทำ implementation plan เมื่อ 3 สิงหาคม 2026

**วันที่:** 3 สิงหาคม 2026

**ขอบเขต:** Local Pilot ด้วยข้อมูลสังเคราะห์เท่านั้น; Demo ปัจจุบันเป็น visual baseline

## 1. เอกสารนี้มีไว้เพื่ออะไร

เอกสารนี้รวมความต้องการที่กระจายและขัดกันอยู่ในเอกสารเดิมให้เหลือเส้นชัยเดียวสำหรับ CareFlow Local Pilot ก่อนเริ่มงาน full-stack

ลำดับอำนาจของเอกสารตั้งแต่นี้คือ:

1. เอกสารนี้เป็นหลักสำหรับ **ขอบเขตผลิตภัณฑ์และเกณฑ์สำเร็จของ Local Pilot**
2. `stitch_careflow_clinic_management_system/rural_health_commons/DESIGN.md` เป็นหลักสำหรับ **หน้าตา สี ตัวอักษร ระยะห่าง และหลัก “หนึ่งหน้าจอ หนึ่งงาน”**
3. `/Users/ajbk/Downloads/careflow-implementation-plan.md` ใช้เป็นข้อมูลประกอบด้านสถาปัตยกรรมเท่านั้น หลัง PRD นี้ได้รับอนุมัติจะสร้าง implementation plan ฉบับใหม่ไว้ใน repository และฉบับใหม่นั้นจะแทนแผนใน Downloads
4. PRD และ blueprint รุ่นก่อนเป็นแหล่งอ้างอิง เฉพาะส่วนที่ไม่ขัดกับเอกสารนี้

เอกสารนี้ยังไม่อนุญาตให้นำระบบไปใช้เป็นเวชระเบียนจริง หรือเก็บข้อมูลผู้ป่วยจริง การเปิดใช้จริงต้องผ่านการทบทวนด้านความปลอดภัย ความเป็นส่วนตัว การปฏิบัติงาน และการกู้คืนข้อมูลแยกต่างหาก

## 2. Demo ที่มีแล้ว กับ Pilot ที่จะสร้าง

| ระยะ | สถานะและหน้าที่ |
|---|---|
| **Interactive Demo** | มีแล้ว: UI 14 routes, responsive/print styles และข้อมูลจำลองใน `localStorage` ใช้ยืนยันหน้าตาและสาธิต happy path บนเครื่องเดียว ไม่ใช่ระบบหลายผู้ใช้ |
| **Local Pilot** | เป้าหมายของ PRD นี้: 10 หน้าจอใน vertical slice ใช้ฐานข้อมูล/API กลางบน Clinic Host, บัญชีจริงสองบทบาท, audit, transaction และ backup แต่ยังใช้ข้อมูลสังเคราะห์เท่านั้น |
| **Production readiness** | ไม่อยู่ในรอบนี้: การเก็บข้อมูลผู้ป่วยจริง การกำกับดูแล ความปลอดภัยเชิงปฏิบัติการ hardware validation และการอนุมัติให้ใช้รักษาจริง |

Acceptance criteria ในเอกสารนี้เป็นเส้นชัยของ **Local Pilot** ไม่ใช่เงื่อนไขเพิ่มให้ Interactive Demo เดิม

### สรุปผลิตภัณฑ์ในหนึ่งประโยค

CareFlow คือระบบ local-first ภาษาไทยสำหรับคลินิกขนาดเล็ก ที่ช่วยให้แพทย์หนึ่งคนและผู้ช่วยหนึ่งคนพาผู้ป่วยหนึ่ง Visit ตั้งแต่รับเข้า ตรวจ สั่งยา จัดยา ตรวจ final ส่งมอบ ตัดสต็อก รับชำระเงิน และปิด Visit ได้ครบถ้วนจากข้อมูลชุดเดียวกัน

## 3. ปัญหาที่ต้องแก้ใน Pilot

ปัจจุบัน UI สาธิตขั้นตอนต่าง ๆ ได้แล้ว แต่ข้อมูลอยู่ใน `localStorage` ของแต่ละเบราว์เซอร์ จึงยังไม่ใช่ระบบที่คนสองคนใช้ร่วมกันได้จริง และยังไม่มีฐานข้อมูล/API ที่บังคับกฎสำคัญ เช่น การห้ามจ่ายยาซ้ำ การตัดสต็อกเพียงครั้งเดียว หรือการห้ามแก้บันทึกที่ลงนามแล้ว

Pilot ต้องพิสูจน์ว่า:

- ผู้ช่วยและแพทย์เห็นข้อมูลและสถานะเดียวกันจากคนละเครื่อง
- เส้นทางผู้ป่วยที่ “มียา” และ “ไม่มียา” จบได้จริง
- ระบบไม่สร้างผลซ้ำเมื่อกดซ้ำ รีเฟรช หรือส่งคำขอซ้ำ
- ข้อมูลที่บันทึกแล้วอยู่ครบหลังปิดเบราว์เซอร์หรือ restart เครื่องแม่ข่าย
- กฎด้านบทบาท ลำดับงาน เวชระเบียน ยา สต็อก และเงิน ถูกบังคับที่ API/ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่มใน UI

## 4. ผู้ใช้เป้าหมาย

### แพทย์ (Doctor)

- ดูข้อมูลผู้ป่วยที่จำเป็นต่อการตรวจ
- บันทึกและลงนาม Clinical Note
- ลงนาม Medication Order หรือระบุ `NO_MEDICATION`
- ตรวจ final และ release ยาก่อนส่งมอบ
- ยืนยันยอด Charge และปิด Visit
- ทำขั้นตอนปฏิบัติการของผู้ช่วยได้เมื่อทำงานคนเดียว โดยระบบยังบันทึกว่า Doctor เป็นผู้กระทำจริงทุกขั้น

### ผู้ช่วย (Assistant)

- ค้นหาหรือสร้างผู้ป่วย เปิด Visit และบันทึก Intake/Vitals
- ดูและจัดการคิว
- จัดยา ตรวจสอบยา พิมพ์ฉลาก และยืนยันการส่งมอบหลังแพทย์ release แล้ว
- รับยาเข้าคลัง
- บันทึกรับเงินสด
- ไม่มีสิทธิ์ลงนามบันทึก สั่งยา release ยา ยืนยัน QR หรือปิด Visit แม้เรียก API โดยตรง

ใน Pilot มีหนึ่งคลินิก หนึ่งแพทย์ และหนึ่งผู้ช่วยเป็นกรณีหลัก ยังไม่มีระบบหลายสาขาหรือผู้ดูแลหลายระดับ

## 5. เส้นทางหลักที่ต้องทำให้จบ

### 5.1 เส้นทางมียา

1. ผู้ช่วยค้นหาผู้ป่วยเดิมด้วย HN/ชื่อ/โทรศัพท์ หรือสร้างผู้ป่วยใหม่
2. ผู้ช่วยเปิด Visit บันทึกอาการสำคัญ สัญญาณชีพ และส่งเข้าคิว
3. แพทย์เริ่มตรวจ เห็น allergy, vitals และประวัติล่าสุดที่จำเป็น
4. แพทย์บันทึก SOAP/diagnosis และกด finalize consultation ซึ่งลงนาม Clinical Note พร้อม Medication Order หรือ `NO_MEDICATION` ใน transaction เดียว
5. ระบบสร้าง Pick List และ Label version ที่ผูกกับ Order version เดียวกัน
6. ผู้ช่วยจัดยาตามรายการและล็อตที่ระบบจัดสรรแบบหมดอายุก่อนออกก่อน (FEFO)
7. ผู้ช่วย scan barcode หรือยืนยันด้วยมือ หากยืนยันด้วยมือต้องระบุเหตุผลและมี audit; barcode ที่ไม่ตรงต้องถูก block
8. แพทย์ตรวจ final แล้ว release หรือ reject กลับไปให้จัดใหม่
9. หลังส่งยาถึงผู้ป่วย ผู้ช่วยยืนยัน handoff เพียงครั้งเดียว
10. ระบบสร้าง Dispense และ Stock Movement รายล็อตใน transaction เดียวกัน
11. ระบบสร้าง Charge จากบริการและยาที่ส่งมอบจริง แพทย์ตรวจและ finalize ยอด
12. ผู้ช่วยบันทึกเงินสด หรือแพทย์ยืนยัน PromptPay/QR แบบ manual
13. เมื่อยอดครบ แพทย์ปิด Visit และพิมพ์ OPD Card ได้

### 5.2 เส้นทางไม่มียา

1. ทำ Intake และ Consultation เหมือนเส้นทางปกติ
2. แพทย์ลงนาม Clinical Note และระบุ `NO_MEDICATION` อย่างชัดเจน
3. ระบบข้าม Pick List, Label, preparation, release และ dispense
4. ระบบสร้าง Charge เฉพาะบริการ แพทย์ finalize ยอด
5. รับชำระหรือบันทึก `COLLECTION_NOT_REQUIRED` เมื่อยอดสุทธิเป็นศูนย์และมีเหตุผล
6. แพทย์ปิด Visit ได้เมื่อเงื่อนไขการเงินครบ

`NO_MEDICATION` ต้องเป็นการตัดสินใจที่บันทึกไว้ ไม่ใช่การปล่อยช่องรายการยาว่างโดยไม่รู้สาเหตุ

### 5.3 State machine กลางของ Visit

ตารางนี้เป็นสัญญากลางของ UI, API, database และ tests คำสั่งทุกคำสั่งต้องมี idempotency key และ expected revision ของ record ที่แก้ เช่น Visit, Patient, Note หรือ Order

| สถานะก่อน | คำสั่ง | ผู้มีสิทธิ์ | เงื่อนไขสำคัญ | สถานะหลัง/ผลข้างเคียง |
|---|---|---|---|---|
| ไม่มี Visit | Submit Intake | Assistant หรือ Doctor | patient, complaint และข้อมูลบังคับถูกต้อง | `WAITING`; สร้าง Visit เดียวและ Audit Event |
| `WAITING` | Start Consultation | Doctor | Visit revision ตรง | `CONSULTING` |
| `CONSULTING` | Finalize Consultation | Doctor | Clinical Note ถูกต้องและมี signed Order หรือ signed `NO_MEDICATION` เพียงอย่างเดียว | มียา → `AWAITING_PREPARATION`; ไม่มียา → `AWAITING_CHARGE`; signed evidence ถูกสร้างพร้อมกัน |
| ทุกสถานะที่มี signed Note | Sign Note Amendment | Doctor | อ้าง signed Note เดิม มีเนื้อหาและเหตุผล | สถานะ Visit ไม่เปลี่ยน; append signed immutable amendment โดยไม่แก้ต้นฉบับ |
| `WAITING` หรือ `CONSULTING` | Update Allergy | Assistant เฉพาะ `WAITING`; Doctor ทุกกรณี | patient revision ตรงและมีเหตุผล | สถานะ Visit ไม่เปลี่ยน; สร้าง allergy revision + Audit Event |
| `AWAITING_PREPARATION` | Start Preparation | Assistant หรือ Doctor | Order/Label version ปัจจุบันและ stock available พอ | `PREPARING`; สร้าง hard reservation แบบ FEFO |
| `PREPARING` | Complete Preparation | Assistant หรือ Doctor | ยืนยันทุกรายการด้วย barcode หรือ manual reason | `AWAITING_RELEASE`; บันทึก preparation revision |
| `PREPARING` | Abandon Preparation | Assistant หรือ Doctor | มีเหตุผล | `AWAITING_PREPARATION`; invalidate preparation และคืน reservation ทั้งหมด |
| `AWAITING_RELEASE` | Reject Preparation | Doctor | มีเหตุผล | `AWAITING_PREPARATION`; invalidate preparation และคืน reservation ทั้งหมด |
| `AWAITING_RELEASE` | Release | Doctor | preparation, allocation, Label และ Order revision ตรงกัน | `AWAITING_HANDOFF`; บันทึก immutable release evidence |
| `AWAITING_PREPARATION`, `PREPARING`, `AWAITING_RELEASE` หรือ `AWAITING_HANDOFF` | Update Allergy | Doctor | allergy revision ใหม่และมีเหตุผล | `AWAITING_ORDER_REVISION`; invalidate Label/preparation/release และคืน reservation ทั้งหมด |
| `AWAITING_ORDER_REVISION`, `AWAITING_PREPARATION`, `PREPARING`, `AWAITING_RELEASE` หรือ `AWAITING_HANDOFF` | Sign Order Revision | Doctor | signed Order ใหม่หรือ signed `NO_MEDICATION` เพียงอย่างเดียว | invalidate artifact เก่าและคืน reservation; มียา → `AWAITING_PREPARATION`; ไม่มียา → `AWAITING_CHARGE` |
| `AWAITING_CHARGE` ที่ยังเป็น `NO_MEDICATION` และ Charge ยังไม่ finalize | Sign Order Revision | Doctor | signed Order ใหม่ | `AWAITING_PREPARATION`; supersede `NO_MEDICATION` revision เดิม |
| `AWAITING_HANDOFF` | Confirm Handoff | Assistant หรือ Doctor | release ยัง valid และ reservation ยังครบ | `AWAITING_CHARGE`; สร้าง Dispense + Stock Movement และ consume reservation ใน transaction เดียว |
| `AWAITING_CHARGE` | Finalize Charge | Doctor | dispense สำเร็จหรือเป็น signed `NO_MEDICATION`; ราคา snapshot ครบ | ยอดสุทธิ > 0 → `AWAITING_PAYMENT`; ยอดสุทธิ = 0 จาก approved waiver → `READY_TO_CLOSE` |
| `AWAITING_PAYMENT` | Record Cash | Assistant หรือ Doctor | ยอดที่ยืนยันเท่ากับ net due | `READY_TO_CLOSE`; สร้าง Payment เดียว |
| `AWAITING_PAYMENT` | Confirm PromptPay | Doctor | หลักฐานและยอดที่ยืนยันเท่ากับ net due | `READY_TO_CLOSE`; สร้าง Payment เดียว |
| `READY_TO_CLOSE` | Close Visit | Doctor | ไม่มี pending item และ revision ตรง | `CLOSED`; บันทึกเวลาปิดและ Audit Event |
| หลัง Confirm Handoff รวมถึง `CLOSED` | Add Allergy for Future Visits | Doctor | มีเหตุผล | สถานะ Visit และ evidence เดิมไม่เปลี่ยน; allergy revision ใช้กับงานใหม่เท่านั้น |

ก่อน Confirm Handoff แพทย์แก้ Order เป็น revision ใหม่ได้ การแก้นี้หรือการเปลี่ยน allergy ที่เกี่ยวข้องจะ invalidate Label, preparation และ release เดิม คืน reservation และพา Visit กลับ `AWAITING_PREPARATION` หลังลงนาม Order revision ใหม่ ก่อน Finalize Charge แพทย์เปลี่ยน signed `NO_MEDICATION` เป็น signed Order หรือเปลี่ยน Order เป็น signed `NO_MEDICATION` revision ใหม่ได้ โดยต้องคืน reservation และ invalidate artifact เดิมทั้งหมด เมื่อ Dispense หรือ Charge finalize แล้ว Pilot ไม่อนุญาตให้แก้ decision/Order เดิมย้อนหลัง

คำสั่งที่มาจากสถานะผิดต้องถูกปฏิเสธโดยไม่เกิด partial write; retry ด้วย idempotency key และ payload เดิมต้องคืนผลเดิม ส่วน key เดิมแต่ payload ต่างต้องตอบ conflict โดยไม่แก้ข้อมูล

## 6. หน้าจอ P0

ระบบจะใช้ UI, React components, CSS, responsive layout และ print styles ที่สร้างไว้แล้วเป็นฐาน ไม่ออกแบบใหม่ทั้งชุด

| หน้าจอเดิม | หน้าที่ใน Pilot |
|---|---|
| Clinic Overview `/` | แสดงคิวรอตรวจ รอจัดยา รอชำระ และสต็อกที่ต้องสนใจจากฐานข้อมูลเดียวกัน |
| Patient Intake `/intake` | ค้นหา/สร้างผู้ป่วย บันทึก Intake และส่งเข้าคิว |
| Queue `/queue` | แสดงสถานะสดและเปิดงานถัดไปตามสิทธิ์ |
| Consultation `/consultations/:visitId` | Patient Snapshot, SOAP, diagnosis, Medication Order และการลงนาม |
| Dispensing `/dispensing/:visitId` | Pick List, scan/manual confirm, preparation, doctor final check, release และ handoff |
| Labels `/dispensing/:visitId/labels` | preview/print ฉลากภาษาไทยขนาด 80 × 100 มม. หลัง Order ลงนามและก่อนจัดยา/ตรวจ final โดยใช้ได้เฉพาะ Label version ปัจจุบัน |
| Checkout `/checkout/:visitId` | Charge, Cash/PromptPay และสถานะยอดค้าง |
| OPD Card `/visits/:visitId/opd-card` | เอกสาร A4 จากข้อมูลที่ลงนามแล้ว |
| Inventory `/inventory` | ค้นหายา ดูยอดรวม วันหมดอายุที่ใกล้ที่สุด และสถานะใกล้หมด/หมด/หมดอายุ; lot detail ใช้ในขั้นรับเข้าและจัดยาเท่านั้น |
| Stock Reception `/inventory/receive` | รับยาเข้าคลังพร้อมล็อต จำนวน ผู้ขาย และวันหมดอายุ |

ข้อมูลประวัติล่าสุดที่จำเป็นจะอยู่ใน Patient Snapshot ของหน้าตรวจ ส่วนหน้าประวัติเต็ม `/patients/:patientId/history` จะเก็บหน้าตาเดิมไว้ แต่ไม่เป็นเกณฑ์ส่งมอบ P0

หน้า `/appointments`, `/appointments/new` และ `/analytics` จะเก็บโค้ดและงานออกแบบเดิมไว้เป็น design preview หรือซ่อนจากเมนู Pilot แต่จะไม่เชื่อมเป็น workflow ใช้งานจริงในรอบนี้ เพื่อไม่ให้เกิดแหล่งข้อมูลจริงกับข้อมูลตัวอย่างปะปนกัน

คำว่า “ใช้ UI/CSS เดิม” หมายถึงรักษา layout, cards, typography, colors, spacing, routes, responsive behavior และ print design ไม่ได้หมายความว่าห้ามเพิ่ม control ที่ workflow จริงจำเป็นต้องมี โดย P0 จะเพิ่มเฉพาะ patient search, `NO_MEDICATION`, amendment, manual-confirm reason, release/reject, Charge finalize, waiver และ close controls ภายใน component/card เดิม

หน้า Dispensing และ Checkout จะแสดง **โหมดตาม role และสถานะครั้งละหนึ่งงานหลัก** เช่น ผู้ช่วยเห็น preparation ขณะที่แพทย์เห็น final check บน URL เดียวกัน จะไม่ยัดทุก action ให้เห็นพร้อมกัน การทำงานคนเดียวของ Doctor ใช้ permission/navigation ใน shell เดิม ไม่ใช้ role toggle และไม่เปลี่ยน layout หลัก

## 7. กฎธุรกิจที่ห้ามละเมิด

### เวชระเบียนและคำสั่งยา

- Clinical Note ที่ยังเป็น draft แก้ไขได้; เมื่อลงนามแล้วแก้ทับไม่ได้ การแก้ไขต้องสร้าง amendment ที่เชื่อมกับต้นฉบับ
- แพทย์ต้องลงนาม Medication Order หรือบันทึก `NO_MEDICATION` อย่างใดอย่างหนึ่งก่อนดำเนินต่อ
- Order, Label, preparation และ release ต้องมี version และเชื่อมกันครบสาย
- เมื่อ Order หรือข้อมูลความปลอดภัยที่เกี่ยวข้อง เช่น allergy เปลี่ยน ระบบต้อง invalidate Label, preparation และ release เก่าพร้อมกัน ห้ามใช้ของเก่าจ่ายยา
- ค่าที่ไม่ทราบต้องแสดงเป็น `UNKNOWN` ห้ามตีความช่องว่างว่า “ไม่มี”
- ชื่อยา วิธีใช้ หน่วย และราคา ณ เวลาสั่ง/จ่ายต้องเก็บเป็น snapshot เพื่อให้ประวัติเดิมไม่เปลี่ยนตาม Drug Master ในอนาคต

### การจัดยาและคลังยา

- ระบบใช้หน่วยหลักของยาเพียงหน่วยเดียวต่อรายการใน Pilot เช่น เม็ด แคปซูล หรือขวด
- สต็อกคงเหลือคำนวณจาก Stock Movement แบบ append-only ห้ามแก้ยอดย้อนหลังโดยตรง
- ล็อตหมดอายุ ล็อตกักกัน หรือจำนวนไม่พอ ห้ามถูกจัดสรร
- การจัดสรรใช้ FEFO และรองรับการตัดจากมากกว่าหนึ่งล็อต
- barcode ใน P0 คือรหัสระดับ Drug Master (`barcode` หรือ `internal_barcode`) รับจาก USB scanner แบบ keyboard-wedge หรือพิมพ์ในช่องเดียวกัน ใช้ยืนยันชนิดยา ไม่ใช่รหัสล็อต; preparation item ยังต้องอ้าง Order revision และ allocated lot แยกต่างหาก
- เมื่อเริ่มจัดยา ระบบสร้าง **hard reservation** ใน transaction เดียว: `available = on-hand − active reservations`; reservation ค้างอยู่แม้ปิด browser เพื่อให้กลับมาทำต่อได้
- reservation ถูก consume เมื่อ handoff, หรือถูกคืนทั้งหมดเมื่อแพทย์ reject, Order/allergy ถูกแก้, หรือผู้ช่วยกด abandon preparation พร้อมเหตุผล ไม่มีการหมดเวลาเองใน Pilot
- การแก้สต็อกต้องเป็น compensating movement ที่อ้างถึงรายการเดิมและมีเหตุผล
- การยืนยัน handoff ต้องสร้าง Dispense และตัดสต็อกรายล็อตพร้อมกันทั้งหมด หากส่วนหนึ่งล้มเหลวต้องไม่บันทึกส่วนใดเลย
- การส่งคำสั่งเดิมซ้ำต้องไม่สร้าง Dispense หรือหักสต็อกซ้ำ และสต็อกต้องไม่ติดลบแม้มีคำขอชนกัน

### การเงินและการปิด Visit

- สกุลเงินคือบาทไทย ราคาทั้งหมดเก็บเป็นจำนวนเต็มหน่วยสตางค์; ปริมาณยา P0 เป็นจำนวนเต็มใน canonical unit จึงไม่มีการปัดเศษระหว่างคำนวณ
- ค่า consultation มาจาก Clinic Configuration หนึ่งค่า และราคายาต่อหน่วยมาจาก Drug Master; ทั้งสองถูก snapshot เมื่อ finalize เพื่อให้ประวัติไม่เปลี่ยนภายหลัง
- Charge คำนวณฝั่ง server จากค่าบริการหนึ่งรายการและยาที่ส่งมอบจริง ไม่รับยอดรวมที่ browser คำนวณมาเป็นความจริง
- Charge ที่ finalize แล้วแก้ทับไม่ได้ การแก้ไขต้องเป็นรายการชดเชย
- เงินสดให้ผู้ช่วยบันทึกได้; PromptPay/QR ใน Pilot เป็นการยืนยันด้วยมือโดยแพทย์ ไม่มีการเชื่อมธนาคาร
- การกดรับชำระซ้ำต้องไม่สร้าง Payment ซ้ำ
- Doctor อนุมัติ waiver ได้โดยต้องมีเหตุผล; waiver เป็น negative Charge adjustment แบบ append-only และ `COLLECTION_NOT_REQUIRED` ใช้ได้เมื่อ net due เป็นศูนย์เท่านั้น
- Visit ปิดได้โดยแพทย์เท่านั้น เมื่อ Charge finalize แล้วและ Payment ที่ยืนยันตรงกับยอดสุทธิ หรือได้รับการยกเว้นจนยอดสุทธิเป็นศูนย์

### ตัวตน สิทธิ์ และ audit

- ทุกคนใช้บัญชีของตนเอง ห้ามใช้ role toggle เป็นระบบสิทธิ์จริง
- installer/CLI สร้างบัญชี Doctor และ Assistant เริ่มต้นด้วยรหัสผ่านชั่วคราว ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งแรก; การ reset/disable account ทำผ่าน CLI โดยผู้ดูแล Clinic Host ใน Pilot
- session ล็อกหลังไม่มีการใช้งาน 15 นาที Doctor มี permission ของงานปฏิบัติการที่กำหนดไว้แล้ว จึงไม่ต้องสวมบทบาทหรือสลับ role
- API ตรวจทั้งตัวตน สิทธิ์ สถานะปัจจุบัน และ revision ที่ผู้ใช้กำลังแก้
- ทุก mutation สำคัญบันทึก actor, เวลา, action, entity, revision และเหตุผลที่เกี่ยวข้อง
- การซ่อนปุ่มหรือเมนูเป็นเพียง UX; ความปลอดภัยต้องถูกบังคับฝั่ง server
- Timestamp เก็บเป็น UTC และแสดงตาม `Asia/Bangkok`; UI ภาษาไทยแสดงปี พ.ศ.
- เงินเก็บเป็นจำนวนเต็มหน่วยสตางค์ ไม่ใช้เลขทศนิยมแบบ floating point

## 8. แนวคิดข้อมูลหลัก

โครงสร้างได้รับบทเรียนจาก Bahmni เรื่องการมี Patient/Visit เป็นแกน แยกข้อมูล master ออกจากเหตุการณ์จริง และเก็บประวัติแบบตรวจสอบย้อนหลังได้ แต่ Pilot จะไม่ติดตั้งหรือคัดลอก Bahmni ทั้งระบบ

- **Clinic** — ข้อมูลคลินิกที่ใช้บนหน้าจอและเอกสาร
- **Staff Account** — ตัวตน บทบาท และสถานะบัญชี
- **Patient** — HN และข้อมูลผู้ป่วย; HN ต้องไม่ซ้ำในคลินิก
- **Allergy** — สารที่แพ้ ปฏิกิริยา ความรุนแรง และหมายเหตุ
- **Visit** — ครั้งรับบริการและสถานะการไหลของงาน
- **Observation** — Intake และ Vitals พร้อมผู้บันทึกและเวลา
- **Clinical Note / Amendment** — draft, signed และประวัติแก้ไขแบบ append-only
- **Diagnosis** — รหัส/ชื่อ diagnosis และรายการที่ผูกกับ Visit
- **Medication Order / Order Item / Label Version** — คำสั่งยาและ snapshot ที่มี version
- **Preparation / Release / Dispense** — หลักฐานการจัด ตรวจ final และส่งมอบ
- **Medication / Inventory Lot / Stock Movement** — Drug Master, ล็อต และบัญชีสต็อก
- **Charge / Payment** — รายการคิดเงิน ยอดสุทธิ และการรับชำระ
- **Audit Event / Idempotency Record** — หลักฐานการกระทำและการป้องกันงานซ้ำ

Queue, Dashboard, Low Stock และ Patient Snapshot เป็นมุมมองที่คำนวณจากข้อมูลข้างต้น ไม่ใช่ฐานข้อมูลคนละชุด

## 9. สถาปัตยกรรมที่ล็อกสำหรับ Pilot

### รูปแบบใช้งาน

- มี **Clinic Host หนึ่งเครื่อง** ในคลินิก เป็นเจ้าของฐานข้อมูลและ API เพียงจุดเดียว
- เครื่องแพทย์และเครื่องผู้ช่วยเปิด web app ผ่าน LAN
- งานหลักทำได้เมื่ออินเทอร์เน็ตล่ม ตราบใดที่ Clinic Host และ LAN ยังทำงาน
- หาก Clinic Host หรือ LAN ล่ม ระบบต้องบอกชัดว่ายังบันทึกไม่ได้ ห้ามแสดงผลสำเร็จปลอม
- P0 ไม่ทำ offline sync ระหว่างฐานข้อมูลหลายชุด และไม่ให้ browser แต่ละเครื่องเป็น source of truth

### Tech stack

- Frontend: React + TypeScript + Vite SPA โดยย้ายและใช้ component markup, CSS, design tokens, navigation behavior และ print styles เดิมต่อ พร้อม React Router routes/SPA fallback ที่รักษา URL ของ 10 หน้าจอ P0
- Backend/API: Fastify + TypeScript
- Database: SQLite WAL ผ่าน `better-sqlite3` และ Drizzle migrations
- Deployment: Node service บน Clinic Host และ Caddy สำหรับ HTTPS/LAN
- Authentication: named local accounts, Argon2 password hash และ secure HTTP-only session cookie
- Testing: Vitest กับ SQLite file จริงแบบชั่วคราว รวม API integration tests
- Backup: encrypted daily backup ไป external drive ที่ไม่ใช่ disk เดียวกับ Clinic Host, เก็บย้อนหลัง 7 วัน; เจ้าของคลินิกถือ recovery passphrase แยกจาก Host; เป้าหมาย RPO 24 ชั่วโมงและ RTO 2 ชั่วโมง; restore ทำผ่าน CLI และต้องตรวจ schema version + integrity ก่อนเขียนฐานข้อมูล

ระบบเป็น modular monolith และมี API เป็นทางเขียนข้อมูลเพียงทางเดียว ไม่ใช้ microservices, D1 หรือ browser `localStorage` เป็นฐานข้อมูลหลักของ Pilot

นี่คือการ **re-platform เป็น Vite SPA + Fastify** อย่างชัดเจน ไม่ใช่การต่อ API เข้ากับ Worker เดิม ตัวหน้า React/CSS จะถูกย้ายโดยรักษาผลลัพธ์ภาพและ interaction เดิม ส่วน Next/Vinext app-router, Worker entry, Cloudflare D1 scaffolding และ test harness เฉพาะ Worker ไม่เป็น runtime ของ Local Pilot เว็บไซต์สาธิตเดิมคง deployment แยกไว้เป็น visual reference

เว็บไซต์สาธิตที่ deploy อยู่สามารถคงไว้สำหรับดู UI แต่ไม่ใช่แหล่งข้อมูลหลักของ Clinic Pilot และต้องไม่เก็บข้อมูลผู้ป่วยจริง

### นโยบายข้อมูลสังเคราะห์

- ทุกหน้ามี banner ถาวรว่า “PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง”
- การสร้าง Patient เรียก server generator เท่านั้น: HN เป็น `DEMO-` ตามด้วยรหัสระบบ, ชื่อเป็น `ผู้ป่วยทดสอบ <รหัส>` และเบอร์เป็นช่วง `000000xxxx`; API reject identity fields ที่ไม่ตรงรูปแบบนี้ และ Pilot ไม่มี import จาก CSV/HIS
- ชุด acceptance ใช้ seed ที่เก็บใน repository เท่านั้น ผู้ทดสอบต้องยอมรับกติกาก่อนรับบัญชี
- หากพบข้อมูลจริง ให้หยุดการทดสอบ แจ้งเจ้าของโครงการ และล้างฐานข้อมูล Pilot ด้วย reset script ก่อนดำเนินต่อ
- หลังจบรอบ Pilot เจ้าของโครงการเป็นผู้สั่ง export เฉพาะรายงานผลทดสอบที่ไม่ระบุตัวบุคคล แล้วใช้ reset script ล้างฐานข้อมูล

### การเตรียมพร้อมเชื่อมระบบอื่นภายหลัง

ใช้ identifier, code, timestamps และความสัมพันธ์ Patient → Visit → clinical/medication/finance records ที่ชัดเจน เพื่อให้ทำ import/export หรือ mapping ไป OpenMRS/FHIR ในอนาคตได้ แต่ P0 ไม่สร้าง FHIR server และไม่เชื่อม Bahmni

## 10. UX และการจัดการข้อผิดพลาด

- รักษารูปลักษณ์ “Quietly Competent”, สี ตัวอักษร spacing, responsive behavior และ print CSS จาก `DESIGN.md`
- ใช้ภาษาไทยเป็นหลัก ปุ่มสัมผัสอย่างน้อย 48 px และหนึ่งหน้าจอมีงานหลักชัดเจน
- ทุกหน้าต้องมี loading, empty, validation, permission denied, conflict และ server unavailable state ที่เข้าใจได้
- การบันทึกสำเร็จหมายถึง server commit แล้วเท่านั้น
- เมื่อข้อมูลที่ผู้ใช้เปิดอยู่เก่ากว่า server ระบบต้องหยุดการเขียน บอกว่าอะไรเปลี่ยน และให้โหลดข้อมูลล่าสุด
- เมื่อกดซ้ำหรือ network retry ระบบต้องคืนผลเดิมอย่างปลอดภัย
- ข้อผิดพลาดด้าน barcode, version, สิทธิ์, ลำดับงาน หรือ stock เป็น hard block พร้อมเหตุผลที่แก้ได้
- Draft ที่ยังส่งไม่สำเร็จต้องไม่หายจากฟอร์มทันที แต่ห้ามนำ draft ใน browser ไปนับเป็นข้อมูลที่บันทึกแล้ว

## 11. สิ่งที่ไม่ทำใน Local Pilot รอบนี้

- ข้อมูลผู้ป่วยจริง หรือการอ้างว่าพร้อมใช้รักษาจริง/ผ่านข้อกำกับแล้ว
- ติดตั้ง Bahmni, OpenMRS, Crater, Odoo หรือระบบ ERP เต็มรูปแบบ
- FHIR server, HIS/HIE, NHSO, ประกัน หรือระบบส่งต่อ
- AI วินิจฉัย, voice-to-note และ clinical decision support
- Drug–drug interaction alert จนกว่าจะมีฐานความรู้ที่ตรวจสอบแหล่งที่มา ใบอนุญาต และความรับผิดชอบทางคลินิก
- Multi-clinic, cloud sync, browser-to-browser offline conflict resolution หรือ native mobile app
- เชื่อมธนาคาร/PromptPay จริง, reconciliation, refund หรือใบกำกับภาษี
- Procurement, purchase order, supplier workflow เต็มรูปแบบ และ controlled-substance workflow
- Appointment lifecycle, reminders, LINE/SMS และปฏิทินใช้งานจริง
- Monthly analytics ที่ใช้เป็นรายงานทางการ
- Patient portal, kiosk, เครื่องวัด vital signs หรือ printer driver เฉพาะรุ่น
- การ redesign UI/CSS ใหม่ทั้งระบบ

## 12. เกณฑ์ที่ถือว่า Pilot สำเร็จ

1. ขณะตัด WAN/Internet แต่ Clinic Host และ LAN ยังทำงาน Browser A สร้างหรือเปลี่ยนสถานะ Visit ที่ commit สำเร็จแล้ว และ Browser B reload แล้วเห็น Visit/สถานะเดียวกันจาก API เดียวกัน
2. บัญชี Doctor และ Assistant เห็นข้อมูลเดียวกัน แต่ทำได้เฉพาะสิทธิ์ของตน; Assistant ที่เรียก API โดยตรงต้องได้รับ 403 เมื่อพยายาม sign/amend note, create/sign Order, release, confirm PromptPay หรือ close Visit
3. ค้นหาผู้ป่วยเดิมหรือสร้างผู้ป่วยใหม่ เปิด Visit และเห็นรายการเดียวใน Queue ได้
4. Visit มียาเดินครบ Order → Label → preparation → release → handoff → Dispense/stock-out → Charge → Payment → close
5. Visit `NO_MEDICATION` ต้องมี signed decision โดย Doctor; Order ว่างอย่างเดียวไม่เพียงพอ และ Visit ต้องไม่มี Label, preparation, release, Dispense หรือ Stock Movement ก่อนจบ Charge → Payment/waiver → close
6. Clinical Note ที่ลงนามแล้วแก้ทับไม่ได้ และ amendment ไม่เปลี่ยนต้นฉบับ
7. เมื่อแก้ Order หรือ allergy ระบบ mark Label, preparation และ release ที่อ้าง revision เก่าเป็น invalid; API block print/release/handoff ของเก่าและบันทึกเหตุผลใน audit
8. barcode ที่ไม่ตรงถูก block โดยไม่สร้าง preparation; manual confirm บันทึก actor, เวลา UTC, medication/order revision, allocated lot และเหตุผลที่ไม่ว่าง
9. เมื่อมี sellable lots อย่างน้อยสองล็อต ระบบ hard-reserve ล็อตหมดอายุก่อนแบบ FEFO; expired/quarantined lots ไม่ถูก allocate; reject/invalidate/abandon คืน reservation ครบ และ Dispense กับ stock-out สำเร็จหรือ rollback พร้อมกัน
10. คำขอสองรายการที่แย่งสต็อกก้อนสุดท้ายสำเร็จได้ไม่เกินหนึ่งรายการ และยอดไม่ติดลบ
11. idempotency key + payload เดิมคืนผลเดิมโดยไม่สร้าง Visit, Dispense, Stock Movement หรือ Payment ซ้ำ; key เดิม + payload ต่างตอบ conflict โดยไม่แก้ข้อมูล
12. Visit ปิดได้เฉพาะเมื่อ Charge เป็น finalized และ net due เป็นศูนย์จาก confirmed Payment หรือ Doctor-approved waiver พร้อมเหตุผล; API block ทุกกรณีอื่น
13. ปิด/เปิด browser หรือ restart service แล้ว signed note, Order revision, preparation/release, Dispense/Stock Movement, Charge/Payment, Audit Event และสถานะล่าสุดกลับมาด้วย identifiers/revisions เดิม
14. backup ที่ใช้ restore drill เป็นไฟล์เข้ารหัส มี schema version และ integrity check; restore ลงฐานข้อมูลว่างแล้ว record counts, signed-note hashes, stock/finance balances และ foreign-key relationships ตรงกับก่อน backup
15. Chrome print preview/PDF แสดง OPD Card เป็น A4 และฉลากเป็น 80 × 100 มม. หนึ่งยาต่อหน้า โดยไม่มี sidebar/topbar/action controls และทุก field บังคับอยู่ในขอบหน้า
16. หน้าหลักผ่านที่ viewport 375 px, 768 px และ 1440 px ตาม DESIGN.md; action สำคัญใช้ keyboard ได้และข้อความที่ใช้ทำงานเป็นภาษาไทย
17. CI integration suite ใช้ SQLite ชั่วคราวและมีอย่างน้อยหนึ่ง test ต่อ state transition, role denial, amendment, invalidation, idempotency collision, stock race, atomic rollback และ restore drill
18. การแก้ Clinic Configuration หรือ Drug Master ภายหลังไม่เปลี่ยนชื่อยา วิธีใช้ หน่วย ราคา หรือค่าบริการที่ snapshot ไว้ใน Order, Label, Dispense, Charge และ OPD Card เดิม
19. ทุก mutation สำคัญ ได้แก่ intake, sign/amend, Order/revision, manual confirm, release/reject, handoff/Dispense, stock receipt/adjustment, Charge finalize, Payment/waiver และ close สร้าง Audit Event ที่มี actor, UTC timestamp, action, entity ID, revision และเหตุผลเมื่อกฎกำหนด
20. ทดลอง Visit ต่อเนื่องอย่างน้อย 10 รายการ ครอบคลุมทั้งมียาและไม่มียา โดยไม่มีการแก้ฐานข้อมูลด้วยมือ ไม่มีรายการซ้ำ และไม่มีสต็อกติดลบ
21. ทุกหน้ามี synthetic-data banner; Patient creation API เป็นผู้สร้าง HN/ชื่อ/เบอร์ตามรูปแบบทดสอบและ reject ค่านอก pattern; ไม่มี import และ reset script ล้าง patient/Visit/clinical/medication/finance/audit test data ได้ครบหลังเก็บรายงานที่ไม่ระบุตัวบุคคล

Acceptance test ใช้ Windows 11 Clinic Host, Chrome stable สอง browser clients, seed patient/medication/lot/fee ที่ versioned ใน repository, fixture สำหรับ FEFO/expired/quarantine/last-stock race และเก็บ test report พร้อม expected/actual status, balances และ Audit Events ทุกครั้ง Physical printer calibration ไม่เป็นเกณฑ์ P0; ใช้ browser print preview/PDF เป็นหลักฐาน

## 13. ลำดับส่งมอบระดับผลิตภัณฑ์

1. **Foundation:** Clinic Host, database, migrations, accounts, sessions, audit และ backup skeleton
2. **Patient & Visit:** patient search/registration, Intake, Queue, Snapshot, Clinical Note และ signed evidence
3. **Medication Safety:** Order/Label versions, invalidation, Pick List, barcode/manual confirm, final release, FEFO และ atomic dispense
4. **Finance & Close:** Charge, Cash/PromptPay manual confirmation, waiver และ close gate
5. **Pilot Hardening:** two-device LAN test, restart/retry/race tests, printing, backup/restore drill และ 10-Visit rehearsal

แต่ละช่วงต้องจบด้วยข้อมูลที่อ่านกลับได้และ test ผ่าน ห้ามสร้างหน้าจอครบก่อนแล้วค่อยเติมกฎข้อมูลทีหลัง

## 14. คำตอบต่อเอกสารเดิมที่ขัดกัน

- เลือก **SQLite local-first** แทน PostgreSQL/cloud database สำหรับ Pilot เพราะมี Clinic Host เดียวและต้องดูแลง่าย
- เลือก **Fastify modular monolith** แทน microservices
- รักษา **UI/CSS ปัจจุบัน** แต่เปลี่ยนชั้นข้อมูลจาก reducer/`localStorage` เป็น API; ไม่สร้างหน้าตาใหม่
- ศึกษาแนวคิด domain/configuration/audit จาก **Bahmni** แต่ไม่รับภาระ OpenMRS/MySQL/Crater/Odoo ทั้งชุด
- จำกัดเส้นชัยไว้ที่ Visit vertical slice; Appointment, Analytics, AI และ integrations รอหลัง Pilot

## 15. ประโยคตัดสินใจสุดท้าย

ถ้าฟีเจอร์ใดไม่จำเป็นต่อการทำให้ “ผู้ป่วยหนึ่ง Visit ไหลครบอย่างถูกต้องและกู้คืนได้” ฟีเจอร์นั้นไม่อยู่ใน P0 แม้จะมีหน้าจอหรือถูกกล่าวถึงในเอกสารเก่าก็ตาม
