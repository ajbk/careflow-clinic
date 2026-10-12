import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client.js";
import { initializeCloudDatabase } from "../../src/server/maintenance/deployment.js";

const directories: string[] = [];
function target() { const dir = mkdtempSync(join(tmpdir(), "careflow-cloud-")); directories.push(dir); return join(dir, "clinic.sqlite"); }
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("cloud database opening", () => {
  it("never creates an empty database or directory on a missing mount", () => {
    const path = join(target(), "missing", "clinic.sqlite");
    expect(() => openDatabase(path, { environmentId: "synthetic-test" })).toThrow();
    expect(existsSync(path)).toBe(false);
  });
  it("requires a matching external deployment record and database identity", () => {
    const path = target();
    const local = openDatabase(path); local.close();
    const before = readFileSync(path);
    expect(() => openDatabase(path, { environmentId: "synthetic-test" })).toThrow();
    expect(readFileSync(path)).toEqual(before);
  });
  it("opens only explicitly initialized matching environments and refuses missing deployment records", () => {
    const path = target();
    initializeCloudDatabase(path, "synthetic-test");
    const database = openDatabase(path, { environmentId: "synthetic-test" }); database.close();
    expect(() => openDatabase(path, { environmentId: "wrong-test" })).toThrow();
    rmSync(`${path}.deployment.json`);
    expect(() => openDatabase(path, { environmentId: "synthetic-test" })).toThrow();
    expect(existsSync(`${path}.careflow-running`)).toBe(false);
  });
  it("does not apply a pending migration during startup", () => {
    const path = target(); initializeCloudDatabase(path, "synthetic-test");
    const db = openDatabase(path, { environmentId: "synthetic-test" });
    expect(db.sqlite.prepare("DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)").run().changes).toBe(1); db.close();
    const before = readFileSync(path);
    expect(() => openDatabase(path, { environmentId: "synthetic-test" })).toThrow();
    expect(readFileSync(path)).toEqual(before);
  });
  it("refuses altered schema even when migration hashes were left intact", () => {
    const path = target(); initializeCloudDatabase(path, "synthetic-test");
    const db = openDatabase(path, { environmentId: "synthetic-test" });
    db.sqlite.exec("DROP TRIGGER security_events_block_update"); db.close();
    expect(() => openDatabase(path, { environmentId: "synthetic-test" })).toThrow();
  });
});
