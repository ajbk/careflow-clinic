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

async function expectVisibleControlsAtLeast48Px(page: Page): Promise<void> {
  const controls = page.locator("button.care-button:visible, a.care-button:visible, .primary-button:visible");
  await expect.poll(() => controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    await expect(control).toBeVisible();
    expect(await control.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
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
      await expectVisibleControlsAtLeast48Px(assistantPage);

      await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
      await expect(assistantPage).toHaveURL(/\/intake$/);
      await expectSinglePilotBanner(assistantPage);
      await expectNoHorizontalOverflow(assistantPage);
      await expectVisibleControlsAtLeast48Px(assistantPage);

      await assistantPage.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
      const patientHeader = assistantPage.locator(".patient-header");
      await expect(patientHeader).toBeVisible();
      const hnMatch = (await patientHeader.innerText()).match(/HN DEMO-\d{6}/)?.[0];
      expect(hnMatch).toMatch(/^HN DEMO-\d{6}$/);
      const hn = hnMatch as string;
      await assistantPage.getByLabel("อาการสำคัญ *").fill(`ไอและมีไข้ ${viewport.name}`);
      await assistantPage.getByRole("button", { name: "ส่งพบแพทย์" }).click();
      await expect(assistantPage).toHaveURL(/\/queue$/);
      await expect(assistantPage.locator(".queue-card")).toContainText(hn);
      await expectSinglePilotBanner(assistantPage);
      await expectNoHorizontalOverflow(assistantPage);
      await expectVisibleControlsAtLeast48Px(assistantPage);
      await expect(assistantPage.getByText(/รีเซ็ตข้อมูล|Reset synthetic|ล้างข้อมูล/i)).toHaveCount(0);

      const reviewAllergy = assistantPage.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" });
      await reviewAllergy.focus();
      await assistantPage.keyboard.press("Space");
      const allergyDialog = assistantPage.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
      await expect(allergyDialog).toBeVisible();
      await expect.poll(() => assistantPage.evaluate(() => {
        const topLayer = document.elementFromPoint(window.innerWidth / 2, 32);
        return Boolean(topLayer?.closest(".dialog-backdrop"));
      })).toBe(true);
      await allergyDialog.getByRole("button", { name: "ยกเลิก" }).click();

      await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
      await expect(doctorPage).toHaveURL(/\/queue$/);
      await expect(doctorPage.locator(".queue-card")).toContainText(hn);
      await expectSinglePilotBanner(doctorPage);
      await expectNoHorizontalOverflow(doctorPage);
      await expectVisibleControlsAtLeast48Px(doctorPage);

      const startConsultation = doctorPage.getByRole("button", { name: "เริ่มการตรวจ" });
      await startConsultation.focus();
      await doctorPage.keyboard.press("Enter");
      await expect(doctorPage).toHaveURL(/\/consultations\/[^/]+$/);
      const consultationPath = new URL(doctorPage.url()).pathname;
      await expect(doctorPage.getByRole("heading", { name: "ห้องตรวจผู้ป่วย" })).toBeVisible();
      await expect(doctorPage.locator(".consultation-patient-rail")).toContainText(hn);
      await expect(doctorPage.locator(".consultation-clinical-content")).toBeVisible();
      await expect(doctorPage.getByRole("button", { name: "ทบทวนประวัติแพ้" })).toBeVisible();
      await expect(doctorPage.getByLabel("Clinical Note editor")).toBeVisible();
      await expect(doctorPage.getByLabel("Medication decision")).toBeVisible();
      const signAction = doctorPage.getByRole("button", { name: "ลงนามและส่งต่อ" });
      await signAction.scrollIntoViewIfNeeded();
      await expect(signAction).toBeVisible();
      expect(await signAction.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
      await expect.poll(() => signAction.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
      })).toBe(true);
      if (viewport.name === "phone") {
        const rail = doctorPage.locator(".consultation-patient-rail");
        const clinicalContent = doctorPage.locator(".consultation-clinical-content");
        const railBox = await rail.boundingBox();
        const contentBox = await clinicalContent.boundingBox();
        expect(railBox).not.toBeNull();
        expect(contentBox).not.toBeNull();
        expect((railBox?.y ?? 0) + (railBox?.height ?? 0)).toBeLessThanOrEqual(contentBox?.y ?? 0);
      }
      await expectSinglePilotBanner(doctorPage);
      await expectNoHorizontalOverflow(doctorPage);
      await expectVisibleControlsAtLeast48Px(doctorPage);

      await assistantPage.goto(`${server.baseURL}${consultationPath}`);
      await expect(assistantPage.getByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeVisible();
      await expectSinglePilotBanner(assistantPage);
      await expectNoHorizontalOverflow(assistantPage);
      await expect(assistantPage.locator(".consultation-page, .clinical-workspace-grid, .consultation-patient-rail, .consultation-clinical-content")).toHaveCount(0);
      await expect(assistantPage.getByText(hn, { exact: false })).toHaveCount(0);
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
