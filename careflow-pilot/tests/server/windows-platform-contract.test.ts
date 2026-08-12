import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import serverVitestConfig, * as serverVitestConfigModule from "../../vitest.server.config.js";

const repositoryRoot = resolve(process.cwd(), "..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
const readRepositoryFile = (path: string): string =>
  readFileSync(resolve(repositoryRoot, path), "utf8");

const serverVitestConfigExports = serverVitestConfigModule as unknown as {
  serverTestTimeoutForPlatform?: (platform: NodeJS.Platform) => number;
};

function resolvedGitAttribute(attribute: string, paths: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    execFileSync("git", ["check-attr", attribute, "--", ...paths], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [path, resolvedAttribute, value] = line.split(": ");
        if (resolvedAttribute !== attribute || value === undefined) {
          throw new Error(`Unexpected Git attribute output: ${line}`);
        }
        return [path, value];
      }),
  );
}

function sectionBetween(source: string, startMarker: string, endMarker?: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing section: ${startMarker}`);
  if (!endMarker) return source.slice(start);

  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing section boundary: ${endMarker}`);
  return source.slice(start, end);
}

const stablePilotRootBootstrap = [
  "$startingDirectory = [System.IO.Path]::GetFullPath((Get-Location).Path)",
  "$pilotRoot = if ([System.IO.Path]::GetFileName($startingDirectory) -eq 'careflow-pilot') {",
  "$startingDirectory",
  "} else {",
  "[System.IO.Path]::GetFullPath((Join-Path $startingDirectory 'careflow-pilot'))",
  "}",
  "$pilotManifest = [System.IO.Path]::GetFullPath((Join-Path $pilotRoot 'package.json'))",
  "if (-not (Test-Path -LiteralPath $pilotManifest -PathType Leaf -ErrorAction Stop)) {",
  "throw 'CareFlow pilot root not found; UAT is BLOCKED'",
  "}",
  "$pilotPackage = Get-Content -LiteralPath $pilotManifest -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop",
  "if ($pilotPackage.name -ne 'careflow-pilot') {",
  "throw 'CareFlow pilot root is invalid; UAT is BLOCKED'",
  "}",
  "Set-Location -LiteralPath $pilotRoot -ErrorAction Stop",
].join("\n");

function normalizedMarkdown(source: string): string {
  return source
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
}

function countOccurrences(source: string, expected: string): number {
  return source.split(expected).length - 1;
}

function expectFailClosedWindowsInspection(section: string, action: string): void {
  expect(section).not.toContain("-ErrorAction SilentlyContinue");
  expect(section).toContain(
    "$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |",
  );
  expect(section).toContain(
    "$careFlowProcesses = @(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" -ErrorAction Stop |",
  );
  expect(section).toContain(
    '$runningLockExists = Test-Path -LiteralPath "${uatDb}.careflow-running" -PathType Any -ErrorAction Stop',
  );

  const listenerGuard = section.indexOf("if ($listeners.Count -ne 0) { throw");
  const processGuard = section.indexOf("if ($careFlowProcesses.Count -ne 0) { throw");
  const lockGuard = section.indexOf("if ($runningLockExists) { throw");
  const actionIndex = section.indexOf(action);

  expect(section).toContain(
    "if ($listeners.Count -ne 0) { throw 'Port 3001 listener remains; UAT is BLOCKED' }",
  );
  expect(section).toContain(
    "if ($careFlowProcesses.Count -ne 0) { throw 'CareFlow Node process remains; UAT is BLOCKED' }",
  );
  expect(section).toContain(
    "if ($runningLockExists) { throw 'CareFlow running lock remains; UAT is BLOCKED' }",
  );
  expect(listenerGuard).toBeGreaterThan(-1);
  expect(processGuard).toBeGreaterThan(listenerGuard);
  expect(lockGuard).toBeGreaterThan(processGuard);
  expect(actionIndex).toBeGreaterThan(lockGuard);
}

function windowsJob(): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const marker = "  pilot-windows:";
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error("pilot-windows job is missing");
  return workflow.slice(start);
}

describe("native Windows platform contract", () => {
  it("forces immutable Drizzle migrations and snapshots to LF through Git attributes", () => {
    const protectedArtifacts = [
      "careflow-pilot/drizzle/0000_platform.sql",
      "careflow-pilot/drizzle/meta/0000_snapshot.json",
    ] as const;

    expect(resolvedGitAttribute("eol", protectedArtifacts)).toEqual({
      "careflow-pilot/drizzle/0000_platform.sql": "lf",
      "careflow-pilot/drizzle/meta/0000_snapshot.json": "lf",
    });
  });

  it.each([
    ["win32", 15_000],
    ["linux", 5_000],
    ["darwin", 5_000],
  ] as const)("maps the %s server-test budget to %d ms", (platform, expectedTimeout) => {
    const timeoutForPlatform = serverVitestConfigExports.serverTestTimeoutForPlatform;

    expect(timeoutForPlatform).toBeTypeOf("function");
    if (!timeoutForPlatform) return;

    expect(timeoutForPlatform(platform)).toBe(expectedTimeout);
  });

  it("uses the mapped server-test budget in Vitest", () => {
    const timeoutForPlatform = serverVitestConfigExports.serverTestTimeoutForPlatform;

    expect(timeoutForPlatform).toBeTypeOf("function");
    if (!timeoutForPlatform) return;

    expect(serverVitestConfig.test?.testTimeout).toBe(timeoutForPlatform(process.platform));
  });

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

  it("creates and validates an exact two-trustee UAT directory DACL", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const preparation = sectionBetween(
      runbook,
      "## Windows 11 PowerShell",
      "## Provision the only two UAT accounts before host startup",
    );

    const rejectExistingDirectory = preparation.indexOf(
      "if (Test-Path -LiteralPath $uatDir -PathType Any -ErrorAction Stop) { throw 'Use a new UAT directory' }",
    );
    const createDirectory = preparation.indexOf(
      "New-Item -ItemType Directory -Path $uatDir -ErrorAction Stop",
    );
    const createEmptyAcl = preparation.indexOf(
      "$uatAcl = [System.Security.AccessControl.DirectorySecurity]::new()",
    );
    const applyAcl = preparation.indexOf(
      "Set-Acl -LiteralPath $uatDir -AclObject $uatAcl -ErrorAction Stop",
    );
    const readAcl = preparation.indexOf(
      "$actualAcl = Get-Acl -LiteralPath $uatDir -ErrorAction Stop",
    );

    expect(rejectExistingDirectory).toBeGreaterThan(-1);
    expect(createDirectory).toBeGreaterThan(rejectExistingDirectory);
    expect(createEmptyAcl).toBeGreaterThan(createDirectory);
    expect(applyAcl).toBeGreaterThan(createEmptyAcl);
    expect(readAcl).toBeGreaterThan(applyAcl);
    expect(preparation).not.toContain("New-Item -ItemType Directory -Path $uatDir -Force");
    expect(preparation).not.toMatch(/icacls\.exe[^\n]*\/(?:grant|inheritance)/i);

    for (const required of [
      "$administratorsSid = 'S-1-5-32-544'",
      "$expectedSids = @($currentSid, $administratorsSid)",
      "$uatAcl.SetAccessRuleProtection($true, $false)",
      "[System.Security.AccessControl.FileSystemRights]::FullControl",
      "[System.Security.AccessControl.InheritanceFlags]::ContainerInherit",
      "[System.Security.AccessControl.InheritanceFlags]::ObjectInherit",
      "[System.Security.AccessControl.AccessControlType]::Allow",
      "$actualRules = @($actualAcl.Access)",
      ".IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value",
      "$actualAcl.AreAccessRulesProtected",
      "$ruleSid -notin $expectedSids -or",
      "$_.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or",
      "$_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or",
      "$_.InheritanceFlags -ne $inheritanceFlags -or",
      "$_.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or",
      "$_.IsInherited",
      "$actualRules.Count -ne $expectedSids.Count",
      "$invalidRules.Count -ne 0",
      "$missingSids.Count -ne 0",
      "throw 'UAT directory ACL validation failed; UAT is BLOCKED'",
    ]) {
      expect(preparation).toContain(required);
    }
  });

  it("blocks restart and expiry unless maintenance inspections prove the host is stopped", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const restart = sectionBetween(
      sectionBetween(
        runbook,
        "## Planned restart checkpoint",
        "## Controlled Doctor session-expiry checkpoint",
      ),
      "### Windows 11 PowerShell",
    );
    const expiry = sectionBetween(
      sectionBetween(
        runbook,
        "## Controlled Doctor session-expiry checkpoint",
        "## Lock recovery is read-only until directed otherwise",
      ),
      "### Windows 11 PowerShell",
    );

    expectFailClosedWindowsInspection(restart, "npm start");
    expectFailClosedWindowsInspection(
      expiry,
      'npm run expire:uat-doctor-session -- --database "$uatDb"',
    );
  });

  it("initializes the Windows database path before provisioning exactly two accounts", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const provisioning = sectionBetween(
      runbook,
      "## Provision the only two UAT accounts before host startup",
      "## Mandatory-stop handling",
    );
    const windowsProvisioning = sectionBetween(provisioning, "### Windows 11 PowerShell");
    const pathInitialization = windowsProvisioning.indexOf(
      "$uatDb = [System.IO.Path]::GetFullPath((Join-Path $pilotRoot 'data\\uat\\careflow-uat.sqlite'))",
    );
    const databaseEnvironment = windowsProvisioning.indexOf(
      "$env:CAREFLOW_DB_PATH = $uatDb",
    );
    const userCommands = windowsProvisioning.match(/^npm run users -- create .*$/gm) ?? [];
    const start = windowsProvisioning.indexOf("npm start");

    expect(pathInitialization).toBeGreaterThan(-1);
    expect(databaseEnvironment).toBeGreaterThan(pathInitialization);
    expect(userCommands).toEqual([
      "npm run users -- create --username uat-assistant --display-name Assistant --role assistant",
      "npm run users -- create --username uat-doctor --display-name Doctor --role doctor",
    ]);
    expect(start).toBeGreaterThan(windowsProvisioning.indexOf(userCommands[1]));
  });

  it("keeps provisioning safeguards shared by POSIX and Windows operators", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const provisioning = sectionBetween(
      runbook,
      "## Provision the only two UAT accounts before host startup",
      "## Mandatory-stop handling",
    );
    const posixHeading = provisioning.indexOf("### macOS/Linux (POSIX)");
    const sharedRules = provisioning.slice(0, posixHeading);

    expect(posixHeading).toBeGreaterThan(-1);
    expect(sharedRules).toContain("Both platform paths");
    expect(sharedRules).toContain("hidden terminal input");
    expect(sharedRules).toContain("User account command completed");
    expect(sharedRules).toContain("provisioning failure");
    expect(sharedRules).toContain("Do not create any other account or repeat either create command");
  });

  it("does not start or create the Windows UAT database from the README shortcut", () => {
    const readme = readRepositoryFile("careflow-pilot/README.md");
    const windowsQuickStart = sectionBetween(
      readme,
      "### Windows 11 PowerShell",
      "## Two-browser rehearsal",
    );

    expect(windowsQuickStart).not.toContain("npm start");
    expect(windowsQuickStart).not.toContain("npm run db:migrate");
    expect(windowsQuickStart).not.toContain("New-Item -ItemType Directory");
    expect(windowsQuickStart).toContain("complete the administrator runbook");
    expect(windowsQuickStart).toContain("exactly two interactive UAT accounts");
  });

  it("derives one validated absolute pilot root from either documented starting directory", () => {
    const runbook = readRepositoryFile("docs/uat/careflow-pre-pilot/admin-runbook.md");
    const readme = readRepositoryFile("careflow-pilot/README.md");
    const preparation = sectionBetween(
      runbook,
      "## Windows 11 PowerShell",
      "## Provision the only two UAT accounts before host startup",
    );
    const provisioning = sectionBetween(
      sectionBetween(
        runbook,
        "## Provision the only two UAT accounts before host startup",
        "## Mandatory-stop handling",
      ),
      "### Windows 11 PowerShell",
    );
    const restart = sectionBetween(
      sectionBetween(
        runbook,
        "## Planned restart checkpoint",
        "## Controlled Doctor session-expiry checkpoint",
      ),
      "### Windows 11 PowerShell",
    );
    const expiry = sectionBetween(
      sectionBetween(
        runbook,
        "## Controlled Doctor session-expiry checkpoint",
        "## Lock recovery is read-only until directed otherwise",
      ),
      "### Windows 11 PowerShell",
    );
    const readmeWindows = sectionBetween(
      readme,
      "### Windows 11 PowerShell",
      "## Two-browser rehearsal",
    );

    const normalizedSections = [
      [normalizedMarkdown(preparation), 1],
      [normalizedMarkdown(provisioning), 2],
      [normalizedMarkdown(restart), 1],
      [normalizedMarkdown(expiry), 1],
      [normalizedMarkdown(readmeWindows), 1],
    ] as const;

    for (const [section, expectedCount] of normalizedSections) {
      expect(countOccurrences(section, stablePilotRootBootstrap)).toBe(expectedCount);
      expect(section).not.toMatch(/Set-Location\s+careflow-pilot/);
    }

    for (const section of [preparation, provisioning, restart, expiry]) {
      const location = section.indexOf("Set-Location -LiteralPath $pilotRoot -ErrorAction Stop");
      const pathConsumer = section.indexOf("$uatDb = [System.IO.Path]::GetFullPath");
      expect(location).toBeGreaterThan(-1);
      expect(pathConsumer).toBeGreaterThan(location);
    }
  });
});
