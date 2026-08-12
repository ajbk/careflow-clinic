import { defineConfig } from "vitest/config";

export function serverTestTimeoutForPlatform(platform: NodeJS.Platform): number {
  return platform === "win32" ? 15_000 : 5_000;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/server/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: serverTestTimeoutForPlatform(process.platform),
    // Each file owns a SQLite/Fastify fixture; serial files keep the 5-second
    // terminal-collection race checks deterministic under constrained CI CPUs.
    fileParallelism: false,
  },
});
