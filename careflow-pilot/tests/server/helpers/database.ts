import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp, type BuildAppOptions } from "../../../src/server/app.js";
import type { AppConfig } from "../../../src/server/config.js";
import { openDatabase, type DatabaseHandle } from "../../../src/server/db/client.js";
import { requireActor } from "../../../src/server/auth/hooks.js";

export interface TestDatabase extends DatabaseHandle {
  databasePath: string;
  cleanup: () => void;
}

export function createTestDatabase(): TestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "careflow-test-"));
  const databasePath = join(directory, "careflow.sqlite");
  const handle = openDatabase(databasePath);
  let closed = false;

  return {
    ...handle,
    databasePath,
    close: () => {
      if (!closed) {
        handle.close();
        closed = true;
      }
    },
    cleanup: () => {
      if (!closed) {
        handle.close();
        closed = true;
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function createTestApp(
  overrides: Partial<Omit<BuildAppOptions, "db" | "config">> = {},
): Promise<{
  app: FastifyInstance;
  database: TestDatabase;
  databasePath: string;
  cleanup: () => Promise<void>;
}> {
  const database = createTestDatabase();
  const config: AppConfig = {
    host: "127.0.0.1",
    port: 3001,
    databasePath: database.databasePath,
    cookieSecure: false,
    sessionIdleMinutes: 15,
    sessionAbsoluteHours: 8,
    clientDistPath: "./dist/client",
  };
  const app = await buildApp({
    db: database,
    config,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
    idFactory: () => "test-request-id",
    ...overrides,
  });
  app.get("/api/test/doctor", async (request) => ({
    actor: requireActor(request, "visit:start-consultation"),
  }));
  await app.ready();

  return {
    app,
    database,
    databasePath: database.databasePath,
    cleanup: async () => {
      await app.close();
      database.cleanup();
    },
  };
}
