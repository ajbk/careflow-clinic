import { expect, test } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

test.describe("shared Visit journey", () => {
  test("Assistant and Doctor observe one Visit through independent sessions", async ({ browser }) => {
    const server = await startPilotServer();
    const assistantContext = await browser.newContext();
    const doctorContext = await browser.newContext();
    const assistantPage = await assistantContext.newPage();
    const doctorPage = await doctorContext.newPage();
    try {
      await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
      await expect(assistantPage).toHaveURL(/\/intake$/);
      await assistantPage.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
      await expect(assistantPage.locator(".patient-header")).toBeVisible();
      const patientHeader = assistantPage.locator(".patient-header");
      const hnMatch = (await patientHeader.innerText()).match(/HN DEMO-\d{6}/)?.[0];
      expect(hnMatch).toMatch(/^HN DEMO-\d{6}$/);
      const hn = hnMatch as string;
      await assistantPage.getByLabel("อาการสำคัญ *").fill("ไอและมีไข้");
      await assistantPage.getByRole("button", { name: "ส่งพบแพทย์" }).click();
      await expect(assistantPage).toHaveURL(/\/queue$/);
      await expect(assistantPage.locator(".queue-card")).toContainText(hn);
      const visitId = await assistantPage.locator(".queue-card").first().getAttribute("aria-label");
      expect(visitId).toMatch(/^DEMO-\d{6} .+/);

      await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
      await expect(doctorPage).toHaveURL(/\/queue$/);
      await expect(doctorPage.locator(".queue-card")).toContainText(hn);
      await doctorPage.getByRole("button", { name: "เริ่มการตรวจ" }).click();
      await expect(doctorPage).toHaveURL(/\/consultations\/[^/]+$/);
      await expect(doctorPage.getByRole("heading", { name: "ห้องตรวจผู้ป่วย" })).toBeVisible();
      await expect(doctorPage.locator(".status-active").first()).toContainText("กำลังตรวจ");
      await expect(doctorPage.locator(".consultation-patient-rail")).toContainText(hn);
      await expect(doctorPage.locator(".consultation-clinical-content")).toBeVisible();

      const consultationPath = new URL(doctorPage.url()).pathname;
      const consultingVisitId = consultationPath.replace("/consultations/", "");
      const assistantWorkspaceRequests: string[] = [];
      assistantPage.on("request", (request) => {
        const requestPath = new URL(request.url()).pathname;
        if (requestPath === `/api/visits/${consultingVisitId}/workspace`) {
          assistantWorkspaceRequests.push(requestPath);
        }
      });

      await assistantPage.goto(`${server.baseURL}/queue`);
      await expect(assistantPage.locator(".queue-card")).toContainText(hn);
      await expect(assistantPage.locator(".status-active").first()).toContainText("กำลังตรวจ");
      await expect(assistantPage.getByRole("link", { name: "เปิดห้องตรวจ" })).toHaveCount(0);

      await assistantPage.goto(`${server.baseURL}${consultationPath}`);
      await expect(assistantPage.getByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeVisible();
      await expect(assistantPage.locator(".pilot-banner")).toHaveCount(1);
      await expect(assistantPage.locator(".clinical-workspace-grid, .consultation-patient-rail, .consultation-clinical-content")).toHaveCount(0);
      await expect(assistantPage.getByText(hn, { exact: false })).toHaveCount(0);
      expect(assistantWorkspaceRequests).toHaveLength(0);
      expect(await assistantPage.evaluate(() => localStorage.length)).toBe(0);
      expect(await doctorPage.evaluate(() => localStorage.length)).toBe(0);
    } finally {
      await assistantContext.close();
      await doctorContext.close();
      await server.close();
    }
  });
});
