import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { buildApp, type BuildAppOptions } from "../../src/server/app.js";
import type { AppConfig } from "../../src/server/config.js";
import { openDatabase } from "../../src/server/db/client.js";
import { runClinicHost } from "../../src/server/lifecycle.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

let database: TestDatabase | undefined;

afterEach(() => {
  database?.cleanup();
  database = undefined;
});

it("releases the database lock when termination is requested during asynchronous app startup", async () => {
  database = createTestDatabase();
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3001,
    databasePath: database.databasePath,
    cookieSecure: false,
    sessionIdleMinutes: 15,
    sessionAbsoluteHours: 8,
    clientDistPath: "./dist/client",
  };
  const signals = new EventEmitter();
  let permitAppStartup!: () => void;
  const startupGate = new Promise<void>((resolve) => {
    permitAppStartup = resolve;
  });
  let appStartupBegan!: () => void;
  const appStartupStarted = new Promise<void>((resolve) => {
    appStartupBegan = resolve;
  });

  const running = runClinicHost({
    database,
    config,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
    idFactory: () => "startup-test-request-id",
    signalSource: signals,
    buildApplication: async (options: BuildAppOptions) => {
      appStartupBegan();
      await startupGate;
      return buildApp(options);
    },
  });

  await appStartupStarted;
  expect(existsSync(`${database.databasePath}.careflow-running`)).toBe(true);

  signals.emit("SIGTERM");

  await vi.waitFor(() => {
    expect(existsSync(`${database?.databasePath}.careflow-running`)).toBe(false);
  });
  const replacement = openDatabase(database.databasePath);
  replacement.close();

  permitAppStartup();
  await running;
});
