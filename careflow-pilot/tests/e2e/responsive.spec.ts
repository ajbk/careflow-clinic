import { expect, test, type Page } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

const viewports = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function expectSinglePilotBanner(page: Page): Promise<void> {
  const banner = page.locator(".pilot-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectControlsAtLeast48Px(page: Page): Promise<void> {
  const controls = page.locator("button.care-button, a.care-button, .primary-button");
  for (const control of await controls.all()) {
    await expect(control).toHaveCSS("min-height", /^(4[89]|[5-9]\d|\d{3,})px$/);
  }
}

for (const viewport of viewports) {
  test(`responsive guardrails at ${viewport.name}`, async ({ browser }) => {
    const server = await startPilotServer();
    const assistantContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const doctorContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const assistantPage = await assistantContext.newPage();
    const doctorPage = await doctorContext.newPage();
    try {
      await assistantPage.goto(`${server.baseURL}/login`);
      await expectSinglePilotBanner(assistantPage);
      await assistantPage.locator("#username").focus();
      await assistantPage.keyboard.press("Tab");
      await expect(assistantPage.locator("#password")).toBeFocused();
      await expect(assistantPage.getByRole("button", { name: "เข้าสู่ระบบ" })).toHaveCSS("min-height", "48px");

      await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
      await expect(assistantPage).toHaveURL(/\/intake$/);
      for (const route of ["/intake", "/queue"]) {
        await assistantPage.goto(`${server.baseURL}${route}`);
        await expectSinglePilotBanner(assistantPage);
        await expectNoHorizontalOverflow(assistantPage);
        await expectControlsAtLeast48Px(assistantPage);
      }

      await assistantPage.goto(`${server.baseURL}/consultations/unknown-visit`);
      await expect(assistantPage.getByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeVisible();
      await expectSinglePilotBanner(assistantPage);
      await expectNoHorizontalOverflow(assistantPage);
      await expect(assistantPage.locator(".consultation-page, .clinical-workspace-grid")).toHaveCount(0);
      await expect(assistantPage.getByText(/รีเซ็ตข้อมูล|Reset synthetic|ล้างข้อมูล/i)).toHaveCount(0);

      await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
      await expect(doctorPage).toHaveURL(/\/queue$/);
      for (const route of ["/queue", "/consultations/unknown-visit"]) {
        await doctorPage.goto(`${server.baseURL}${route}`);
        if (route.startsWith("/consultations/")) {
          await expect(doctorPage.getByRole("heading", { name: "ไม่พบข้อมูลห้องตรวจ" })).toBeVisible();
          await expect(doctorPage.locator(".consultation-page")).toBeVisible();
        }
        await expectSinglePilotBanner(doctorPage);
        await expectNoHorizontalOverflow(doctorPage);
      }
    } finally {
      await assistantContext.close();
      await doctorContext.close();
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
