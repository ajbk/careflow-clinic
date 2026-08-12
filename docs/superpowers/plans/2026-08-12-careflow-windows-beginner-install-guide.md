# CareFlow Windows Beginner Installation Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a beginner-readable Thai Windows 11 installation guide in Markdown and A4 PDF that ends with successful sign-in for the approved Assistant and Doctor UAT roles.

**Architecture:** Treat the existing Windows administrator runbook as the operational source of truth. Add a strict documentation contract test, write one primary Markdown guide organized as ten observable checkpoints, and render that source into a visually verified PDF without changing application or database behavior.

**Tech Stack:** Markdown, PowerShell 5.1-compatible commands, Vitest, Python 3, ReportLab 4, Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), Git, GitHub CLI.

## Global Constraints

- Windows target is Windows 11 x64 with Node.js 22 and Git installed.
- Run under a dedicated non-administrator Windows account on local NTFS storage.
- Do not use OneDrive, a network/shared drive, WSL, a symlink, or a junction.
- Bind CareFlow only to `127.0.0.1:3001`.
- Use only synthetic data; deployment, backup/restore, Windows service installation, HTTPS, and real-data use remain disabled.
- Create exactly `uat-assistant` and `uat-doctor` through hidden interactive password prompts before host startup.
- Never include a password value in commands, environment variables, files, screenshots, tickets, logs, Markdown, or PDF.
- Native-runtime, ACL, migration, test, health, or first-login failure makes the installation `BLOCKED`; never weaken a check or improvise repair steps.
- Keep `docs/uat/careflow-pre-pilot/admin-runbook.md` authoritative for operational recovery and the five-scenario UAT procedure separate in `guide-th.md`.
- Do not modify application source, migrations, snapshots, frozen demo files, or workflow behavior.

## File Structure

- Create `docs/uat/careflow-pre-pilot/windows-install-guide-th.md` as the primary beginner guide.
- Create `output/pdf/careflow-windows-install-guide-th.pdf` as the offline A4 rendering.
- Modify `careflow-pilot/tests/server/windows-platform-contract.test.ts` to enforce guide structure, exact safety boundaries, and discoverability.
- Modify `docs/uat/careflow-pre-pilot/admin-runbook.md` to link to the beginner guide without replacing technical instructions.
- Modify `careflow-pilot/README.md` to make the beginner guide discoverable from the Windows quick-start section.
- Create and later remove `tmp/pdfs/render_windows_install_guide_pdf.py` plus rendered PNG intermediates; these are QA support only and must not be committed.

---

### Task 1: Add a Failing Beginner-Guide Contract

**Files:**
- Modify: `careflow-pilot/tests/server/windows-platform-contract.test.ts`
- Test: `careflow-pilot/tests/server/windows-platform-contract.test.ts`

**Interfaces:**
- Consumes: `readRepositoryFile(path: string): string` already defined in the test module.
- Produces: A contract requiring ten checkpoint headings, exact UAT commands, safety language, guide links, and absence of embedded credentials/network exposure.

- [ ] **Step 1: Add the guide contract test**

Append this test inside `describe("native Windows platform contract", ...)`:

```ts
it("publishes a beginner Windows installation guide without weakening UAT safety", () => {
  const guidePath = "docs/uat/careflow-pre-pilot/windows-install-guide-th.md";
  const guide = readRepositoryFile(guidePath);
  const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
  const readme = readRepositoryFile("careflow-pilot/README.md");

  const checkpointTitles = [
    "Checkpoint 1 - ตรวจเครื่อง Windows",
    "Checkpoint 2 - เลือกโฟลเดอร์ภายในเครื่อง",
    "Checkpoint 3 - ดาวน์โหลด CareFlow จาก GitHub",
    "Checkpoint 4 - ติดตั้ง dependencies",
    "Checkpoint 5 - ตรวจ native runtime",
    "Checkpoint 6 - ทดสอบและ build",
    "Checkpoint 7 - สร้างพื้นที่ฐานข้อมูลที่จำกัดสิทธิ์",
    "Checkpoint 8 - สร้างโครงสร้างฐานข้อมูล",
    "Checkpoint 9 - สร้างสองบัญชี UAT",
    "Checkpoint 10 - เปิดระบบและเข้าสู่ระบบสองบทบาท",
  ] as const;

  for (const title of checkpointTitles) expect(guide).toContain(title);
  for (const required of [
    "SYNTHETIC UAT ONLY",
    "RunningAsAdministrator",
    "git clone https://github.com/ajbk/careflow-clinic.git",
    "npm ci --ignore-scripts",
    "npm run verify:native-runtime",
    "npm test",
    "npm run lint",
    "npm run typecheck",
    "npm run build",
    "$administratorsSid = 'S-1-5-32-544'",
    "npm run db:migrate -- \"$uatDb\"",
    "--username uat-assistant",
    "--username uat-doctor",
    "$env:CAREFLOW_HOST = '127.0.0.1'",
    "Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health'",
    "http://127.0.0.1:3001",
    "guide-th.md",
  ]) {
    expect(guide).toContain(required);
  }

  expect(guide).not.toMatch(/(?:password|รหัสผ่าน)\s*[=:]\s*\S+/i);
  expect(guide).not.toContain("0.0.0.0");
  expect(guide).toContain("ห้ามใช้ข้อมูลผู้ป่วยจริง");
  expect(guide).toContain("ห้ามใช้ข้อมูลการเงินจริง");
  expect(runbook).toContain("[คู่มือติดตั้ง Windows สำหรับผู้เริ่มต้น](windows-install-guide-th.md)");
  expect(readme).toContain("[คู่มือติดตั้ง Windows สำหรับผู้เริ่มต้น]");
});
```

- [ ] **Step 2: Run the focused test and record RED**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
```

Expected: FAIL because `windows-install-guide-th.md` does not exist. Existing Windows contract cases must remain passing.

- [ ] **Step 3: Commit only the failing contract**

```bash
git add careflow-pilot/tests/server/windows-platform-contract.test.ts
git commit -m "test: require beginner Windows installation guide"
```

### Task 2: Write the Ten-Checkpoint Markdown Guide

**Files:**
- Create: `docs/uat/careflow-pre-pilot/windows-install-guide-th.md`
- Modify: `docs/uat/careflow-pre-pilot/admin-runbook.md`
- Modify: `careflow-pilot/README.md`
- Test: `careflow-pilot/tests/server/windows-platform-contract.test.ts`

**Interfaces:**
- Consumes: Exact Windows bootstrap, DACL, migration, provisioning, host, and health commands from `admin-runbook.md`.
- Produces: The primary Markdown source consumed by the PDF task and linked by the README/runbook.

- [ ] **Step 1: Create the guide shell with fixed safety language**

Start the file with these exact sections:

```markdown
# คู่มือติดตั้ง CareFlow บน Windows 11 สำหรับผู้เริ่มต้น

> **SYNTHETIC UAT ONLY - ใช้ข้อมูลสังเคราะห์และเครื่องทดสอบภายในเครื่องเท่านั้น**
>
> คู่มือนี้ไม่ใช่การ deploy ระบบจริง ห้ามใช้ข้อมูลผู้ป่วยจริง ข้อมูลทางคลินิกจริง หรือข้อมูลการเงินจริง และห้ามเปิดระบบออกสู่เครือข่าย

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
```

- [ ] **Step 2: Add all ten checkpoints using one repeated pattern**

For each checkpoint, use the headings required by Task 1 and the subheadings `เป้าหมาย`, `ทำตามนี้`, `ผลที่ต้องเห็น`, and `ถ้าไม่ตรงให้หยุด`. Use the runbook blocks verbatim for:

- validated `$pilotRoot` bootstrap;
- `npm ci --ignore-scripts` and native probe;
- exact fresh-directory and protected two-SID DACL creation/validation;
- `$uatDb` environment and migration;
- interactive creation of `uat-assistant` and `uat-doctor`;
- loopback host startup and health inspection.

The clone checkpoint must use:

```powershell
$sourceRoot = Join-Path $env:LOCALAPPDATA 'CareFlow-UAT-Source'
if (Test-Path -LiteralPath $sourceRoot -PathType Any) {
  throw 'CareFlow source folder already exists; installation is BLOCKED'
}
git clone https://github.com/ajbk/careflow-clinic.git "$sourceRoot"
Set-Location -LiteralPath $sourceRoot -ErrorAction Stop
git switch main
git pull --ff-only
git status --short --branch
```

The first-login subsection must instruct the operator to:

1. Keep the host PowerShell window open.
2. Open two distinct Edge or Chrome profiles.
3. Sign in once as `uat-assistant` and once as `uat-doctor` without recording either password.
4. Accept the Pilot acknowledgement and change the initial password through the displayed first-login UI.
5. Confirm Assistant and Doctor land in their role-correct workspaces.

- [ ] **Step 3: Add explicit safe-stop and next-guide sections**

End with:

```markdown
## หยุด CareFlow อย่างปลอดภัย

กลับไปที่หน้าต่าง PowerShell ที่กำลังรัน `npm start` แล้วกด `Ctrl+C` หนึ่งครั้ง รอจน prompt `PS ...>` กลับมา ห้ามลบไฟล์ `.sqlite`, `-wal`, `-shm` หรือโฟลเดอร์ lock เพื่อบังคับหยุดระบบ

## ขั้นถัดไป: เริ่ม UAT

เมื่อทั้งสองบัญชีเข้าสู่ระบบได้ ให้ใช้ฐานข้อมูลเดิมและทำตาม [คู่มือ UAT Journey ทั้ง 5 Scenario](guide-th.md) พร้อมบันทึกผลใน [UAT checklist](checklist.md) หากต้อง restart, ตรวจ session expiry หรือแก้สถานะ `BLOCKED` ให้กลับไปใช้ [Administrator runbook](admin-runbook.md) เท่านั้น
```

- [ ] **Step 4: Link the guide from existing entry points**

Add this sentence near the opening of `admin-runbook.md`:

```markdown
ผู้ติดตั้งครั้งแรกควรเริ่มจาก [คู่มือติดตั้ง Windows สำหรับผู้เริ่มต้น](windows-install-guide-th.md) แล้วกลับมาใช้ runbook นี้เมื่อคู่มืออ้างถึงขั้นตอนผู้ดูแลหรือสถานะ `BLOCKED`.
```

Add this link under `### Windows 11 PowerShell` in `careflow-pilot/README.md`:

```markdown
หากเป็นการติดตั้งครั้งแรก ให้เริ่มจาก [คู่มือติดตั้ง Windows สำหรับผู้เริ่มต้น](../docs/uat/careflow-pre-pilot/windows-install-guide-th.md) ซึ่งแบ่งขั้นตอนเป็น Checkpoint พร้อมผลที่ต้องเห็นและจุดหยุดเมื่อไม่ผ่าน.
```

- [ ] **Step 5: Run the focused contract and confirm GREEN**

Run:

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
```

Expected: all Windows platform contract tests PASS.

- [ ] **Step 6: Commit the Markdown guide and links**

```bash
git add \
  docs/uat/careflow-pre-pilot/windows-install-guide-th.md \
  docs/uat/careflow-pre-pilot/admin-runbook.md \
  careflow-pilot/README.md
git commit -m "docs: add beginner Windows installation guide"
```

### Task 3: Render and Visually Verify the A4 PDF

**Files:**
- Create temporarily: `tmp/pdfs/render_windows_install_guide_pdf.py`
- Create: `output/pdf/careflow-windows-install-guide-th.pdf`
- Create temporarily: `tmp/pdfs/windows-install-guide-page-*.png`

**Interfaces:**
- Consumes: `docs/uat/careflow-pre-pilot/windows-install-guide-th.md` and the current Git revision from `git rev-parse --short HEAD`.
- Produces: A4 PDF with the same ordered headings, prose, lists, warnings, links, and PowerShell blocks.

- [ ] **Step 1: Create a temporary Markdown-to-ReportLab renderer**

Implement these concrete interfaces in `tmp/pdfs/render_windows_install_guide_pdf.py`:

```python
@dataclass(frozen=True)
class Block:
    kind: Literal["h1", "h2", "h3", "paragraph", "bullet", "number", "quote", "code"]
    text: str
    language: str | None = None

def parse_markdown(source: str) -> list[Block]:
    """Parse headings, paragraphs, bullets, numbered items, blockquotes, and fenced code in source order."""

def build_pdf(blocks: list[Block], output_path: Path, revision: str) -> None:
    """Render A4 portrait pages with Thai body text, code wrapping, headers, footers, and page numbers."""

def main() -> None:
    source = Path("docs/uat/careflow-pre-pilot/windows-install-guide-th.md")
    output = Path("output/pdf/careflow-windows-install-guide-th.pdf")
    revision = subprocess.check_output(
        ["git", "rev-parse", "--short", "HEAD"], text=True
    ).strip()
    blocks = parse_markdown(source.read_text(encoding="utf-8"))
    output.parent.mkdir(parents=True, exist_ok=True)
    build_pdf(blocks, output, revision)

if __name__ == "__main__":
    main()
```

Use ReportLab `TTFont(..., shapable=True)` with `/System/Library/Fonts/Supplemental/Tahoma.ttf` and `/System/Library/Fonts/Supplemental/Tahoma Bold.ttf` for Thai body/headings and built-in Courier for ASCII PowerShell. Use `wordWrap="CJK"` for Thai paragraphs, an A4 page template with 18 mm margins, `SYNTHETIC UAT ONLY` headers, and `หน้า N - revision <sha>` footers. Code blocks must be shaded and visually wrapped without changing the Markdown source.

- [ ] **Step 2: Generate the PDF with the bundled Python runtime**

Run:

```bash
mkdir -p tmp/pdfs output/pdf
/Users/ajbk/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  tmp/pdfs/render_windows_install_guide_pdf.py
```

Expected: `output/pdf/careflow-windows-install-guide-th.pdf` exists and is non-empty.

- [ ] **Step 3: Verify PDF structure and extracted content**

Run:

```bash
pdfinfo output/pdf/careflow-windows-install-guide-th.pdf
pdftotext output/pdf/careflow-windows-install-guide-th.pdf tmp/pdfs/windows-install-guide.txt
rg -n "Checkpoint 1|Checkpoint 10|uat-assistant|uat-doctor|127\.0\.0\.1:3001|SYNTHETIC UAT ONLY" \
  tmp/pdfs/windows-install-guide.txt
```

Expected: A4 page size, all ten checkpoints in order, both approved usernames, loopback URL, and safety banner are present.

- [ ] **Step 4: Render every page and inspect visually**

Run:

```bash
pdftoppm -png -r 150 \
  output/pdf/careflow-windows-install-guide-th.pdf \
  tmp/pdfs/windows-install-guide-page
```

Open every generated PNG with the image inspection tool. Reject and regenerate if any page has clipped commands, overlapping text, missing Thai marks, black glyph boxes, broken section transitions, inconsistent margins, or unreadably small code.

- [ ] **Step 5: Remove temporary renderer and QA intermediates**

Remove only the exact temporary files under `tmp/pdfs/` after the latest visual inspection. Preserve the final PDF under `output/pdf/`.

- [ ] **Step 6: Commit the verified PDF**

```bash
git add output/pdf/careflow-windows-install-guide-th.pdf
git commit -m "docs: add printable Windows installation guide"
```

### Task 4: Final Safety, Test, and Publishing Gate

**Files:**
- Verify: all Task 1-3 files
- Do not modify: application source, `careflow-pilot/drizzle/**`, `.github/workflows/**`, `careflow-webapp/**`, `stitch_careflow_clinic_management_system/**`

**Interfaces:**
- Consumes: committed Markdown, PDF, links, and contract test.
- Produces: a pushed documentation branch and a draft GitHub pull request ready for user review.

- [ ] **Step 1: Compare commands with the authoritative runbook**

Read the complete Windows preparation, provisioning, host, health, and restart sections in `admin-runbook.md`. Confirm the beginner guide preserves the same `$pilotRoot`, exact DACL, `$uatDb`, account, loopback, and fail-closed behavior.

- [ ] **Step 2: Run credential, placeholder, and unsafe-scope scans**

```bash
! rg -n "TBD|TODO|FIXME|(?:password|รหัสผ่าน)\s*[=:]\s*\S+|0\.0\.0\.0" \
  docs/uat/careflow-pre-pilot/windows-install-guide-th.md \
  tmp/pdfs/windows-install-guide.txt
rg -n "SYNTHETIC UAT ONLY|127\.0\.0\.1:3001|uat-assistant|uat-doctor" \
  docs/uat/careflow-pre-pilot/windows-install-guide-th.md \
  tmp/pdfs/windows-install-guide.txt
```

Expected: the negative scan exits successfully with no matches; the positive scan finds all four required terms in both representations. If temporary PDF text was removed in Task 3, regenerate only that extraction before this check and remove it afterward.

- [ ] **Step 3: Run focused and repository checks sequentially**

```bash
cd careflow-pilot
npx vitest run --config vitest.server.config.ts tests/server/windows-platform-contract.test.ts
npm run lint
npm run typecheck:server
npm run test:server
cd ..
git diff --check origin/main...HEAD
git diff --exit-code origin/main...HEAD -- careflow-pilot/drizzle .github/workflows careflow-webapp stitch_careflow_clinic_management_system
```

Expected: all tests and static checks pass, whitespace is clean, and frozen/migration scopes have no diff.

- [ ] **Step 4: Verify exact staged scope and final PDF hash**

```bash
shasum -a 256 output/pdf/careflow-windows-install-guide-th.pdf
git status --short
git diff --name-only origin/main...HEAD
git show --check --stat HEAD
```

Expected tracked scope:

```text
careflow-pilot/README.md
careflow-pilot/tests/server/windows-platform-contract.test.ts
docs/superpowers/plans/2026-08-12-careflow-windows-beginner-install-guide.md
docs/superpowers/specs/2026-08-12-careflow-windows-beginner-install-guide-design.md
docs/uat/careflow-pre-pilot/admin-runbook.md
docs/uat/careflow-pre-pilot/windows-install-guide-th.md
output/pdf/careflow-windows-install-guide-th.pdf
```

Leave the pre-existing untracked `.DS_Store` and `stitch_careflow_clinic_management_system/` untouched and unstaged.

- [ ] **Step 5: Push and open a draft pull request**

```bash
git push -u origin codex/windows-install-guide
gh pr create \
  --draft \
  --base main \
  --head codex/windows-install-guide \
  --title "docs: add beginner Windows installation guide" \
  --body-file /tmp/careflow-windows-guide-pr.md
```

The PR body must summarize both outputs, state that application/migration behavior is unchanged, list the fresh verification evidence, and link the Markdown guide plus downloadable PDF. Do not merge the PR without a separate explicit user request.
