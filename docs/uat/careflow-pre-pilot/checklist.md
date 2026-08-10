# CareFlow Pre-pilot UAT — Result Checklist

กรอก Actual, Result, เวลา, หมายเหตุ UX และหลักฐานสังเคราะห์ทันทีหลังทำแต่ละรายการในคู่มือ

## ก่อนเริ่ม

### PRE-01 — เปิดหน้าต่าง Assistant และ Doctor
- Expected: เห็นเมนู `รับผู้ป่วย` ในหน้าต่าง Assistant, เมนู `คิวผู้ป่วย` ในหน้าต่าง Doctor, และหัวพื้นที่ทำงานตรงตามบทบาท
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### PRE-02 — ตรวจว่าทั้งสองหน้าต่างเห็นคิวเดียวกัน
- Expected: ทั้งสองหน้าต่างแสดงคิวผู้ป่วยเดียวกัน แต่เห็นคำสั่งตามบทบาทของตน
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## Scenario A — เงินสด 140 บาท

### A-01 — Assistant สร้างผู้ป่วยสังเคราะห์
- Expected: เห็น Patient Header ที่มี `HN DEMO-` และไม่มีข้อมูลบุคคลจริง
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-02 — Assistant ส่งอาการสังเคราะห์ UAT เงินสดให้แพทย์
- Expected: บัตรคิว Scenario A แสดง `อาการสังเคราะห์ UAT เงินสด` และอยู่สถานะ `WAITING` หรือ `รอตรวจ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-03 — Assistant ทบทวนประวัติแพ้ยาเป็น NONE_KNOWN
- Expected: ประวัติแพ้ยาแสดง `NONE_KNOWN`; Visit ยังอยู่สถานะรอตรวจ
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-04 — Doctor เริ่มการตรวจ Scenario A
- Expected: เปิดห้องตรวจ Scenario A และสถานะเป็น `CONSULTING` หรือ `กำลังตรวจ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-05 — Doctor บันทึก SOAP และการวินิจฉัยสังเคราะห์
- Expected: SOAP มี `ข้อมูลสังเคราะห์ UAT` พร้อมชื่อแต่ละ field และการวินิจฉัยเป็น `การวินิจฉัยสังเคราะห์ UAT`; สถานะยังเป็น `CONSULTING`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-06 — Doctor บันทึกร่าง ORDER จำนวน 8 เม็ด
- Expected: ร่างแสดง `[DEMO] ยาทดสอบชนิด A` จำนวน 8 เม็ด และวิธีใช้ `รับประทานตามคำแนะนำสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-07 — Doctor ลงนามและส่งต่อ ORDER
- Expected: เห็นหลักฐานการตัดสินใจยาที่ลงนาม และ Visit เป็น `AWAITING_PREPARATION` หรือ `รอจัดยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-08 — Assistant รับล็อต UAT-A-EARLY
- Expected: ล็อต `UAT-A-EARLY` ของ `[DEMO] ยาทดสอบชนิด A` มีคงคลัง 5, พร้อมใช้ 5, หมดอายุ `2031-12-31`, และผู้จำหน่าย `ผู้จำหน่ายสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-09 — Assistant รับล็อต UAT-A-LATE
- Expected: ล็อต `UAT-A-LATE` ของ `[DEMO] ยาทดสอบชนิด A` มีคงคลัง 10, พร้อมใช้ 10, หมดอายุ `2032-12-31`, และผู้จำหน่าย `ผู้จำหน่ายสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-10 — Assistant เริ่มเตรียมยาแบบ FEFO
- Expected: Visit เป็น `PREPARING`; รายการจองเป็น `UAT-A-EARLY` 5 เม็ด แล้ว `UAT-A-LATE` 3 เม็ด
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-11 — Assistant บันทึกคำขอพิมพ์ฉลาก Scenario A
- Expected: จากลิงก์ `เปิดฉลากยา` เห็นข้อความ `บันทึกคำขอพิมพ์แล้ว`; ฉลากแสดง `[DEMO] ยาทดสอบชนิด A` จำนวน 8 เม็ดและวิธีใช้ที่กำหนด
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-12 — Assistant ยืนยันบาร์โค้ดครบสองล็อต
- Expected: ใส่ `CF-DEMO-001` แล้วกด Enter หนึ่งครั้งต่อ allocation ครบสองครั้ง; ทั้งสอง allocation เป็น `ยืนยันแล้ว`, ตัวนับเป็น `2/2 รายการได้รับการยืนยัน`, แล้ว Visit ยังเป็น `PREPARING` ก่อนกด `เสร็จสิ้นการเตรียมยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-13 — Assistant เสร็จสิ้นการเตรียมยา Scenario A
- Expected: Visit เป็น `AWAITING_RELEASE` หรือ `รอแพทย์ปล่อยยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-14 — Doctor ปล่อยยา Scenario A
- Expected: Visit เป็น `AWAITING_HANDOFF` หรือ `รอส่งมอบยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-15 — Doctor ยืนยันยอดเพื่อรับชำระ Scenario A
- Expected: Visit เป็น `AWAITING_PAYMENT` หรือ `รอรับชำระ` และยอดที่แสดงเป็น 140 บาท
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-16 — Assistant ยืนยันรับเงินสด 140 บาท
- Expected: Visit เป็น `READY_TO_CLOSE` หรือ `พร้อมปิด Visit` และแสดง `รับเงินสดแล้ว`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-17 — Doctor ปิด Visit Scenario A
- Expected: Visit เป็น `CLOSED` และแสดง `ปิด Visit แล้ว`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### A-18 — Doctor เปิดบัตร OPD Scenario A
- Expected: บัตร OPD แสดงข้อมูลสังเคราะห์ Scenario A และเงินสด 140 บาท
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## จุดพักเพื่อ restart ระบบ

### RESTART-01 — Assistant ส่งมอบยา Scenario A หลัง restart
- Expected: หลัง restart สถานะเดิม `AWAITING_HANDOFF` ยังอยู่; เมื่อส่งมอบแล้ว Visit เป็น `AWAITING_CHARGE`, `UAT-A-EARLY` เหลือ 0 และ `UAT-A-LATE` เหลือ 7
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## Scenario B — ปฏิเสธและ PromptPay 105 บาท

### B-01 — Assistant สร้างผู้ป่วยสังเคราะห์ Scenario B
- Expected: เห็น Patient Header ที่มี `HN DEMO-` และไม่มีข้อมูลบุคคลจริง
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-02 — Assistant ส่งอาการสังเคราะห์ UAT ปฏิเสธและพร้อมเพย์
- Expected: บัตรคิว Scenario B แสดงข้อความอาการสำคัญที่กำหนด และอยู่ `WAITING` หรือ `รอตรวจ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-03 — Assistant ทบทวนประวัติแพ้ยา Scenario B
- Expected: ประวัติแพ้ยาแสดง `NONE_KNOWN` และ Visit ยังรอตรวจ
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-04 — Doctor เริ่มการตรวจ Scenario B
- Expected: เปิดห้องตรวจ Scenario B และ Visit เป็น `CONSULTING`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-05 — Doctor บันทึก SOAP และการวินิจฉัย Scenario B
- Expected: SOAP มี `ข้อมูลสังเคราะห์ UAT` พร้อมชื่อแต่ละ field และการวินิจฉัยเป็น `การวินิจฉัยสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-06 — Doctor บันทึกร่าง ORDER จำนวน 1 เม็ด
- Expected: ร่างแสดง `[DEMO] ยาทดสอบชนิด A` จำนวน 1 เม็ดและวิธีใช้ `รับประทานตามคำแนะนำสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-07 — Doctor ลงนามและส่งต่อ ORDER Scenario B
- Expected: Visit เป็น `AWAITING_PREPARATION` และเห็นหลักฐานการตัดสินใจยาที่ลงนาม
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-08 — Assistant เริ่มเตรียมยา Scenario B
- Expected: Visit เป็น `PREPARING` และการจองใช้ `UAT-A-LATE` 1 เม็ด
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-09 — Assistant บันทึกคำขอพิมพ์ฉลากครั้งแรก
- Expected: จากลิงก์ `เปิดฉลากยา` เห็นข้อความ `บันทึกคำขอพิมพ์แล้ว` และ Visit ยังเป็น `PREPARING`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-10 — Assistant ยืนยันยาและเสร็จสิ้นการเตรียมครั้งแรก
- Expected: ใส่ `CF-DEMO-001` แล้วกด Enter หนึ่งครั้งต่อ allocation เดียว; allocation เป็น `ยืนยันแล้ว`, ตัวนับเป็น `1/1 รายการได้รับการยืนยัน`, แล้ว Visit เป็น `AWAITING_RELEASE`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-11 — Doctor ปฏิเสธการจัดยา
- Expected: หลังบันทึกเหตุผล `ทดสอบการพิมพ์ฉลากใหม่`, Visit กลับเป็น `AWAITING_PREPARATION` หรือ `รอจัดยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-12 — Assistant เริ่มเตรียมยาใหม่
- Expected: Visit เป็น `PREPARING` และเห็นข้อความให้พิมพ์ฉลากรอบใหม่
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-13 — Assistant บันทึกคำขอพิมพ์ฉลากรอบใหม่
- Expected: จากลิงก์ `เปิดฉลากยา` เห็นข้อความ `บันทึกคำขอพิมพ์แล้ว` สำหรับฉลากปัจจุบันรอบใหม่
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-14 — Assistant ยืนยันยาและเสร็จสิ้นการเตรียมรอบใหม่
- Expected: ใส่ `CF-DEMO-001` แล้วกด Enter หนึ่งครั้งต่อ allocation เดียว; allocation เป็น `ยืนยันแล้ว`, ตัวนับเป็น `1/1 รายการได้รับการยืนยัน`, แล้ว Visit เป็น `AWAITING_RELEASE`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-15 — Doctor ปล่อยยา Scenario B
- Expected: Visit เป็น `AWAITING_HANDOFF` หรือ `รอส่งมอบยา`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-16 — Assistant ส่งมอบยา Scenario B
- Expected: Visit เป็น `AWAITING_CHARGE` และล็อต `UAT-A-LATE` เหลือ 6 เม็ด
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-17 — Doctor ยืนยันยอดเพื่อรับชำระ Scenario B
- Expected: Visit เป็น `AWAITING_PAYMENT` หรือ `รอรับชำระ` และยอดที่แสดงเป็น 105 บาท
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-18 — Doctor ยืนยัน PromptPay
- Expected: เลขอ้างอิงเป็น `UAT-PROMPT-105`, Visit เป็น `READY_TO_CLOSE`, และแสดง `ยืนยัน PromptPay แล้ว`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-19 — Doctor ปิด Visit Scenario B
- Expected: Visit เป็น `CLOSED` และแสดง `ปิด Visit แล้ว`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### B-20 — Doctor เปิดบัตร OPD Scenario B
- Expected: บัตร OPD แสดงข้อมูลสังเคราะห์ Scenario B และ PromptPay 105 บาท
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## Scenario C — ไม่สั่งยาและยกเว้นเต็มจำนวน

### C-01 — Assistant สร้างผู้ป่วยสังเคราะห์ Scenario C
- Expected: เห็น Patient Header ที่มี `HN DEMO-` และไม่มีข้อมูลบุคคลจริง
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-02 — Assistant ส่งอาการสังเคราะห์ UAT ไม่สั่งยา
- Expected: บัตรคิว Scenario C แสดงข้อความอาการสำคัญที่กำหนด และอยู่ `WAITING` หรือ `รอตรวจ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-03 — Assistant ทบทวนประวัติแพ้ยาเป็น UNKNOWN
- Expected: ประวัติแพ้ยาแสดง `UNKNOWN` และ Visit ยังรอตรวจ
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-04 — Doctor เริ่มการตรวจ Scenario C
- Expected: เปิดห้องตรวจ Scenario C และ Visit เป็น `CONSULTING`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-05 — Doctor บันทึก SOAP และการวินิจฉัย Scenario C
- Expected: SOAP มี `ข้อมูลสังเคราะห์ UAT` พร้อมชื่อแต่ละ field และการวินิจฉัยเป็น `การวินิจฉัยสังเคราะห์ UAT`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-06 — Doctor บันทึกร่าง NO_MEDICATION
- Expected: ร่างแสดง `NO_MEDICATION` พร้อมเหตุผล `ไม่มีข้อบ่งใช้ยาในการทดสอบสังเคราะห์`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-07 — Doctor ลงนามและส่งต่อ NO_MEDICATION
- Expected: Visit เป็น `AWAITING_CHARGE` หรือ `รอคิดเงิน` และไม่มีรายการยา
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-08 — Doctor ยกเว้นเต็มจำนวน
- Expected: เหตุผลเป็น `ยกเว้นเพื่อทดสอบระบบสังเคราะห์`; Visit เป็น `READY_TO_CLOSE`; ยอดสุทธิ 0 บาทและแสดง `ยกเว้นเต็มจำนวน · ไม่ต้องรับชำระ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-09 — Doctor ปิด Visit Scenario C
- Expected: Visit เป็น `CLOSED` และแสดง `ปิด Visit แล้ว`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### C-10 — Doctor เปิดบัตร OPD Scenario C
- Expected: บัตร OPD แสดงว่าไม่สั่งยา ยอดสุทธิ 0 บาท และข้อมูลสังเคราะห์ Scenario C
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## ตรวจสิทธิ์

### ROLE-01 — Assistant เห็นเฉพาะคำสั่งคิวตามบทบาท
- Expected: จุดตรวจหลัง A-03 ก่อน A-04 ขณะ Scenario A เป็น `WAITING`: ทั้งสองหน้าต่างเลือก `คิวผู้ป่วย`; Assistant ไม่เห็น `เริ่มการตรวจ` และเห็น `รอแพทย์เริ่มการตรวจ`, ส่วน Doctor เห็น `เริ่มการตรวจ`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### ROLE-02 — Assistant ไม่เห็นคำสั่ง Doctor-only ที่หน้าชำระเงิน
- Expected: จุดตรวจหลัง B-17 ก่อน B-18 ขณะ Scenario B เป็น `AWAITING_PAYMENT`: ทั้งสองหน้าต่างเลือก `คิวผู้ป่วย` แล้วกด `ไปหน้าชำระเงิน`; Assistant เห็น `ยืนยันรับเงินสด 105 บาท` แต่ไม่เห็น `ยืนยัน PromptPay`, `ยกเว้นเต็มจำนวน`, หรือ `ปิด Visit`, ส่วน Doctor เห็น `ยืนยัน PromptPay`; คงหน้าชำระเงินทั้งสองไว้ถึง ROLE-03
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

### ROLE-03 — Assistant ถูกปฏิเสธบัตร OPD หลังปิด Visit
- Expected: จุดตรวจหลัง B-19 ก่อน B-20 ขณะ Scenario B เป็น `CLOSED`: ใช้หน้าชำระเงินที่เปิดจาก `ไปหน้าชำระเงิน` ใน ROLE-02 และโหลดหน้าใหม่หากยังไม่แสดง `ปิด Visit แล้ว`; ห้ามกลับ `คิวผู้ป่วย` เพราะ Visit ที่ปิดแล้วไม่แสดงในคิว. Assistant ไม่เห็น `เปิดบัตร OPD`, ส่วน Doctor เห็นลิงก์ `เปิดบัตร OPD`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## สรุปผล

### FINAL-01 — ตรวจคิวหลังปิด Scenario ทั้งสาม
- Expected: เมื่อเปิด `คิวผู้ป่วย` ไม่มีบัตรคิวของ Scenario A, B หรือ C เหลืออยู่ และทั้งสาม Scenario เป็น `CLOSED`
- Actual: บันทึกสิ่งที่เห็นระหว่าง UAT
- Result: [ ] PASS  [ ] FAIL  [ ] BLOCKED
- เวลา:
- หมายเหตุ UX:
- หลักฐานสังเคราะห์:

## Issue log

หากพบ `HTTP 500`, การเปิดเผยข้อมูลทางคลินิกข้ามบทบาท, สต็อกติดลบ, ปิด Visit ไม่ถูกต้อง, สถานะหายไปหลัง restart ระบบ, หรือยอดเงินบาทไม่ถูกต้อง ให้หยุด UAT ทั้งหมดทันที บันทึก `FAIL` หรือ `BLOCKED` ในรายการที่เกี่ยวข้อง เพิ่มแถวในตารางนี้ และส่งต่อให้ทีมรับผิดชอบ; ห้ามทำ Scenario ถัดไป แก้ระบบผลิตภัณฑ์/ข้อมูล UAT หรือ deployment

| ID | Severity | Scenario | Observed | Expected | Evidence | Decision |
| --- | --- | --- | --- | --- | --- | --- |
|  | Blocker / Important / Minor |  |  |  |  |  |

Allowed severities: `Blocker`, `Important`, `Minor`.
