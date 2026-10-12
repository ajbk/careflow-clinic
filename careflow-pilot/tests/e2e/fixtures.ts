import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { Page } from "@playwright/test";
import { buildApp } from "../../src/server/app.js";
import { openDatabase, type DatabaseHandle } from "../../src/server/db/client.js";
import { initializeCloudDatabase } from "../../src/server/maintenance/deployment.js";
import { createCloudTestProxy } from "./cloud-proxy.js";
import type { AppConfig } from "../../src/server/config.js";

export const E2E_PASSWORD = "careflow-pilot-e2e-password";

interface PilotServer {
  readonly app: FastifyInstance;
  readonly database: DatabaseHandle;
  directory: string;
  readonly baseURL: string;
  expireSessionsForStaff: (staffId: string) => void;
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

export async function startPilotServer(options: { cloud?: boolean } = { cloud: process.env.CAREFLOW_E2E_CLOUD === "true" }): Promise<PilotServer> {
  const directory = mkdtempSync(join(tmpdir(), "careflow-e2e-"));
  const databasePath = join(directory, "careflow.sqlite");
  // E2E never mutates built assets. Share this immutable build instead of making
  // a native recursive copy per case (macOS fcopyfile can stall before startup).
  const clientDistPath = resolve(process.cwd(), "dist/client");
  if (!existsSync(clientDistPath)) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("CareFlow E2E requires a built client; run npm run build first");
  }
  const proxy = options.cloud ? await createCloudTestProxy(directory) : undefined;
  if (proxy) initializeCloudDatabase(databasePath, "synthetic-e2e");
  const database = openDatabase(databasePath, { environmentId: proxy ? "synthetic-e2e" : undefined });
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

  const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      databasePath,
      cookieSecure: Boolean(proxy),
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath,
      ...(proxy ? { cloud: { publicOrigin: proxy.origin, trustedProxies: ["127.0.0.1"], environmentId: "synthetic-e2e" } } : {}),
  };
  let requestIndex = 0;
  const idFactory = () => `e2e-${++requestIndex}`;
  const nextApp = async (handle: DatabaseHandle) => buildApp({
    db: handle,
    config,
    clock: () => new Date(),
    idFactory,
    serveStatic: true,
    clientAssetsRoot: clientDistPath,
  });
  let activeDatabase = database;
  let activeApp = await nextApp(activeDatabase);
  let activeBaseURL = await activeApp.listen({ host: "127.0.0.1", port: 0 });
  proxy?.setUpstream(activeBaseURL);
  const server: PilotServer = {
    get app() { return activeApp; },
    get database() { return activeDatabase; },
    directory,
    get baseURL() { return proxy?.origin ?? activeBaseURL; },
    expireSessionsForStaff: (staffId) => {
      activeDatabase.sqlite.prepare("UPDATE sessions SET last_seen_at = ? WHERE staff_id = ?")
        .run(new Date(Date.now() - 16 * 60_000).toISOString(), staffId);
    },
    restart: async () => {
      await activeApp.close();
      activeDatabase.close();
      activeDatabase = openDatabase(databasePath, { environmentId: proxy ? "synthetic-e2e" : undefined });
      activeApp = await nextApp(activeDatabase);
      activeBaseURL = await activeApp.listen({ host: "127.0.0.1", port: 0 });
      proxy?.setUpstream(activeBaseURL);
    },
    close: async () => {
      await activeApp.close();
      activeDatabase.close();
      await proxy?.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
  return server;
}

export async function loginAndAcknowledge(page: Page, baseURL: string, username: string): Promise<void> {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("ชื่อผู้ใช้").fill(username);
  await page.getByLabel("รหัสผ่าน").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  const acknowledgement = page.getByRole("checkbox");
  if (await acknowledgement.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await acknowledgement.check();
    await page.getByRole("button", { name: "ยืนยันและดำเนินการต่อ" }).click();
  }
}
