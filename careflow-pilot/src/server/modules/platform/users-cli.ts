import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { openDatabase } from "../../db/client.js";
import {
  appendMaintenanceAuditEvent,
  runMaintenanceAuditedTransaction,
} from "../../maintenance/audit.js";
import { sessions, staffAccounts } from "./schema.js";

const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export interface UsersCliDependencies {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  promptSecret(label: string): Promise<string>;
  promptText(label: string): Promise<string>;
  stdout(line: string): void;
  stderr(line: string): void;
}

function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validPassword(password: string, username: string): boolean {
  const length = Array.from(password).length;
  return (
    length >= 12 &&
    length <= 128 &&
    normalizeUsername(password) !== normalizeUsername(username)
  );
}

async function promptNewPassword(deps: UsersCliDependencies, username: string): Promise<string> {
  const password = await deps.promptSecret("New password: ");
  const confirmation = await deps.promptSecret("Confirm new password: ");
  if (password !== confirmation || !validPassword(password, username)) {
    throw new Error("invalid password");
  }
  return password;
}

type Role = "assistant" | "doctor";

export async function runUsersCli(deps: UsersCliDependencies): Promise<number> {
  let database: ReturnType<typeof openDatabase> | undefined;
  try {
    const databasePath = deps.env.CAREFLOW_DB_PATH?.trim() ?? "";
    if (!databasePath || !isAbsolute(databasePath) || !existsSync(databasePath)) {
      throw new Error("invalid database path");
    }
    const parsed = parseArgs({
      args: [...deps.argv],
      allowPositionals: true,
      strict: true,
      options: {
        username: { type: "string" },
        "display-name": { type: "string" },
        role: { type: "string" },
      },
    });
    const command = parsed.positionals[0];
    if (parsed.positionals.length !== 1 || !["create", "reset-password", "disable"].includes(command ?? "")) {
      throw new Error("invalid command");
    }
    const username = normalizeUsername(parsed.values.username ?? "");
    if (!username || Array.from(username).length > 120) throw new Error("invalid username");

    let passwordHash: string | undefined;
    if (command === "create") {
      const displayName = parsed.values["display-name"]?.trim() ?? "";
      const role = parsed.values.role;
      if (!displayName || Array.from(displayName).length > 120) throw new Error("invalid display name");
      if (role !== "assistant" && role !== "doctor") throw new Error("invalid role");
      deps.stdout("PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามกรอกข้อมูลผู้ป่วยจริง");
      const confirmation = await deps.promptText("Type SYNTHETIC-ONLY to continue: ");
      if (confirmation !== "SYNTHETIC-ONLY") throw new Error("operator aborted");
      passwordHash = await argon2.hash(await promptNewPassword(deps, username), PASSWORD_HASH_OPTIONS);
    } else {
      if (parsed.values["display-name"] !== undefined || parsed.values.role !== undefined) {
        throw new Error("unexpected options");
      }
      if (command === "reset-password") {
        passwordHash = await argon2.hash(await promptNewPassword(deps, username), PASSWORD_HASH_OPTIONS);
      }
    }

    database = openDatabase(databasePath);
    const now = new Date().toISOString();
    if (command === "create") {
      const accountId = randomUUID();
      const role = parsed.values.role as Role;
      const displayName = parsed.values["display-name"] as string;
      runMaintenanceAuditedTransaction({
        db: database.db,
        work: (tx) => {
          tx.insert(staffAccounts)
            .values({
              id: accountId,
              clinicId: "clinic",
              username,
              displayName,
              role,
              passwordHash: passwordHash as string,
              mustChangePassword: 1,
              pilotAcknowledgedAt: null,
              active: 1,
              revision: 1,
              lastPasswordChangedAt: now,
              disabledAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          appendMaintenanceAuditEvent({
            tx,
            id: randomUUID(),
            action: "account.created",
            entityType: "staff-account",
            entityId: accountId,
            entityRevision: 1,
            reason: null,
            occurredAt: now,
          });
        },
      });
    } else {
      const account = database.db
        .select()
        .from(staffAccounts)
        .where(eq(staffAccounts.username, username))
        .get();
      if (!account) throw new Error("account unavailable");
      const revision = account.revision + 1;
      runMaintenanceAuditedTransaction({
        db: database.db,
        work: (tx) => {
          tx.delete(sessions).where(eq(sessions.staffId, account.id)).run();
          if (command === "reset-password") {
            tx.update(staffAccounts)
              .set({
                passwordHash: passwordHash as string,
                mustChangePassword: 1,
                revision,
                lastPasswordChangedAt: now,
                updatedAt: now,
              })
              .where(eq(staffAccounts.id, account.id))
              .run();
          } else {
            tx.update(staffAccounts)
              .set({ active: 0, disabledAt: now, revision, updatedAt: now })
              .where(eq(staffAccounts.id, account.id))
              .run();
          }
          appendMaintenanceAuditEvent({
            tx,
            id: randomUUID(),
            action: command === "reset-password" ? "account.password-reset" : "account.disabled",
            entityType: "staff-account",
            entityId: account.id,
            entityRevision: revision,
            reason: null,
            occurredAt: now,
          });
        },
      });
    }
    deps.stdout("User account command completed");
    return 0;
  } catch {
    deps.stderr("User account command failed");
    return 1;
  } finally {
    database?.close();
  }
}
