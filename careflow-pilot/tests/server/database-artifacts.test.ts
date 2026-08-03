import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function temporaryDatabase(): { directory: string; databasePath: string } {
  const directory = mkdtempSync(join(tmpdir(), "careflow-artifact-test-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, databasePath: join(directory, "careflow.sqlite") };
}

describe.each(["-wal", "-shm"])("pre-existing SQLite %s artifact", (suffix) => {
  it("rejects a symbolic link without touching its target or creating the database", () => {
    const { directory, databasePath } = temporaryDatabase();
    const unrelatedPath = join(directory, `unrelated${suffix}`);
    const artifactPath = `${databasePath}${suffix}`;
    writeFileSync(unrelatedPath, "must-not-change", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(unrelatedPath, 0o644);
    const beforeMode = statSync(unrelatedPath).mode & 0o777;
    const beforeBytes = readFileSync(unrelatedPath);
    symlinkSync(unrelatedPath, artifactPath);

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(lstatSync(artifactPath).isSymbolicLink()).toBe(true);
    expect(statSync(unrelatedPath).mode & 0o777).toBe(beforeMode);
    expect(readFileSync(unrelatedPath)).toEqual(beforeBytes);
  });

  it("rejects a directory before creating the database", () => {
    const { databasePath } = temporaryDatabase();
    const artifactPath = `${databasePath}${suffix}`;
    mkdirSync(artifactPath, { mode: 0o700 });

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(statSync(artifactPath).isDirectory()).toBe(true);
  });

  it("rejects a hard-link alias without touching either name or creating the database", () => {
    const { directory, databasePath } = temporaryDatabase();
    const unrelatedPath = join(directory, `unrelated-hardlink${suffix}`);
    const artifactPath = `${databasePath}${suffix}`;
    writeFileSync(unrelatedPath, "must-not-change", { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(unrelatedPath, 0o644);
    const beforeMode = statSync(unrelatedPath).mode & 0o777;
    const beforeBytes = readFileSync(unrelatedPath);
    linkSync(unrelatedPath, artifactPath);

    expect(() => {
      const handle = openDatabase(databasePath);
      handle.close();
    }).toThrow("unsafe SQLite artifact");

    expect(existsSync(databasePath)).toBe(false);
    expect(statSync(artifactPath).nlink).toBe(2);
    expect(statSync(unrelatedPath).mode & 0o777).toBe(beforeMode);
    expect(readFileSync(unrelatedPath)).toEqual(beforeBytes);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a non-regular artifact before creating the database",
    () => {
      const { databasePath } = temporaryDatabase();
      const artifactPath = `${databasePath}${suffix}`;
      execFileSync("mkfifo", [artifactPath]);

      expect(() => {
        const handle = openDatabase(databasePath);
        handle.close();
      }).toThrow("unsafe SQLite artifact");

      expect(existsSync(databasePath)).toBe(false);
      expect(lstatSync(artifactPath).isFIFO()).toBe(true);
    },
  );
});
