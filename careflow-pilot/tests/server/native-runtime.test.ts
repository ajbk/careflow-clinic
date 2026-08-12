import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { verifyNativeRuntime } from "../../src/server/maintenance/native-runtime.js";

describe("native runtime verification", () => {
  it("executes SQLite, Argon2, and esbuild without persistent data", async () => {
    await expect(verifyNativeRuntime()).resolves.toBeUndefined();
  });

  it("reduces esbuild environment configuration to the fixed failure line", () => {
    const sentinel = "/careflow-native-runtime-does-not-exist";
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-native-runtime.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, ESBUILD_BINARY_PATH: sentinel },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("CareFlow native runtime verification failed\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
  });

  it("reduces native tool failures to the fixed failure line", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/verify-native-runtime.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, ESBUILD_BINARY_PATH: process.execPath },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("CareFlow native runtime verification failed\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(process.execPath);
  });
});
