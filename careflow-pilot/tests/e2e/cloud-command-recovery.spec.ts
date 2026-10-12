import { expect, test } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

test("HTTPS cloud browser clears an unsent stock draft when another tab changes the account", async ({ browser }) => {
  const server = await startPilotServer({ cloud: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const first = await context.newPage();
  try {
    await loginAndAcknowledge(first, server.baseURL, "assistant");
    await first.goto(`${server.baseURL}/inventory/receive`);
    await first.getByLabel("ผู้ผลิต / ผู้จัดจำหน่าย").fill("ร่างเดิมของผู้ช่วยสังเคราะห์");
    const second = await context.newPage();
    await loginAndAcknowledge(second, server.baseURL, "doctor");
    await first.bringToFront();
    await expect(first.getByLabel("ผู้ผลิต / ผู้จัดจำหน่าย")).toHaveValue("");
    expect(server.database.sqlite.prepare("SELECT count(*) FROM inventory_receipts").pluck().get()).toBe(0);
  } finally { await context.close(); await server.close(); }
});

test("HTTPS cloud browser recovers a committed command after a lost response and reload without duplicate effect", async ({ browser }) => {
  const server = await startPilotServer({ cloud: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await context.newPage();
  try {
    await loginAndAcknowledge(page, server.baseURL, "assistant");
    await page.goto(`${server.baseURL}/intake`);
    let posts = 0;
    await page.route("**/api/patients/synthetic", async (route) => { posts++; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort("failed"); });
    await page.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
    await expect(page.getByRole("alert", { name: "ตรวจสอบผลคำสั่งค้าง" })).toBeVisible();
    expect(server.database.sqlite.prepare("SELECT count(*) n FROM patients").get()).toEqual({ n: 1 });
    await page.unroute("**/api/patients/synthetic"); await page.reload();
    await expect(page.getByRole("button", { name: "ตรวจสอบผลคำสั่ง" })).toBeVisible();
    const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(storage).not.toContain("DEMO-"); expect(storage).not.toContain("csrf");
    await page.getByRole("button", { name: "ตรวจสอบผลคำสั่ง", exact: true }).click();
    await expect(page.getByText(/ระบบบันทึกคำสั่งเดิมแล้ว/)).toBeVisible();
    expect(posts).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) n FROM patients").get()).toEqual({ n: 1 });
    expect(server.database.sqlite.prepare("SELECT count(*) n FROM idempotency_records WHERE operation='patient.create-synthetic.v1'").get()).toEqual({ n: 1 });
    await page.screenshot({ path: "test-results/cloud-recovery-notice.png", fullPage: true });
  } finally { await context.close(); await server.close(); }
});
