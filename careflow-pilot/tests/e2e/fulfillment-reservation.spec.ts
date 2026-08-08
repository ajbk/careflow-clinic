import { expect, test, type Page } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

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
  const visitId = (await card.getAttribute("aria-label"))?.trim().match(/\S+$/)?.[0];
  expect(visitId).toBeTruthy();
  return { hn: hn as string, visitId: visitId as string };
}

async function reviewAllergy(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }).click();
  const dialog = page.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "NONE_KNOWN" }).click();
  await dialog.getByRole("button", { name: "บันทึกการทบทวน" }).click();
  await expect(dialog).toHaveCount(0);
}

async function signOrder(page: Page): Promise<void> {
  await page.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill("อาการสังเคราะห์สำหรับการจองล็อต");
  await page.getByLabel("Objective (ผลตรวจ)").fill("ผลตรวจสังเคราะห์สำหรับการจองล็อต");
  await page.getByLabel("Assessment (การประเมิน)").fill("การประเมินสังเคราะห์");
  await page.getByLabel("Plan (แผนการดูแล)").fill("แผนสังเคราะห์สำหรับการจัดยา");
  await page.getByRole("textbox", { name: "การวินิจฉัย", exact: true }).fill("การวินิจฉัยสังเคราะห์");
  await page.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }).click();
  await page.getByLabel("ค้นหารายการยา").fill("DEMO-MED-001");
  await page.getByRole("button", { name: /เลือก \[DEMO\] ยาทดสอบชนิด A/ }).click();
  await page.getByLabel("จำนวน").fill("8");
  await page.getByLabel("วิธีใช้ยา").fill("รับประทานเมื่อมีอาการ");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("button", { name: "ลงนามและส่งต่อ" })).toBeEnabled();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function receiveLot(page: Page, input: { key: string; lotNumber: string; expiryDate: string; quantity: number }): Promise<void> {
  const response = await page.request.post(`${new URL(page.url()).origin}/api/inventory/receipts`, {
    headers: { "idempotency-key": input.key },
    data: {
      expectedRevisions: { medication: 1 },
      payload: {
        medicationId: "DEMO-MED-001",
        quantity: input.quantity,
        lotNumber: input.lotNumber,
        expiryDate: input.expiryDate,
        supplierName: "ผู้จำหน่าย E2E",
        note: "รับเข้าทดสอบ FEFO",
      },
    },
  });
  expect(response.status()).toBe(201);
}

test("reserves a signed Order across future lots in FEFO order and shares the Pick List", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistantPage = await assistantContext.newPage();
  const doctorPage = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
    const patient = await createQueuedPatient(assistantPage, "อาการสังเคราะห์สำหรับ FEFO");
    await reviewAllergy(assistantPage);

    await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
    const doctorCard = doctorPage.locator(".queue-card").filter({ hasText: patient.hn });
    await expect(doctorCard).toHaveCount(1);
    await doctorCard.getByRole("button", { name: "เริ่มการตรวจ" }).click();
    await expect(doctorPage).toHaveURL(/\/consultations\/[^/]+$/);
    await signOrder(doctorPage);

    await receiveLot(assistantPage, { key: "e2e-fefo-early", lotNumber: "E2E-FEFO-EARLY", expiryDate: "2030-08-10", quantity: 5 });
    await receiveLot(assistantPage, { key: "e2e-fefo-late", lotNumber: "E2E-FEFO-LATE", expiryDate: "2030-08-20", quantity: 10 });

    await assistantPage.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(assistantPage.getByRole("heading", { name: "จัดยา" })).toBeVisible();
    await expect(assistantPage.getByText("ยาทดสอบชนิด A", { exact: false })).toBeVisible();
    await assistantPage.getByRole("button", { name: "เริ่มจองล็อตตาม FEFO" }).click();
    await expect(assistantPage.getByText("PREPARING", { exact: true })).toBeVisible();
    await expect(assistantPage.getByText("E2E-FEFO-EARLY", { exact: true })).toBeVisible();
    await expect(assistantPage.getByText("5 เม็ด", { exact: true })).toBeVisible();
    await expect(assistantPage.getByText("E2E-FEFO-LATE", { exact: true })).toBeVisible();
    await expect(assistantPage.getByText("3 เม็ด", { exact: true })).toBeVisible();

    await doctorPage.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(doctorPage.getByRole("heading", { name: "จัดยา" })).toBeVisible();
    await expect(doctorPage.getByText("PREPARING", { exact: true })).toBeVisible();
    await expect(doctorPage.getByText("E2E-FEFO-EARLY", { exact: true })).toBeVisible();
    await expect(doctorPage.getByText("E2E-FEFO-LATE", { exact: true })).toBeVisible();
    await expect(doctorPage.getByRole("button", { name: "เริ่มจองล็อตตาม FEFO" })).toHaveCount(0);

    // A second signed Order asks for eight units while only seven remain available.
    // The all-or-nothing command must leave that Visit and every allocation untouched.
    await assistantPage.goto(`${server.baseURL}/intake`);
    const secondPatient = await createQueuedPatient(assistantPage, "อาการสังเคราะห์สต็อกไม่พอ");
    await reviewAllergy(assistantPage);
    await doctorPage.goto(`${server.baseURL}/queue`);
    const secondDoctorCard = doctorPage.locator(".queue-card").filter({ hasText: secondPatient.hn });
    await expect(secondDoctorCard).toHaveCount(1);
    await secondDoctorCard.getByRole("button", { name: "เริ่มการตรวจ" }).click();
    await expect(doctorPage).toHaveURL(/\/consultations\/[^/]+$/);
    await signOrder(doctorPage);

    await assistantPage.goto(`${server.baseURL}/dispensing/${secondPatient.visitId}`);
    await assistantPage.getByRole("button", { name: "เริ่มจองล็อตตาม FEFO" }).click();
    await expect(assistantPage.getByRole("alert")).toContainText("ไม่เพียงพอ");
    await expect(assistantPage.getByText("AWAITING_PREPARATION", { exact: true })).toBeVisible();
    await expect(assistantPage.getByText("E2E-FEFO-EARLY", { exact: true })).toHaveCount(0);
    await expect(assistantPage.getByText("E2E-FEFO-LATE", { exact: true })).toHaveCount(0);
    const insufficientPickList = await assistantPage.request.get(`${server.baseURL}/api/dispensing/${secondPatient.visitId}`);
    expect(insufficientPickList.status()).toBe(200);
    await expect(insufficientPickList.json()).resolves.toMatchObject({ data: {
      visit: { status: "AWAITING_PREPARATION" },
      reservation: null,
    } });
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});
