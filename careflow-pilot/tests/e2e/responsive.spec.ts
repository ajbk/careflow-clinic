import { expect, test } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

const viewports = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`responsive guardrails at ${viewport.name}`, async ({ browser }) => {
    const server = await startPilotServer();
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    try {
      await page.goto(`${server.baseURL}/login`);
      await expect(page.locator(".pilot-banner")).toBeVisible();
      await page.locator("#username").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("#password")).toBeFocused();
      await expect(page.getByRole("button", { name: "เข้าสู่ระบบ" })).toHaveCSS("min-height", "48px");

      await loginAndAcknowledge(page, server.baseURL, "assistant");
      for (const route of ["/intake", "/queue", "/consultations/unknown-visit"]) {
        await page.goto(`${server.baseURL}${route}`);
        await expect(page.locator(".pilot-banner")).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await expect(page.getByText(/รีเซ็ตข้อมูล|Reset synthetic|ล้างข้อมูล/i)).toHaveCount(0);
      const controls = page.locator("button.care-button, .primary-button");
      for (const control of await controls.all()) {
        await expect(control).toHaveCSS("min-height", /^(4[89]|[5-9]\d|\d{3,})px$/);
      }
    } finally {
      await context.close();
      await server.close();
    }
  });
}

test("bounds the Doctor clinical page by the shared desktop content width", async ({ browser }) => {
  const server = await startPilotServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await loginAndAcknowledge(page, server.baseURL, "doctor");
    await page.goto(`${server.baseURL}/consultations/unknown-visit`);

    const consultationPage = page.locator(".consultation-page");
    await expect(consultationPage).toBeVisible();
    expect(await consultationPage.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(1120);
  } finally {
    await context.close();
    await server.close();
  }
});
