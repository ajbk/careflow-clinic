import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/server/**/*.test.ts"],
    passWithNoTests: true,
    // Each file owns a SQLite/Fastify fixture; serial files keep the 5-second
    // terminal-collection race checks deterministic under constrained CI CPUs.
    fileParallelism: false,
  },
});
