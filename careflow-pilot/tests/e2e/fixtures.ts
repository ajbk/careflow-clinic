import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { Page } from "@playwright/test";
import { buildApp } from "../../src/server/app.js";
import { openDatabase, type DatabaseHandle } from "../../src/server/db/client.js";

export const E2E_PASSWORD = "careflow-pilot-e2e-password";

interface PilotServer {
  app: FastifyInstance;
  database: DatabaseHandle;
  directory: string;
  baseURL: string;
  close: () => Promise<void>;
}

export async function startPilotServer(): Promise<PilotServer> {
  const directory = mkdtempSync(join(tmpdir(), "careflow-e2e-"));
  const databasePath = join(directory, "careflow.sqlite");
  const database = openDatabase(databasePath);
  const now = new Date().toISOString();
  const passwordHash = await argon2.hash(E2E_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  const insertAccount = database.sqlite.prepare(
    `INSERT INTO staff_accounts (
      id, clinic_id, username, display_name, role, password_hash,
      must_change_password, pilot_acknowledged_at, active, revision,
      last_password_changed_at, disabled_at, created_at, updated_at
    ) VALUES (?, 'clinic', ?, ?, ?, ?, 0, NULL, 1, 1, ?, NULL, ?, ?)`,
  );
  insertAccount.run("assistant-e2e-001", "assistant", "ผู้ช่วย E2E", "assistant", passwordHash, now, now, now);
  insertAccount.run("doctor-e2e-001", "doctor", "พญ. E2E", "doctor", passwordHash, now, now, now);

  const app = await buildApp({
    db: database,
    config: {
      host: "127.0.0.1",
      port: 0,
      databasePath,
      cookieSecure: false,
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath: resolve(process.cwd(), "dist/client"),
    },
    clock: () => new Date(),
    idFactory: (() => {
      let index = 0;
      return () => `e2e-${++index}`;
    })(),
    serveStatic: true,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    app,
    database,
    directory,
    baseURL: address,
    close: async () => {
      await app.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export async function loginAndAcknowledge(page: Page, baseURL: string, username: string): Promise<void> {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("ชื่อผู้ใช้").fill(username);
  await page.getByLabel("รหัสผ่าน").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "ยืนยันและดำเนินการต่อ" }).click();
}
