import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
const readRepositoryFile = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), "utf8");

function windowsJob(): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const marker = "  pilot-windows:";
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error("pilot-windows job is missing");
  return workflow.slice(start);
}

describe("native Windows platform contract", () => {
  it("installs prebuilt packages before probing the native runtime", () => {
    const job = windowsJob();
    const installIndex = job.indexOf("- run: npm ci --ignore-scripts");
    const probeIndex = job.indexOf("- run: npm run verify:native-runtime");

    expect(job).toContain("runs-on: windows-latest");
    expect(installIndex).toBeGreaterThan(-1);
    expect(probeIndex).toBeGreaterThan(installIndex);
    expect(job).not.toContain("npm ci\n");
    expect(job).not.toMatch(/Visual Studio|node-gyp|WSL|Docker/i);
  });

  it("documents one complete PowerShell UAT lifecycle without credentials", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const guide = readRepositoryFile("docs/uat/careflow-pre-pilot/guide-th.md");
    const checklist = readRepositoryFile("docs/uat/careflow-pre-pilot/checklist.md");
    const readme = readRepositoryFile("careflow-pilot/README.md");

    for (const required of [
      "## Windows 11 PowerShell",
      "npm ci --ignore-scripts",
      "npm run verify:native-runtime",
      "[System.IO.Path]::GetFullPath",
      "icacls.exe",
      "S-1-5-32-544",
      "$env:CAREFLOW_DB_PATH = $uatDb",
      "Invoke-RestMethod",
      "Get-NetTCPConnection",
      "Get-CimInstance Win32_Process",
      "npm run expire:uat-doctor-session -- --database \"$uatDb\"",
    ]) {
      expect(runbook).toContain(required);
    }

    expect(guide).toContain("Windows 11 PowerShell");
    expect(checklist).toContain("ระบบปฏิบัติการและ Node.js");
    expect(checklist).toContain("ผลตรวจสิทธิ์ directory/ACL");
    expect(readme).toContain("### Windows 11 PowerShell");

    const credentialAssignment = /(?:password|รหัสผ่าน)\s*[=:]\s*\S+/i;
    expect(runbook).not.toMatch(credentialAssignment);
    expect(guide).not.toMatch(credentialAssignment);
    expect(checklist).not.toMatch(credentialAssignment);
  });
});
