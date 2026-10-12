import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runOperationsCli } from "../../src/server/maintenance/operations-cli.js";

describe("explicit operations CLI", () => {
  it("requires explicit synthetic acknowledgement and never accepts implicit paths", async () => {
    const output: string[] = []; const error: string[] = [];
    expect(await runOperationsCli({ argv: ["initialize"], stdout: (line) => output.push(line), stderr: (line) => error.push(line) })).toBe(1);
    expect(output).toHaveLength(0);
    expect(error).toHaveLength(1);
  });
  it("initializes a synthetic environment and reports that provider readiness remains incomplete", async () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-cli-"));
    const common = ["--db", join(directory, "clinic.sqlite"), "--environment", "synthetic-cli", "--confirm", "SYNTHETIC-ONLY"];
    const output: string[] = [];
    try {
      const io = { stdout: (line: string) => output.push(line), stderr: (line: string) => { throw new Error(line); } };
      expect(await runOperationsCli({ ...io, argv: ["initialize", ...common] })).toBe(0);
      expect(await runOperationsCli({ ...io, argv: ["status", ...common] })).toBe(0);
      expect(JSON.parse(output[1]!).ready).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
