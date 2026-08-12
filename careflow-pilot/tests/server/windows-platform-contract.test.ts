import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");

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
});
