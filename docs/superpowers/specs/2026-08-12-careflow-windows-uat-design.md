# CareFlow Native Windows CI and Local UAT Design

**วันที่:** 2026-08-12

**สถานะ:** อนุมัติแนวทางในบทสนทนาแล้ว รอผู้ใช้ตรวจเอกสารฉบับเขียนก่อนจัดทำ implementation plan

**ขอบเขต:** Native Windows 11 สำหรับ CI และ local synthetic-only UAT host; ไม่ใช่ deployment หรือ production hardening

## 1. เป้าหมาย

ทำให้ CareFlow Local Pilot:

1. ติดตั้ง dependency และผ่าน CI บน native Windows โดยไม่ใช้ WSL, Docker หรือการ compile native addon ที่ไม่จำเป็น
2. เปิดเป็น local UAT host บน Windows 11 ผ่าน PowerShell ได้ด้วยขั้นตอนที่ copy/paste ได้
3. ใช้ UAT Journey, บัญชี `uat-assistant`/`uat-doctor`, SQLite evidence, restart และ controlled session expiry ชุดเดียวกับ macOS/Linux
4. รักษาขอบเขต loopback-only, synthetic-only, role privacy, database identity, filesystem guards และ mandatory-stop rules เดิม

งานนี้ไม่เปลี่ยน clinical workflow, API contract, state machine, database schema หรือ migration history

## 2. หลักฐานและต้นเหตุ

Windows GitHub Actions ล้มเหลวระหว่าง `npm ci` ก่อนเริ่ม test โดย `npm` สร้าง implicit `node-gyp rebuild` ให้ `better-sqlite3@13.0.2` แม้ package จะประกาศ `gypfile: false` และมี `prebuilds/win32-x64.node` อยู่แล้ว จากนั้น `node-gyp` พยายามหา Visual Studio C++ workload และจบด้วย error

ต้นเหตุเป็นบั๊กของ lockfile-driven install ใน npm ไม่ใช่ CareFlow runtime:

- better-sqlite3 issue: <https://github.com/WiseLibs/better-sqlite3/issues/1503>
- npm CLI issue: <https://github.com/npm/cli/issues/9837>
- npm CLI fix ที่ยังไม่ release/merge: <https://github.com/npm/cli/pull/9859>

dependency native ที่เกี่ยวข้องทั้งหมดมี binary สำเร็จรูปสำหรับ Windows x64:

- `better-sqlite3@13.0.2`
- `argon2@0.45.1`
- `esbuild` packages ที่ lockfile ระบุ

การทดลอง clean install ใน directory ชั่วคราวด้วย `npm ci --ignore-scripts` ยืนยันว่า SQLite query, Argon2 load, esbuild load และ production build ทำงานครบ จึงไม่จำเป็นต้อง downgrade dependency หรือติดตั้ง C++ compiler เพื่อหลบ npm bug

## 3. แนวทางที่พิจารณา

### Option A — Prebuilt-only Windows install พร้อม explicit native verification — เลือกใช้

Windows ใช้ `npm ci --ignore-scripts` แล้วรัน probe ที่โหลดและใช้งาน native/runtime dependencies จริง ก่อนเข้าสู่ lint, typecheck, tests และ build

ข้อดี:

- ใช้ binary ที่ package ตั้งใจแจกจ่าย
- ไม่พึ่ง Visual Studio image/version
- เร็วและ deterministic กว่าการ compile
- ลดการรัน third-party lifecycle scripts ระหว่าง install
- probe และ test ทำให้การขาด binary ล้มเหลวทันทีแบบชัดเจน

ข้อแลกเปลี่ยนคือ Windows จะไม่รัน lifecycle script ใดระหว่าง install จึงต้องมี explicit verification ครบทุก native/runtime boundary ที่ CareFlow ใช้

### Option B — ติดตั้ง Visual Studio Build Tools แล้ว compile native addons

ไม่เลือก เพราะ runner ต้องติดตั้ง C++ workload ขนาดใหญ่, ใช้เวลานาน, ผูกกับ Visual Studio discovery ของ `node-gyp`, และ compile สิ่งที่มี prebuilt binary อยู่แล้ว

### Option C — Downgrade better-sqlite3 หรือใช้ npm patch ที่ยังไม่ release

ไม่เลือก เพราะทำให้ application dependency ถอยเวอร์ชันหรือผูกกับ toolchain commit ที่ยังไม่เผยแพร่ โดยไม่ได้เพิ่มคุณค่าทางผลิตภัณฑ์

## 4. ขอบเขตระบบ

### 4.1 อยู่ในขอบเขต

- Windows GitHub Actions บน `windows-latest`, Node 22 และ npm lockfile เดิม
- explicit native runtime probe สำหรับ SQLite, password hashing และ TypeScript build transform
- Windows CI ที่รัน probe, lint, typecheck, server tests และ production build
- Windows 11 PowerShell instructions สำหรับ:
  - dependency install และ native verification
  - UAT data directory และ ACL
  - migration ด้วย absolute Windows path
  - interactive account provisioning โดยไม่ใส่ password ใน command/history/docs
  - loopback-only host startup และ health check
  - planned restart และ stale-lock inspection
  - controlled Doctor session expiry
- เอกสารหลักที่แยกคำสั่ง POSIX และ PowerShell ชัดเจน
- regression tests สำหรับ native probe, Windows CI contract และ runbook contract

### 4.2 ไม่อยู่ในขอบเขต

- Windows Service, installer, auto-start หรือ background daemon
- LAN/WAN exposure, firewall opening, reverse proxy, HTTPS หรือ Caddy
- deployment, production readiness หรือ real Patient data
- backup/restore, encryption-at-rest หรือ off-device replication
- browser automation บน Windows; Chromium E2E เต็มชุดยังรันบน Ubuntu และ Windows CI ตรวจ native server/build boundary
- เปลี่ยน package manager, downgrade dependency หรือ patch npm จาก unreleased source
- เปลี่ยน schema/migration หรือ application behavior

## 5. Windows installation boundary

### 5.1 Canonical commands

บน Windows เท่านั้น ใช้:

```powershell
npm ci --ignore-scripts
npm run verify:native-runtime
```

macOS/Linux และ frozen demo workflow ยังใช้ `npm ci` ตามเดิม เพื่อไม่ขยาย workaround เกิน platform ที่ได้รับผลกระทบ

### 5.2 Native runtime probe

เพิ่มคำสั่ง `verify:native-runtime` ที่ไม่รับ path, credential หรือ Patient data และไม่สร้าง persistent file โดยต้อง:

1. เปิด SQLite `:memory:` ผ่าน `better-sqlite3`
2. เขียนและอ่านแถวทดสอบใน transaction
3. hash และ verify byte buffer สังเคราะห์ผ่าน `argon2` โดยไม่พิมพ์ hash/secret
4. transform TypeScript snippet ผ่าน `esbuild`
5. พิมพ์ข้อความสำเร็จแบบคงที่และ exit 0 เฉพาะเมื่อครบทุก boundary
6. ปล่อย exception และ exit non-zero ถ้า binary/load/runtime ใดผิด

probe นี้ไม่แทน unit tests หรือ build; เป็น fail-fast contract หลัง install แบบไม่รัน lifecycle scripts

## 6. Windows CI

ปรับเฉพาะ job `Local Pilot (native Windows)`:

1. checkout
2. setup Node 22 พร้อม npm cache เดิม
3. `npm ci --ignore-scripts`
4. `npm run verify:native-runtime`
5. `npm run lint`
6. `npm run typecheck`
7. `npm run test:server`
8. `npm run build`

Linux jobs ไม่เปลี่ยน install semantics และ Windows ยังคงเป็น native Node/SQLite ไม่ใช้ WSL/Docker

CI ต้อง fail ถ้า probe ไม่พบ prebuilt binary, Argon2 ใช้งานไม่ได้, esbuild ใช้งานไม่ได้, server tests ล้มเหลว หรือ built bundle สร้างไม่ได้

## 7. Windows local UAT host

### 7.1 Supported rehearsal profile

- Windows 11 x64
- Node.js `>=22.13.0`
- PowerShell
- repository checkout บน local NTFS path
- dedicated local UAT Windows account ที่ไม่มีการใช้งานทั่วไป
- Chrome profiles แยก Assistant และ Doctor
- bind เฉพาะ `127.0.0.1:3001`

### 7.2 Data directory and ACL

PowerShell runbook ต้อง:

- resolve UAT DB เป็น absolute path `<repo>\careflow-pilot\data\uat\careflow-uat.sqlite`
- สร้าง `data\uat` ก่อน migrate
- ปิด ACL inheritance ของ directory
- ให้ Full Control เฉพาะ SID ของ dedicated UAT account และ built-in Administrators SID
- แสดงคำสั่งตรวจ ACL
- ห้ามใช้ shared directory, OneDrive/network path, symlink/junction หรือ path ของฐานข้อมูลเดิม

Application guards เดิมยังตรวจ regular file, symlink/alias, host lock, maintenance lock และ exact database identity ส่วน ACL เป็น operator precondition ที่ runbook บังคับและให้บันทึกผล

### 7.3 UAT lifecycle

PowerShell section ต้องให้คำสั่งที่เทียบเท่า POSIX flow เดิม:

- set `$env:CAREFLOW_DB_PATH`, `$env:CAREFLOW_HOST`, `$env:CAREFLOW_PORT`, `$env:CAREFLOW_COOKIE_SECURE`
- migrate exact absolute path
- create exactly `uat-assistant` และ `uat-doctor` ผ่าน hidden interactive prompt
- `npm start`
- health check ด้วย `Invoke-RestMethod`
- ตรวจ listener/process ก่อน restart หรือ maintenance
- restart ด้วย DB path เดิม
- controlled session expiry ด้วย `--database "$uatDb"`

ทุก Scenario ใช้ Thai Journey guide/checklist เดิมและ database เดิมโดยไม่ reset ระหว่าง Scenario

## 8. Security and failure behavior

- ไม่เก็บ password ใน `.env`, PowerShell history, command arguments, docs, log หรือ checklist
- probe ใช้ข้อมูลสังเคราะห์ใน memory เท่านั้น
- host bind loopback เท่านั้น
- Windows ACL ไม่แทน application authorization; role/privacy checks เดิมยังบังคับ
- ถ้า native probe ล้มเหลว ห้ามข้าม probe, ห้าม install compiler แบบเฉพาะกิจ และห้ามเริ่ม UAT
- ถ้า ACL, absolute path, migration, provisioning, health หรือ host-lock check ล้มเหลว ให้ mark UAT `BLOCKED`
- mandatory-stop rules เดิมยังหยุด UAT ทั้งชุดสำหรับ HTTP 500, clinical leakage, negative stock, wrong Baht total, invalid Closure หรือ committed evidence loss

## 9. Test strategy

ทำแบบ RED → GREEN:

1. native probe test ล้มเหลวเมื่อ module/probe contract ยังไม่มี
2. CI contract test/static assertion ล้มเหลวเมื่อ Windows job ยังใช้ `npm ci` ปกติหรือไม่มี probe
3. runbook contract test ล้มเหลวเมื่อไม่มี PowerShell install, ACL, absolute DB, provisioning, health, restart และ expiry instructions
4. implement probe/workflow/docs ขั้นต่ำ
5. focused tests ผ่าน
6. รัน server suite, client suite, lint, typecheck, build, migration identity และ E2E เดิม
7. push แล้วใช้ GitHub Windows job เป็นหลักฐาน native Windows GREEN จริง

Local macOS verification พิสูจน์ logic และเอกสารได้ แต่ไม่ถือเป็นหลักฐาน Windows สำเร็จจนกว่า `Local Pilot (native Windows)` บน GitHub Actions จะผ่าน

## 10. Acceptance criteria

งานนี้เสร็จเมื่อ:

- Windows CI install ไม่เรียก `node-gyp` และผ่าน native probe
- Windows CI lint/typecheck/server tests/build ผ่าน
- Ubuntu frozen demo และ Pilot Chromium jobs ยังผ่าน
- Windows PowerShell runbook เริ่มจาก clean checkout/clean UAT DB ได้โดยไม่ใช้ POSIX command
- runbook ครอบคลุม ACL, migrate, two-account provisioning, host, health, restart, controlled expiry และ stop rules
- ไม่มี password/credential value, SQLite/WAL/SHM, build artifact หรือ migration change ถูก commit
- UAT ยังเป็น local synthetic-only และทุก deployment/backup/real-data capability ยังถูกระบุว่า disabled
