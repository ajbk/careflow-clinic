import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client.js";
import { acquireHostLock } from "../../src/server/host-lock.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "careflow-lock-test-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

describe("Clinic Host lock", () => {
  it("bootstraps one missing dedicated parent and uses private POSIX modes", () => {
    const root = temporaryRoot();
    const databasePath = join(root, "data", "careflow.sqlite");
    const lock = acquireHostLock(databasePath);

    expect(lock.databasePath).toBe(join(realpathSync(dirname(resolve(databasePath))), basename(databasePath)));
    expect(statSync(dirname(lock.databasePath)).isDirectory()).toBe(true);
    expect(statSync(lock.lockPath).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(dirname(lock.databasePath)).mode & 0o777).toBe(0o700);
      expect(statSync(lock.lockPath).mode & 0o777).toBe(0o700);
    }

    lock.release();
  });

  it.skipIf(process.platform === "win32")("refuses an existing parent with group or other permissions", () => {
    const root = temporaryRoot();
    const parent = join(root, "shared");
    mkdirSync(parent, { mode: 0o755 });
    chmodSync(parent, 0o755);

    expect(() => acquireHostLock(join(parent, "careflow.sqlite"))).toThrow("private permissions");
  });

  it("refuses a database target that is a symbolic link", () => {
    const root = temporaryRoot();
    const actual = join(root, "actual.sqlite");
    const alias = join(root, "alias.sqlite");
    writeFileSync(actual, "", { mode: 0o600 });
    symlinkSync(actual, alias);

    expect(() => acquireHostLock(alias)).toThrow("symbolic link");
  });

  it("canonicalizes parent aliases so two spellings cannot create two locks", () => {
    const root = temporaryRoot();
    const realParent = join(root, "data");
    const parentAlias = join(root, "data-alias");
    mkdirSync(realParent, { mode: 0o700 });
    symlinkSync(realParent, parentAlias);
    const first = acquireHostLock(join(parentAlias, "careflow.sqlite"));
    cleanups.push(first.release);

    expect(() => acquireHostLock(join(realParent, "careflow.sqlite"))).toThrow("already running");
  });

  it("lets one holder block a second writer and graceful release allows the next writer", () => {
    const root = temporaryRoot();
    const databasePath = join(root, "careflow.sqlite");
    const first = acquireHostLock(databasePath);

    expect(() => acquireHostLock(databasePath)).toThrow("already running");

    first.release();
    const second = acquireHostLock(databasePath);
    second.release();
  });

  it("releases its lock after a controlled database startup failure", () => {
    const root = temporaryRoot();
    const databasePath = join(root, "foreign.sqlite");
    writeFileSync(databasePath, "not a sqlite database", { mode: 0o600 });

    expect(() => openDatabase(databasePath)).toThrow();

    const lock = acquireHostLock(databasePath);
    lock.release();
  });

  it("fails closed when a stale lock directory exists and never removes it", () => {
    const root = temporaryRoot();
    const databasePath = join(root, "careflow.sqlite");
    const staleLockPath = join(dirname(databasePath), `${basename(databasePath)}.careflow-running`);
    mkdirSync(staleLockPath, { mode: 0o700 });

    expect(() => acquireHostLock(databasePath)).toThrow("already running");
    expect(statSync(staleLockPath).isDirectory()).toBe(true);
  });
});
