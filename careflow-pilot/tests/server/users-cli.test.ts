import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/client.js";
import { runUsersCli } from "../../src/server/modules/platform/users-cli.js";
import { createTestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function run(input: {
  argv: string[];
  databasePath: string;
  secrets?: string[];
  texts?: string[];
}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const secrets = [...(input.secrets ?? [])];
  const texts = [...(input.texts ?? [])];
  const code = await runUsersCli({
    argv: input.argv,
    env: { CAREFLOW_DB_PATH: input.databasePath },
    promptSecret: async () => secrets.shift() ?? "",
    promptText: async () => texts.shift() ?? "",
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

describe("offline users CLI", () => {
  it("refuses a live host lock without changing any rows", async () => {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    const before = database.sqlite.prepare("SELECT count(*) AS count FROM staff_accounts").get();

    const result = await run({
      argv: ["create", "--username", "doctor", "--display-name", "พญ. ทดสอบ", "--role", "doctor"],
      databasePath: database.databasePath,
      secrets: ["รหัสผ่านทดสอบ-1234", "รหัสผ่านทดสอบ-1234"],
      texts: ["SYNTHETIC-ONLY"],
    });

    expect(result.code).not.toBe(0);
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM staff_accounts").get()).toEqual(before);
  });

  it("refuses a foreign SQLite file byte-for-byte", async () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-foreign-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, "foreign.sqlite");
    writeFileSync(path, "not a careflow sqlite database");
    const before = readFileSync(path);

    const result = await run({ argv: ["disable", "--username", "doctor"], databasePath: path });

    expect(result.code).not.toBe(0);
    expect(readFileSync(path)).toEqual(before);
  });

  it("rejects resetting an account to its current password without writes or secret output", async () => {
    const source = createTestDatabase();
    const directory = mkdtempSync(join(tmpdir(), "careflow-cli-reuse-"));
    const path = join(directory, "careflow.sqlite");
    source.close();
    copyFileSync(source.databasePath, path);
    source.cleanup();
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const currentPassword = "วลีผ่านเดิมสำหรับคลินิก-1234";
    const created = await run({
      argv: ["create", "--username", "doctor", "--display-name", "พญ. อริสรา", "--role", "doctor"],
      databasePath: path,
      secrets: [currentPassword, currentPassword],
      texts: ["SYNTHETIC-ONLY"],
    });
    expect(created.code).toBe(0);

    const reset = await run({
      argv: ["reset-password", "--username", "doctor"],
      databasePath: path,
      secrets: [currentPassword, currentPassword],
    });

    expect(reset.code).not.toBe(0);
    expect(`${reset.stdout.join("\n")}\n${reset.stderr.join("\n")}`).not.toContain(currentPassword);
    const check = openDatabase(path);
    cleanups.push(check.close);
    expect(check.sqlite.prepare("SELECT revision FROM staff_accounts").get()).toEqual({ revision: 1 });
    expect(check.sqlite.prepare("SELECT action, entity_revision FROM audit_events").all()).toEqual([
      { action: "account.created", entity_revision: 1 },
    ]);
  });

  it("creates, resets, and disables an account with atomic system Audit evidence", async () => {
    const source = createTestDatabase();
    const directory = mkdtempSync(join(tmpdir(), "careflow-cli-"));
    const path = join(directory, "careflow.sqlite");
    source.close();
    copyFileSync(source.databasePath, path);
    source.cleanup();
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    const created = await run({
      argv: ["create", "--username", "doctor", "--display-name", "พญ. อริสรา", "--role", "doctor"],
      databasePath: path,
      secrets: ["วลีผ่านสำหรับคลินิก-1234", "วลีผ่านสำหรับคลินิก-1234"],
      texts: ["SYNTHETIC-ONLY"],
    });
    expect(created.code).toBe(0);
    expect(created.stdout.join("\n")).not.toContain("วลีผ่านสำหรับคลินิก-1234");

    const reset = await run({
      argv: ["reset-password", "--username", "doctor"],
      databasePath: path,
      secrets: ["วลีผ่านใหม่สำหรับคลินิก-5678", "วลีผ่านใหม่สำหรับคลินิก-5678"],
    });
    expect(reset.code).toBe(0);
    const disabled = await run({ argv: ["disable", "--username", "doctor"], databasePath: path });
    expect(disabled.code).toBe(0);

    const check = openDatabase(path);
    cleanups.push(check.close);
    const account = check.sqlite.prepare("SELECT * FROM staff_accounts").get() as Record<string, unknown>;
    expect(account).toMatchObject({ username: "doctor", role: "doctor", active: 0, revision: 3, must_change_password: 1 });
    expect(account.disabled_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(check.sqlite.prepare("SELECT count(*) AS count FROM sessions").get()).toEqual({ count: 0 });
    expect(check.sqlite.prepare("SELECT actor_role, action, entity_revision FROM audit_events ORDER BY rowid").all()).toEqual([
      { actor_role: "system", action: "account.created", entity_revision: 1 },
      { actor_role: "system", action: "account.password-reset", entity_revision: 2 },
      { actor_role: "system", action: "account.disabled", entity_revision: 3 },
    ]);
  });
});
