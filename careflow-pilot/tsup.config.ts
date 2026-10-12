import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "server/server": "src/server/server.ts", "server/operations": "scripts/operations.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: false,
  dts: false,
  bundle: true,
  skipNodeModulesBundle: true,
});
