# คู่มือติดตั้ง CareFlow บน Windows 11 สำหรับผู้เริ่มต้น

> **SYNTHETIC UAT ONLY - ใช้ข้อมูลสังเคราะห์และเครื่องทดสอบภายในเครื่องเท่านั้น**
>
> คู่มือนี้ไม่ใช่การ deploy ระบบจริง ห้ามใช้ข้อมูลผู้ป่วยจริง ข้อมูลทางคลินิกจริง หรือข้อมูลการเงินจริง และห้ามเปิดระบบออกสู่เครือข่าย ห้ามใช้ข้อมูลการเงินจริง

## ผลลัพธ์เมื่อทำครบ

- CareFlow เปิดเฉพาะที่ `http://127.0.0.1:3001`
- เข้าสู่ระบบด้วย `uat-assistant` ใน Browser Profile สำหรับผู้ช่วยได้
- เข้าสู่ระบบด้วย `uat-doctor` ใน Browser Profile สำหรับแพทย์ได้
- พร้อมเปิดคู่มือ UAT ทั้ง 5 Scenario โดยใช้ฐานข้อมูลเดิม

## คำศัพท์ก่อนเริ่ม

- **PowerShell:** หน้าต่างที่ใช้วางคำสั่งบน Windows
- **Repository:** โฟลเดอร์โครงการ CareFlow ที่ดาวน์โหลดจาก GitHub
- **Clone:** การดาวน์โหลด Repository ลงเครื่องด้วย Git
- **Dependency:** โปรแกรมย่อยที่ CareFlow ต้องใช้
- **Migration:** การสร้างโครงสร้างฐานข้อมูล SQLite ตามรุ่นที่ถูกต้อง
- **Host:** โปรแกรม CareFlow ที่กำลังเปิดอยู่ในหน้าต่าง PowerShell
- **Browser Profile:** โปรไฟล์เบราว์เซอร์ที่แยก session ของผู้ช่วยและแพทย์
- **UAT:** การทดลองใช้งานตาม Scenario ก่อน Pilot

ใช้บัญชี Windows UAT เฉพาะที่ไม่ใช่ผู้ดูแล และเปิด PowerShell ปกติ ไม่เลือก Run as administrator. หากค่า RunningAsAdministrator เป็น True ให้หยุดและแจ้งผู้ดูแล

## Checkpoint 1 - ตรวจเครื่อง Windows

### เป้าหมาย

ยืนยันว่าเป็น Windows 11 x64 พร้อม Node.js 22 และ Git

### ทำตามนี้

ที่ Settings > System > About ตรวจ Windows 11 และ System type เป็น 64-bit; ตรวจบัญชีที่ Settings > Accounts > Your info แล้วใน PowerShell ปกติรัน:

~~~powershell
node --version
git --version
~~~

### ผลที่ต้องเห็น

เห็น Node.js 22, รุ่น Git และบัญชี non-administrator

### ถ้าไม่ตรงให้หยุด

แจ้งผู้ดูแล ห้ามใช้บัญชีผู้ดูแล, WSL หรือ Docker.

## Checkpoint 2 - เลือกโฟลเดอร์ภายในเครื่อง

### เป้าหมาย

ใช้ local NTFS ที่ไม่ sync หรือแชร์

### ทำตามนี้

ใช้ตำแหน่ง %LOCALAPPDATA%\CareFlow-UAT-Source เท่านั้น ต้องไม่อยู่ใน OneDrive, network drive, shared profile, WSL, symlink หรือ junction และต้องไม่มี source folder เดิม.

### ผลที่ต้องเห็น

ยืนยันได้ว่าเป็น local NTFS และยังไม่มีโฟลเดอร์ CareFlow เดิม

### ถ้าไม่ตรงให้หยุด

ห้ามลบหรือย้ายของเดิม; แจ้งผู้ดูแล.

## Checkpoint 3 - ดาวน์โหลด CareFlow จาก GitHub

### เป้าหมาย

ได้ checkout ใหม่บน branch main

### ทำตามนี้

~~~powershell
$sourceRoot = Join-Path $env:LOCALAPPDATA 'CareFlow-UAT-Source'
if (Test-Path -LiteralPath $sourceRoot -PathType Any) {
  throw 'CareFlow source folder already exists; installation is BLOCKED'
}
git clone https://github.com/ajbk/careflow-clinic.git "$sourceRoot"
Set-Location -LiteralPath $sourceRoot -ErrorAction Stop
git switch main
git pull --ff-only
git status --short --branch
~~~

### ผลที่ต้องเห็น

คำสั่งสุดท้ายแสดง main โดยไม่มี error หรือไฟล์แก้ไขค้าง

### ถ้าไม่ตรงให้หยุด

เมื่อเห็น BLOCKED, clone ล้มเหลว, branch ไม่ใช่ main หรือมีไฟล์ค้าง ให้หยุดและแจ้งผู้ดูแล.

## Checkpoint 4 - ติดตั้ง dependencies

### เป้าหมาย

เข้าสู่ careflow-pilot ที่ตรวจสอบแล้วและติดตั้ง packages โดยไม่รัน lifecycle scripts

### ทำตามนี้

วาง block นี้ตามตัวอักษร:

~~~powershell
$startingDirectory = [System.IO.Path]::GetFullPath((Get-Location).Path)
$pilotRoot = if ([System.IO.Path]::GetFileName($startingDirectory) -eq 'careflow-pilot') {
  $startingDirectory
} else {
  [System.IO.Path]::GetFullPath((Join-Path $startingDirectory 'careflow-pilot'))
}
$pilotManifest = [System.IO.Path]::GetFullPath((Join-Path $pilotRoot 'package.json'))
if (-not (Test-Path -LiteralPath $pilotManifest -PathType Leaf -ErrorAction Stop)) {
  throw 'CareFlow pilot root not found; UAT is BLOCKED'
}
$pilotPackage = Get-Content -LiteralPath $pilotManifest -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
if ($pilotPackage.name -ne 'careflow-pilot') {
  throw 'CareFlow pilot root is invalid; UAT is BLOCKED'
}
Set-Location -LiteralPath $pilotRoot -ErrorAction Stop
npm ci --ignore-scripts
~~~

### ผลที่ต้องเห็น

ติดตั้งจบโดยไม่มี error และ prompt อยู่ใน careflow-pilot

### ถ้าไม่ตรงให้หยุด

ทำเครื่องหมาย UAT เป็น BLOCKED; ห้ามใช้ npm ci แบบอื่นหรือติดตั้ง compiler.

## Checkpoint 5 - ตรวจ native runtime

### เป้าหมาย

ตรวจว่า native packages ทำงานบน Windows เครื่องนี้

### ทำตามนี้

~~~powershell
npm run verify:native-runtime
~~~

### ผลที่ต้องเห็น

คำสั่งจบโดยไม่มี error

### ถ้าไม่ตรงให้หยุด

ทำเครื่องหมาย UAT เป็น BLOCKED; ห้ามติดตั้ง Visual Studio, node-gyp หรือ compiler.

## Checkpoint 6 - ทดสอบและ build

### เป้าหมาย

ตรวจ source ก่อนสร้างข้อมูล UAT

### ทำตามนี้

~~~powershell
npm test
npm run lint
npm run typecheck
npm run build
~~~

### ผลที่ต้องเห็น

ทั้งสี่คำสั่งจบโดยไม่มี failure หรือ error

### ถ้าไม่ตรงให้หยุด

ทำเครื่องหมาย UAT เป็น BLOCKED; ห้ามแก้ source, migration หรือ workflow ระหว่างการติดตั้ง.

## Checkpoint 7 - สร้างพื้นที่ฐานข้อมูลที่จำกัดสิทธิ์

### เป้าหมาย

สร้าง data\uat ใหม่ด้วย DACL ที่มีเพียงบัญชี UAT ปัจจุบันและ Administrators

### ทำตามนี้

ใน PowerShell เดิม วาง block นี้ตามตัวอักษร:

~~~powershell
$uatDir = [System.IO.Path]::GetFullPath((Join-Path $pilotRoot 'data\uat'))
$uatDb = [System.IO.Path]::GetFullPath((Join-Path $uatDir 'careflow-uat.sqlite'))
$uatParent = [System.IO.Path]::GetDirectoryName($uatDir)
New-Item -ItemType Directory -Path $uatParent -Force -ErrorAction Stop | Out-Null
if (Test-Path -LiteralPath $uatDir -PathType Any -ErrorAction Stop) { throw 'Use a new UAT directory' }
New-Item -ItemType Directory -Path $uatDir -ErrorAction Stop | Out-Null
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$administratorsSid = 'S-1-5-32-544'
$expectedSids = @($currentSid, $administratorsSid)
$inheritanceFlags = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$uatAcl = [System.Security.AccessControl.DirectorySecurity]::new()
$uatAcl.SetAccessRuleProtection($true, $false)
foreach ($sid in $expectedSids) {
  $identity = [System.Security.Principal.SecurityIdentifier]::new($sid)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritanceFlags,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void]$uatAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $uatDir -AclObject $uatAcl -ErrorAction Stop

$actualAcl = Get-Acl -LiteralPath $uatDir -ErrorAction Stop
$actualRules = @($actualAcl.Access)
$invalidRules = @($actualRules | Where-Object {
  $ruleSid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  $ruleSid -notin $expectedSids -or
  $_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
  $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
  $_.InheritanceFlags -ne $inheritanceFlags -or
  $_.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or
  $_.IsInherited
})
$missingSids = @($expectedSids | Where-Object {
  $expectedSid = $_
  -not ($actualRules | Where-Object {
    $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $expectedSid
  })
})
if (-not $actualAcl.AreAccessRulesProtected -or
    $actualRules.Count -ne $expectedSids.Count -or
    $invalidRules.Count -ne 0 -or
    $missingSids.Count -ne 0) {
  throw 'UAT directory ACL validation failed; UAT is BLOCKED'
}
& icacls.exe $uatDir
if ($LASTEXITCODE -ne 0) { throw 'UAT directory ACL display failed; UAT is BLOCKED' }
~~~

### ผลที่ต้องเห็น

ไม่มี error และ icacls.exe แสดงเฉพาะ trustee ที่กำหนด

### ถ้าไม่ตรงให้หยุด

หากมีโฟลเดอร์เดิมหรือ ACL validation ล้มเหลว ให้ BLOCKED; ห้ามลบโฟลเดอร์หรือผ่อนสิทธิ์.

## Checkpoint 8 - สร้างโครงสร้างฐานข้อมูล

### เป้าหมาย

migrate ฐานข้อมูลใหม่ที่ $uatDb เดิม

### ทำตามนี้

วาง block นี้ตามตัวอักษร:

~~~powershell
$env:CAREFLOW_DB_PATH = $uatDb
$env:CAREFLOW_HOST = '127.0.0.1'
$env:CAREFLOW_PORT = '3001'
$env:CAREFLOW_COOKIE_SECURE = 'false'
npm run db:migrate -- "$uatDb"
if ($LASTEXITCODE -ne 0) { throw 'UAT migration failed' }
~~~

### ผลที่ต้องเห็น

migration จบโดยไม่มี error; บันทึก OS, รุ่น Node, $uatDb และผล icacls.exe ใน checklist โดยไม่บันทึกข้อมูลลับ

### ถ้าไม่ตรงให้หยุด

ทำเครื่องหมาย UAT เป็น BLOCKED; ห้าม reset, เปลี่ยน path หรือใช้ฐานข้อมูลเดิม.

## Checkpoint 9 - สร้างสองบัญชี UAT

### เป้าหมาย

สร้างเพียง uat-assistant และ uat-doctor ก่อนเปิด host

### ทำตามนี้

ใน PowerShell เดิมที่มี CAREFLOW_DB_PATH แล้ว รันตามลำดับครั้งละหนึ่งคำสั่ง ยอมรับ SYNTHETIC-ONLY และใช้ hidden terminal input สำหรับ New password และ Confirm new password; อย่าวางหรือบันทึกข้อมูลลับ:

~~~powershell
npm run users -- create --username uat-assistant --display-name Assistant --role assistant
npm run users -- create --username uat-doctor --display-name Doctor --role doctor
~~~

### ผลที่ต้องเห็น

แต่ละคำสั่งจบด้วย User account command completed และมีเพียงสองบัญชีนี้

### ถ้าไม่ตรงให้หยุด

เมื่อ provisioning failure ให้ BLOCKED; ห้ามสร้างบัญชีอื่นหรือรัน create command ซ้ำ.

## Checkpoint 10 - เปิดระบบและเข้าสู่ระบบสองบทบาท

### เป้าหมาย

เปิด host เฉพาะ loopback, ตรวจ health และยืนยัน workspace ตาม role

### ทำตามนี้

ให้คงหน้าต่างนี้เป็น host PowerShell แล้วรัน:

~~~powershell
$env:CAREFLOW_HOST = '127.0.0.1'
$env:CAREFLOW_PORT = '3001'
$env:CAREFLOW_COOKIE_SECURE = 'false'
npm start
~~~

เมื่อ host ทำงาน เปิด PowerShell ภายในเครื่องหน้าต่างที่สองและรัน:

~~~powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -Method Get
~~~

#### เข้าสู่ระบบครั้งแรก

1. ให้หน้าต่าง host PowerShell ที่กำลังรัน npm start เปิดอยู่
2. เปิด Edge หรือ Chrome สอง Browser Profile ที่แยกกัน
3. ในแต่ละ Browser Profile ให้เปิด `http://127.0.0.1:3001`
4. ลงชื่อเข้าใช้ครั้งเดียวด้วย uat-assistant และครั้งเดียวด้วย uat-doctor โดยไม่บันทึกข้อมูลลับ
5. ยอมรับ Pilot acknowledgement และเปลี่ยน initial password ผ่าน first-login UI ที่แสดง
6. ยืนยันว่า Assistant ไปยัง Assistant workspace และ Doctor ไปยัง Doctor workspace ที่ถูกต้อง

### ผลที่ต้องเห็น

health check สำเร็จ และ browser เปิดเฉพาะ http://127.0.0.1:3001

### ถ้าไม่ตรงให้หยุด

หาก health check หรือ first login ไม่ตรง ให้ BLOCKED; อย่าเปิด port สู่เครือข่าย เก็บฐานข้อมูลเดิมไว้ และกลับไปใช้ Administrator runbook เท่านั้น.

## หยุด CareFlow อย่างปลอดภัย

กลับไปที่หน้าต่าง PowerShell ที่กำลังรัน `npm start` แล้วกด `Ctrl+C` หนึ่งครั้ง รอจน prompt `PS ...>` กลับมา ห้ามลบไฟล์ `.sqlite`, `-wal`, `-shm` หรือโฟลเดอร์ lock เพื่อบังคับหยุดระบบ

## ขั้นถัดไป: เริ่ม UAT

เมื่อทั้งสองบัญชีเข้าสู่ระบบได้ ให้ใช้ฐานข้อมูลเดิมและทำตาม [คู่มือ UAT Journey ทั้ง 5 Scenario](guide-th.md) พร้อมบันทึกผลใน [UAT checklist](checklist.md) หากต้อง restart, ตรวจ session expiry หรือแก้สถานะ `BLOCKED` ให้กลับไปใช้ [Administrator runbook](admin-runbook.md) เท่านั้น
