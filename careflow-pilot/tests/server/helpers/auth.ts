import argon2 from "argon2";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import type { Actor } from "../../../src/shared/contracts.js";
import type { TestDatabase } from "./database.js";

export const TEST_PASSWORD = "รหัสผ่านทดสอบ-1234";
export const TEST_NEW_PASSWORD = "รหัสผ่านใหม่ทดสอบ-5678";

export interface SeedAccountOptions {
  id?: string;
  username?: string;
  displayName?: string;
  role?: Actor["role"];
  password?: string;
  mustChangePassword?: boolean;
  pilotAcknowledgedAt?: string | null;
  active?: boolean;
  now?: string;
}

export async function seedAccount(
  database: TestDatabase,
  options: SeedAccountOptions = {},
): Promise<{ actor: Actor; username: string; password: string; passwordHash: string }> {
  const now = options.now ?? "2026-08-03T00:00:00.000Z";
  const username = options.username ?? "doctor";
  const password = options.password ?? TEST_PASSWORD;
  const actor: Actor = {
    id: options.id ?? `${username}-001`,
    role: options.role ?? "doctor",
    displayName: options.displayName ?? "พญ. ทดสอบ",
  };
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });

  database.sqlite
    .prepare(
      `INSERT INTO staff_accounts (
        id, clinic_id, username, display_name, role, password_hash,
        must_change_password, pilot_acknowledged_at, active, revision,
        last_password_changed_at, disabled_at, created_at, updated_at
      ) VALUES (?, 'clinic', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      actor.id,
      username,
      actor.displayName,
      actor.role,
      passwordHash,
      options.mustChangePassword === false ? 0 : 1,
      options.pilotAcknowledgedAt === undefined ? now : options.pilotAcknowledgedAt,
      options.active === false ? 0 : 1,
      now,
      options.active === false ? now : null,
      now,
      now,
    );

  return { actor, username, password, passwordHash };
}

export function cookieFrom(response: LightMyRequestResponse): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected Set-Cookie");
  return value.split(";", 1)[0] ?? "";
}

export function rawTokenFrom(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

export async function login(
  app: FastifyInstance,
  username: string,
  password: string,
  options: Omit<InjectOptions, "method" | "url" | "payload"> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
}
