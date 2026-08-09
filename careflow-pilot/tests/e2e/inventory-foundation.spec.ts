import { expect, test } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

test("assistant and doctor can receive synthetic lots under the explicit pilot role matrix", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistantPage = await assistantContext.newPage();
  const doctorPage = await doctorContext.newPage();
  const expiryDate = "2030-08-31";
  try {
    await loginAndAcknowledge(assistantPage, server.baseURL, "assistant");
    await assistantPage.goto(`${server.baseURL}/inventory`);
    await expect(assistantPage).toHaveURL(/\/inventory$/);
    await assistantPage.getByRole("link", { name: "รับยาเข้าคลัง" }).click();
    await expect(assistantPage).toHaveURL(/\/inventory\/receive$/);

    await assistantPage.getByRole("combobox", { name: "ค้นหายา" }).fill("DEMO");
    await assistantPage.getByRole("option", { name: /\[DEMO\] ยาทดสอบชนิด A/ }).click();
    await assistantPage.getByRole("spinbutton", { name: "จำนวนที่รับ" }).fill("10");
    await assistantPage.getByRole("textbox", { name: "เลขที่ล็อต" }).fill("E2E-2608");
    await assistantPage.getByLabel("วันหมดอายุ").fill(expiryDate);
    await assistantPage.getByRole("textbox", { name: /ผู้ผลิต \/ ผู้จัดจำหน่าย/ }).fill("ผู้จำหน่าย E2E");
    await assistantPage.getByRole("button", { name: "ยืนยันการรับยา" }).click();

    await expect(assistantPage).toHaveURL(/\/inventory$/);
    const inventoryRow = assistantPage.locator(".inventory-table tbody tr").filter({ hasText: "[DEMO] ยาทดสอบชนิด A" });
    await expect(inventoryRow).toContainText("10");
    await expect(inventoryRow).toContainText("ใกล้หมด");

    await loginAndAcknowledge(doctorPage, server.baseURL, "doctor");
    await doctorPage.goto(`${server.baseURL}/inventory`);
    await expect(doctorPage).toHaveURL(/\/inventory$/);
    await expect(doctorPage.locator(".inventory-table tbody tr").filter({ hasText: "[DEMO] ยาทดสอบชนิด A" })).toContainText("10");
    await expect(doctorPage.getByRole("link", { name: /รับยาเข้าคลัง|บันทึกรับยาใหม่/ })).toHaveCount(2);

    const received = await doctorPage.request.post(`${server.baseURL}/api/inventory/receipts`, {
      headers: { "idempotency-key": "inventory-e2e-doctor-receive-001" },
      data: {
        expectedRevisions: { medication: 1 },
        payload: {
          medicationId: "DEMO-MED-001",
          quantity: 10,
          lotNumber: "E2E-DOCTOR-RECEIVE",
          expiryDate,
          supplierName: "ผู้จำหน่าย E2E",
          note: "รับเข้าทดสอบโดยแพทย์",
        },
      },
    });
    expect(received.status()).toBe(201);
    await expect(received.json()).resolves.toMatchObject({ data: { lot: { lotNumber: "E2E-DOCTOR-RECEIVE" } } });
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});
