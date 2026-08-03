import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config.js";

describe("loadConfig", () => {
  it("uses safe loopback and local-path defaults", () => {
    expect(loadConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3001,
      databasePath: "./data/careflow.sqlite",
      cookieSecure: false,
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath: "./dist/client",
    });
  });

  it.each(["0.0.0.0", "192.168.1.20", "clinic-host.local"])(
    "rejects the non-loopback host %s even without secure cookies",
    (host) => {
      expect(() => loadConfig({ CAREFLOW_HOST: host, CAREFLOW_COOKIE_SECURE: "false" })).toThrow(
        "Invalid CareFlow configuration",
      );
    },
  );

  it.each([
    { CAREFLOW_PORT: "0" },
    { CAREFLOW_PORT: "65536" },
    { CAREFLOW_PORT: "3001.5" },
    { CAREFLOW_DB_PATH: "" },
    { CAREFLOW_CLIENT_DIST: "   " },
    { CAREFLOW_COOKIE_SECURE: "yes" },
  ])("rejects malformed runtime configuration without echoing its value", (environment) => {
    const secretValue = Object.values(environment)[0];

    expect(() => loadConfig(environment)).toThrow("Invalid CareFlow configuration");
    try {
      loadConfig(environment);
    } catch (error) {
      if (secretValue.length > 0) expect(String(error)).not.toContain(secretValue);
    }
  });

  it("loads a temporary .env through Node's real entrypoint while direct variables retain precedence", () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-env-test-"));
    const envPath = join(directory, ".env");
    const configModule = resolve("src/server/config.ts");
    writeFileSync(
      envPath,
      [
        "CAREFLOW_HOST=::1",
        "CAREFLOW_PORT=4123",
        "CAREFLOW_DB_PATH=./from-env.sqlite",
        "CAREFLOW_COOKIE_SECURE=true",
        "CAREFLOW_CLIENT_DIST=./from-env-client",
      ].join("\n"),
      { mode: 0o600 },
    );

    try {
      const output = execFileSync(
        process.execPath,
        [
          `--env-file-if-exists=${envPath}`,
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          `import { loadConfig } from ${JSON.stringify(configModule)}; process.stdout.write(JSON.stringify(loadConfig(process.env)));`,
        ],
        {
          cwd: resolve("."),
          env: { ...process.env, CAREFLOW_PORT: "4999" },
          encoding: "utf8",
        },
      );

      expect(JSON.parse(output)).toEqual({
        host: "::1",
        port: 4999,
        databasePath: "./from-env.sqlite",
        cookieSecure: true,
        sessionIdleMinutes: 15,
        sessionAbsoluteHours: 8,
        clientDistPath: "./from-env-client",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
