import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    ).toBe(2);
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
