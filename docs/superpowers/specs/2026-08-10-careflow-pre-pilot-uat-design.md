# CareFlow Pre-pilot UAT Design

**วันที่:** 2026-08-10
**สถานะ:** รอผู้ใช้ตรวจและอนุมัติก่อนเริ่มดำเนินการ
**ขอบเขต:** Local synthetic-only UAT บน Mac เครื่องเดียว

## 1. เป้าหมาย

พิสูจน์ว่าเจ้าของโครงการสามารถใช้ CareFlow Milestone 4 ตั้งแต่รับผู้ป่วยจนปิด Visit ได้จริงด้วยหน้าจอ production build โดยไม่ต้องอาศัยคำอธิบายระหว่างแต่ละขั้น ก่อนเชิญผู้ใช้กลุ่มเล็กเข้าร่วม Pilot rehearsal

UAT นี้วัดความเข้าใจของผู้ใช้ ความต่อเนื่องของ workflow ความถูกต้องของสิทธิ์ ความคงอยู่หลัง restart และความถูกต้องของยา/จำนวนเงิน ไม่ใช่การทดสอบ deployment หรืออนุญาตให้ใช้ข้อมูลผู้ป่วยจริง

## 2. ขอบเขตและข้อห้าม

- ใช้ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกชื่อ HN อาการ การวินิจฉัย รายการยา หรือข้อมูลการเงินของบุคคลจริง
- ทำงานบน `127.0.0.1` ใน Mac เครื่องปัจจุบัน ไม่เปิดพอร์ตสู่ LAN หรืออินเทอร์เน็ต
- ใช้ production build ของ Client และ Server จาก `main` ที่ผ่านการตรวจแล้ว
- ไม่แก้ product code ระหว่างการเดิน UAT หากพบปัญหาให้บันทึก หยุด flow ที่ได้รับผล และแยกไปแก้ด้วย TDD ภายหลัง
- ไม่ deploy ไม่เพิ่ม HTTPS ไม่ทำ backup/restore และไม่เปลี่ยนขอบเขต real-data readiness
- ไม่แตะ `stitch_careflow_clinic_management_system/` หรือฐานข้อมูลเก่า

## 3. ฐานข้อมูลและบัญชี UAT

- สร้างฐานข้อมูลใหม่ที่ `careflow-pilot/data/uat/careflow-uat.sqlite` โดยใช้ migration sequence ปัจจุบันทั้งหมด
- ให้ directory เป็น private และให้ไฟล์ SQLite/WAL/SHM ใช้สิทธิ์ตามข้อกำหนดของ Pilot
- ฐานข้อมูลเก่าจะยังอยู่ที่เดิมและจะไม่ถูกเปิด ย้าย ลบ หรือใช้เป็นต้นทาง
- สร้าง named accounts ใหม่สองบัญชี: หนึ่ง Assistant และหนึ่ง Doctor ด้วยคำสั่ง interactive
- ผู้ใช้ตั้งรหัสผ่านเองใน terminal; ห้ามบันทึกรหัสผ่านลง repository, เอกสาร UAT, screenshot หรือบทสนทนา
- ทุก Browser ต้องยืนยันแถบ `SYNTHETIC DATA ONLY` ก่อนเริ่ม scenario

## 4. สภาพแวดล้อมทดสอบ

- Browser A: Assistant session
- Browser B: Doctor session ใน private/incognito context ที่แยก cookie จาก Browser A
- Server: production build เดียวที่ `http://127.0.0.1:3001`
- Database: UAT database เดียวบน local disk
- เวลาทดสอบเป้าหมาย: 60–90 นาที โดยไม่รวมเวลาวิเคราะห์ defect

ก่อนเริ่มต้องยืนยันว่า Git อยู่บน `main`, worktree ไม่มี tracked changes, build ผ่าน, database identity ถูกต้อง และไม่มี Clinic Host ตัวอื่นครอบครอง lock

## 5. Scenario หลัก

### Scenario A — ORDER, FEFO, Cash และ OPD

1. Assistant สร้างผู้ป่วยสังเคราะห์ ทำ Intake และส่งเข้า Queue
2. Doctor เริ่ม Consultation บันทึก SOAP/diagnosis และลงนาม `ORDER`
3. Assistant รับยาสังเคราะห์สอง lot ที่ expiry ต่างกัน เพื่อให้เห็น FEFO allocation
4. Assistant เริ่มจัดยา พิมพ์ฉลาก ยืนยันรายการ และส่งให้ Doctor release
5. Assistant ยืนยัน handoff และตรวจว่า stock-out ตรงกับ lot/quantity ที่จัด
6. Doctor finalise Charge; Assistant รับ Cash ตามยอดเต็ม
7. Doctor ปิด Visit และเปิด/พิมพ์ Doctor-only OPD Card

### Scenario B — Reject, re-prepare และ PromptPay

1. สร้าง Visit `ORDER` ใหม่
2. จัดยาและให้ Doctor reject พร้อมเหตุผล
3. ยืนยันว่า reservation ถูกคืนและฉลากเดิมใช้ต่อไม่ได้
4. เริ่มจัดใหม่ สร้าง Print Request ใหม่ ยืนยันรายการ และ release/handoff
5. Doctor ยืนยัน PromptPay ด้วย reference สังเคราะห์ แล้วปิด Visit

### Scenario C — NO_MEDICATION และ full waiver

1. สร้าง Visit ใหม่และลงนาม `NO_MEDICATION` พร้อมเหตุผลสังเคราะห์
2. Doctor finalise Charge พร้อม full waiver และเหตุผล
3. Doctor ปิด Visit และตรวจ OPD Card

## 6. Safety และ negative checks

- Assistant เปิด Consultation, clinical API, close Visit และ OPD Card ไม่ได้
- Assistant ทำ PromptPay/full waiver ไม่ได้
- การ submit ด้วย idempotency key เดิมต้อง replay โดยไม่สร้างหลักฐานซ้ำ
- หน้าจอหรือ revision เก่าต้องถูกปฏิเสธโดยไม่มี partial write
- ระหว่าง Scenario A ให้ restart Server หลังมี signed ORDER และอีกครั้งหลัง Payment; Queue, inventory, Charge, Payment และสิทธิ์ต้องคงเดิม
- จำนวน stock ต้องไม่ติดลบ และยอด Charge/Payment ต้องตรงเป็นจำนวนเต็มบาท
- หากพบ HTTP 500, ข้อมูลข้ามสิทธิ์, หลักฐานหายหลัง restart, stock/เงินผิด หรือ Visit ปิดโดย chain ไม่ครบ ให้หยุด UAT และจัดเป็น Blocker

## 7. วิธีบันทึกผล

สร้างคู่มือและ checklist ภาษาไทยแยกต่างหากก่อนเริ่ม โดยแต่ละขั้นมี:

- Expected result
- Actual result
- `PASS`, `FAIL` หรือ `BLOCKED`
- เวลาและ scenario
- screenshot เฉพาะข้อมูลสังเคราะห์เมื่อจำเป็น
- หมายเหตุ UX ด้วยภาษาของผู้ทดลอง

คู่มือต้องเขียนสำหรับผู้ใช้ที่ไม่จำเป็นต้องเข้าใจคำสั่งหรือโครงสร้างระบบ:

- บอกชื่อเมนู ปุ่ม และข้อความภาษาไทยที่ต้องมองหาแบบทีละคลิก
- ให้ข้อมูลตัวอย่างสังเคราะห์ที่พิมพ์ตามได้ โดยไม่มีชื่อหรือข้อมูลของบุคคลจริง
- แสดง Expected result ทันทีหลังแต่ละ action และมีช่องทำเครื่องหมาย `PASS`, `FAIL` หรือ `BLOCKED`
- มีภาพหน้าจอหรือภาพอ้างอิงสำหรับจุดที่อาจสับสนเมื่อสามารถเก็บภาพจาก UAT build ได้อย่างปลอดภัย
- แยกขั้นตอนเตรียม Server, Database และบัญชีไว้ในส่วนสำหรับผู้ดูแล; flow หลักของผู้ทดลองต้องไม่มีคำสั่ง terminal
- ไม่บันทึกหรือแสดงรหัสผ่าน session cookie, path จริงของเครื่อง หรือข้อมูลลับใด ๆ
- ระบุจุดหยุดทันทีเมื่อพบข้อมูลข้ามสิทธิ์ HTTP 500 stock/ยอดเงินผิด หรือ state หายหลัง restart

ระดับปัญหา:

- **Blocker:** ความเป็นส่วนตัว ข้อมูลสูญหาย stock/เงินผิด ปิด Visit ผิด chain หรือไม่สามารถจบ workflow
- **Important:** workflow ทำต่อได้แต่เสี่ยงทำงานผิดหรือข้อความ/สิทธิ์ทำให้เข้าใจผิด
- **Minor:** ความชัดเจน การจัดวาง หรือ copy ที่ไม่กระทบความถูกต้อง

## 8. Exit criteria

Pre-pilot UAT ผ่านเมื่อ:

- Scenario A–C ผ่านครบโดยไม่มี Blocker
- Safety checks ผ่านทั้งหมดและไม่มีข้อมูล clinical รั่วสู่ Assistant
- Restart สองจุดไม่ทำให้ state หรือ evidence เปลี่ยน
- stock movements, Charge, resolution และ Closure ตรงกับสิ่งที่ผู้ใช้ยืนยัน
- ผู้ใช้สามารถเดิน flow หลักได้โดยไม่ต้องรับคำสั่งทีละคลิกจากผู้พัฒนา
- Important findings ได้รับการแก้และทดสอบซ้ำ หรือผู้ใช้อนุมัติให้บันทึกเป็นข้อจำกัดของ rehearsal อย่างชัดเจน

หลังผ่าน UAT ให้หยุดเพื่อสรุปผลก่อนเริ่ม Pilot rehearsal หรือ Deployment Readiness ห้าม deploy อัตโนมัติ

## 9. การจัดการฐานข้อมูลหลัง UAT

- เก็บ UAT database ไว้ชั่วคราวเพื่อวิเคราะห์ผลจนกว่าผู้ใช้จะอนุมัติการล้าง
- การ reset ต้องใช้ guarded synthetic reset command กับ UAT database ที่ระบุอย่างชัดเจน และทำเมื่อ Clinic Host หยุดแล้วเท่านั้น
- ฐานข้อมูลเก่าจะถูกลบได้ต่อเมื่อผู้ใช้ระบุเป้าหมายและอนุมัติการลบแยกต่างหาก

## 10. Deliverables

- ฐานข้อมูล UAT ใหม่และบัญชี Assistant/Doctor แบบ named accounts
- คู่มือทดสอบภาษาไทยแบบทีละคลิกสำหรับผู้ทดลอง
- UAT checklist พร้อมข้อมูลตัวอย่าง Expected/Actual/Result และช่อง PASS/FAIL/BLOCKED
- ส่วนเตรียมระบบสำหรับผู้ดูแลที่แยกจากคู่มือผู้ทดลองอย่างชัดเจน
- บันทึก defect หรือข้อสังเกต UX พร้อมหลักฐานสังเคราะห์
- สรุป PASS/FAIL และคำแนะนำว่าจะเข้าสู่ Pilot rehearsal หรือแก้ไขก่อน
