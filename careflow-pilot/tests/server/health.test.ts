import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client.js";
import { apiErrorBodySchema } from "../../src/shared/contracts.js";
import { createTestApp, createTestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("SQLite boundary", () => {
  it("opens the canonical database with WAL, foreign keys, and busy timeout", () => {
    const handle = createTestDatabase();
    cleanups.push(handle.cleanup);

    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(handle.sqlite.pragma("synchronous", { simple: true })).toBe(2);
  });

  it("gives a new file the CareFlow application, product, migration, and synthetic clinic identity", () => {
    const handle = createTestDatabase();
    cleanups.push(handle.cleanup);

    expect(handle.sqlite.pragma("application_id", { simple: true })).toBe(0x43464c57);
    expect(
      handle.sqlite.prepare("SELECT value FROM platform_metadata WHERE key = 'product_id'").pluck().get(),
    ).toBe("careflow-pilot");
    expect(
      handle.sqlite.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get(),
    ).toBe(12);
    expect(
      handle.sqlite
        .prepare(
          "SELECT id, name, timezone, synthetic_only, created_at, updated_at FROM clinic_config WHERE id = 'clinic'",
        )
        .get(),
    ).toEqual({
      id: "clinic",
      name: "คลินิกชนบท CareFlow Pilot",
      timezone: "Asia/Bangkok",
      synthetic_only: 1,
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      updated_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    const timestamps = handle.sqlite
      .prepare("SELECT created_at, updated_at FROM clinic_config WHERE id = 'clinic'")
      .get() as { created_at: string; updated_at: string };
    expect(timestamps.created_at).toBe(timestamps.updated_at);
  });

  it("rejects an existing foreign SQLite file byte-for-byte unchanged", () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-foreign-test-"));
    const databasePath = join(directory, "foreign.sqlite");
    const foreign = new Database(databasePath);
    foreign.exec("CREATE TABLE foreign_data(value TEXT NOT NULL); INSERT INTO foreign_data VALUES ('keep-me');");
    foreign.close();
    const before = createHash("sha256").update(readFileSync(databasePath)).digest("hex");
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    expect(() => openDatabase(databasePath)).toThrow("not a CareFlow Pilot database");

    const after = createHash("sha256").update(readFileSync(databasePath)).digest("hex");
    expect(after).toBe(before);
  });
});

describe("Fastify boundary", () => {
  it("serves known client assets and safely falls back to the SPA for deep links", async () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-client-assets-"));
    writeFileSync(join(directory, "index.html"), "<!doctype html><div id=\"root\">pilot</div>");
    writeFileSync(join(directory, "app.js"), "console.log('pilot');");
    const harness = await createTestApp({ serveStatic: true, clientAssetsRoot: directory });
    cleanups.push(async () => {
      await harness.cleanup();
      rmSync(directory, { recursive: true, force: true });
    });

    const root = await harness.app.inject({ method: "GET", url: "/" });
    const deepLink = await harness.app.inject({ method: "GET", url: "/consultations/visit-123" });
    const asset = await harness.app.inject({ method: "GET", url: "/app.js" });
    const missingApi = await harness.app.inject({ method: "GET", url: "/api/missing" });
    const missingApiWithQuery = await harness.app.inject({ method: "GET", url: "/api?from=smoke" });

    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.body).toContain('id="root"');
    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toContain('id="root"');
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("console.log");
    expect(missingApi.statusCode).toBe(404);
    expect(missingApi.headers["content-type"]).toContain("application/json");
    expect(missingApi.body).not.toContain("<div");
    expect(missingApiWithQuery.statusCode).toBe(404);
    expect(missingApiWithQuery.headers["content-type"]).toContain("application/json");
  });

  it("fails clearly when production client assets are missing", async () => {
    const harness = await createTestApp();
    cleanups.push(harness.cleanup);

    await expect(
      import("../../src/server/app.js").then(({ buildApp }) =>
        buildApp({
          db: harness.database,
          config: {
            host: "127.0.0.1",
            port: 3001,
            databasePath: harness.databasePath,
            cookieSecure: false,
            sessionIdleMinutes: 15,
            sessionAbsoluteHours: 8,
            clientDistPath: join(tmpdir(), "careflow-client-missing"),
          },
          clock: () => new Date("2026-08-03T00:00:00.000Z"),
          idFactory: () => "missing-assets-request",
          serveStatic: true,
        }),
      ),
    ).rejects.toThrow("CareFlow client assets directory is missing");
  });

  it("surfaces a sanitized production startup error when the client build is absent", () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-startup-assets-"));
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        CAREFLOW_HOST: "127.0.0.1",
        CAREFLOW_PORT: "1",
        CAREFLOW_DB_PATH: join(directory, "careflow.sqlite"),
        CAREFLOW_CLIENT_DIST: join(directory, "missing-client"),
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    rmSync(directory, { recursive: true, force: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CareFlow server failed to start: CareFlow client assets directory is missing");
    expect(result.stderr).not.toContain(directory);
  });

  it("returns a non-secret health response", async () => {
    const harness = await createTestApp();
    cleanups.push(harness.cleanup);

    const response = await harness.app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ready" });
    expect(response.body).not.toContain(harness.databasePath);
  });

  it("maps missing routes to the stable non-secret error contract", async () => {
    const harness = await createTestApp();
    cleanups.push(harness.cleanup);

    const response = await harness.app.inject({ method: "GET", url: "/api/missing" });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(apiErrorBodySchema.parse(body)).toEqual(body);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(response.body).not.toContain(harness.databasePath);
  });
});
