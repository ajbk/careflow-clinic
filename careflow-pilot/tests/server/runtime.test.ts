import { describe, expect, it } from "vitest";
import { shouldServeStatic, startupErrorMessage } from "../../src/server/runtime.js";

describe("server runtime boundaries", () => {
  it("disables production asset serving only for the explicit development flag", () => {
    expect(shouldServeStatic(["node", "server.js"])).toBe(true);
    expect(shouldServeStatic(["node", "server.js", "--no-static"])).toBe(false);
  });

  it("keeps unknown startup details out of stderr while preserving safe operator guidance", () => {
    expect(startupErrorMessage(new Error("ENOENT: no such file or directory, open '/private/secret/careflow.sqlite'"))).toBe("unknown startup error");
    expect(startupErrorMessage(new Error("CareFlow client assets directory is missing"))).toBe("CareFlow client assets directory is missing");
  });
});
