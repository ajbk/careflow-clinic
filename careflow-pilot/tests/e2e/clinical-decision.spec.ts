import { expect, test, type Page } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

type DecisionKind = "ORDER" | "NO_MEDICATION";

async function createQueuedPatient(page: Page, complaint: string): Promise<{ hn: string; visitId: string }> {
  await page.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
  const header = page.locator(".patient-header");
  await expect(header).toBeVisible();
  const hn = (await header.innerText()).match(/HN DEMO-\d{6}/)?.[0];
  expect(hn).toMatch(/^HN DEMO-\d{6}$/);
  await page.getByLabel("อาการสำคัญ *").fill(complaint);
  await page.getByRole("button", { name: "ส่งพบแพทย์" }).click();
  await expect(page).toHaveURL(/\/queue$/);
  const card = page.locator(".queue-card").filter({ hasText: hn as string });
  await expect(card).toHaveCount(1);
  const visitId = await card.getAttribute("aria-label");
  expect(visitId).toBeTruthy();
  return { hn: hn as string, visitId: visitId as string };
}

async function reviewAllergy(page: Page, state: "UNKNOWN" | "NONE_KNOWN"): Promise<void> {
  await page.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }).click();
  const dialog = page.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: state }).click();
  await dialog.getByRole("button", { name: "บันทึกการทบทวน" }).click();
  await expect(dialog).toHaveCount(0);
}

async function completeNote(page: Page): Promise<void> {
  await page.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill("อาการสังเคราะห์สำหรับการทดสอบ");
  await page.getByLabel("Objective (ผลตรวจ)").fill("ผลตรวจสังเคราะห์สำหรับการทดสอบ");
  await page.getByLabel("Assessment (การประเมิน)").fill("การประเมินสังเคราะห์");
  await page.getByLabel("Plan (แผนการดูแล)").fill("แผนสังเคราะห์");
  await page.getByRole("textbox", { name: "การวินิจฉัย", exact: true }).fill("การวินิจฉัยสังเคราะห์");
}

async function signDecision(page: Page, kind: DecisionKind): Promise<{ noteHash: string; decisionVersion: string }> {
  await completeNote(page);
  if (kind === "ORDER") {
    await page.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }).click();
    await page.getByLabel("ค้นหารายการยา").fill("DEMO-MED-001");
    await page.getByRole("button", { name: /เลือก \[DEMO\] ยาทดสอบชนิด A/ }).click();
    await page.getByLabel("วิธีใช้ยา").fill("วิธีใช้สังเคราะห์");
  } else {
    await page.getByRole("button", { name: "ไม่สั่งยา" }).click();
    await page.getByLabel("เหตุผลที่ไม่สั่งยา").fill("ยังไม่จำเป็นต้องสั่งยาในการทดสอบ");
  }
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("button", { name: "ลงนามและส่งต่อ" })).toBeEnabled();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  const evidence = page.getByRole("region", { name: "หลักฐานลงนาม" });
  await expect(evidence).toBeVisible();
  const noteHash = await evidence.locator("code").innerText();
  const decisionVersion = (await evidence.getByText(/การตัดสินใจยา:/).innerText()).match(/เวอร์ชัน (\d+)/)?.[1] ?? "";
  expect(noteHash).toMatch(/^[a-f0-9]{64}$/);
  expect(decisionVersion).toBe("1");
  return { noteHash, decisionVersion };
}

for (const journey of [
  { name: "ORDER", allergy: "NONE_KNOWN", expectedStatus: "รอจัดยา" },
  { name: "NO_MEDICATION", allergy: "UNKNOWN", expectedStatus: "รอคิดเงิน" },
] as const) {
  test(`${journey.name} persists signed clinical evidence and shared pending state across reload`, async ({ browser }) => {
    const server = await startPilotServer();
    const assistantContext = await browser.newContext();
    const doctorContext = await browser.newContext();
    const assistantPage = await assistantContext.newPage();
    const doctorPage = await doctorContext.newPage();
    try {
      await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
      const patient = await createQueuedPatient(assistantPage, `อาการสังเคราะห์ ${journey.name}`);
      await reviewAllergy(assistantPage, journey.allergy);

      await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
      const doctorCard = doctorPage.locator(".queue-card").filter({ hasText: patient.hn });
      await expect(doctorCard).toHaveCount(1);
      await doctorCard.getByRole("button", { name: "เริ่มการตรวจ" }).click();
      await expect(doctorPage).toHaveURL(/\/consultations\/[^/]+$/);
      const consultationPath = new URL(doctorPage.url()).pathname;
      const signed = await signDecision(doctorPage, journey.name);

      await doctorPage.reload();
      const evidence = doctorPage.getByRole("region", { name: "หลักฐานลงนาม" });
      await expect(evidence.locator("code")).toHaveText(signed.noteHash);
      await expect(evidence.getByText(/การตัดสินใจยา:/)).toContainText(`เวอร์ชัน ${signed.decisionVersion}`);

      const workspaceDenied = await assistantPage.request.get(`${server.baseURL}/api/visits/${patient.visitId}/workspace`);
      expect(workspaceDenied.status()).toBe(403);
      await assistantPage.goto(`${server.baseURL}${consultationPath}`);
      await expect(assistantPage.getByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeVisible();
      await expect(assistantPage.locator(".clinical-workspace-grid, .consultation-patient-rail, .consultation-clinical-content")).toHaveCount(0);
      await expect(assistantPage.getByText(patient.hn, { exact: false })).toHaveCount(0);

      await assistantPage.goto(`${server.baseURL}/queue`);
      await expect(assistantPage.locator(".queue-card").filter({ hasText: patient.hn })).toContainText(journey.expectedStatus);
      await assistantPage.goto(`${server.baseURL}/overview`);
      await expect(assistantPage.getByLabel("สรุปสถานะคลินิก")).toContainText(journey.expectedStatus);
    } finally {
      await assistantContext.close();
      await doctorContext.close();
      await server.close();
    }
  });
}
