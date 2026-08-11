import { expect, test, type Page } from "@playwright/test";
import type { CheckoutDto, OpdCardDto } from "../../src/shared/contracts.js";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

type QueuedPatient = { hn: string; visitId: string };

async function createQueuedPatient(page: Page, baseURL: string, complaint: string): Promise<QueuedPatient> {
  await page.goto(`${baseURL}/intake`);
  await page.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
  const header = page.locator(".patient-header");
  await expect(header).toBeVisible();
  const hn = (await header.innerText()).match(/HN DEMO-\d{6}/)?.[0];
  expect(hn).toMatch(/^HN DEMO-\d{6}$/);
  await page.getByRole("radio", { name: "ไม่แพ้" }).check();
  await page.getByLabel("อาการสำคัญ *").fill(complaint);
  await page.getByRole("button", { name: "ส่งพบแพทย์" }).click();
  const card = page.locator(".queue-card").filter({ hasText: hn as string });
  await expect(card).toHaveCount(1);
  const visitId = (await card.getAttribute("aria-label"))?.trim().match(/\S+$/)?.[0];
  expect(visitId).toBeTruthy();
  return { hn: hn as string, visitId: visitId as string };
}

async function reviewNoneKnown(page: Page, hn: string): Promise<void> {
  const card = page.locator(".queue-card").filter({ hasText: hn });
  await card.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }).click();
  const dialog = page.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
  await dialog.getByRole("button", { name: "ยืนยันว่าไม่แพ้" }).click();
  await dialog.getByRole("button", { name: "บันทึกการทบทวน" }).click();
  await expect(dialog).toHaveCount(0);
}

async function openConsultation(page: Page, baseURL: string, hn: string): Promise<void> {
  await page.goto(`${baseURL}/queue`);
  const card = page.locator(".queue-card").filter({ hasText: hn });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "เริ่มตรวจ" }).click();
  await expect(page).toHaveURL(/\/consultations\/[^/]+$/);
}

async function fillClinicalNote(page: Page): Promise<void> {
  await page.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill("อาการสังเคราะห์สำหรับการตรวจการเงิน");
  await page.getByLabel("Objective (ผลตรวจ)").fill("ผลตรวจสังเคราะห์");
  await page.getByLabel("Assessment (การประเมิน)").fill("การประเมินสังเคราะห์");
  await page.getByLabel("Plan (แผนการดูแล)").fill("แผนสังเคราะห์");
  await page.getByRole("textbox", { name: "การวินิจฉัย", exact: true }).fill("การวินิจฉัยสังเคราะห์");
}

async function signOrder(page: Page, quantity: number): Promise<void> {
  await fillClinicalNote(page);
  await page.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }).click();
  await page.getByLabel("ค้นหารายการยา").fill("DEMO-MED-001");
  await page.getByRole("button", { name: /เลือก \[DEMO\] ยาทดสอบชนิด A/ }).click();
  await page.getByLabel("จำนวน").fill(String(quantity));
  await page.getByLabel("วิธีใช้ยา").fill("รับประทานตามคำสั่งสังเคราะห์");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function signNoMedication(page: Page, reason: string): Promise<void> {
  await fillClinicalNote(page);
  await page.getByRole("button", { name: "ไม่สั่งยา" }).click();
  await page.getByLabel("เหตุผลที่ไม่สั่งยา").fill(reason);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function receiveLot(page: Page, baseURL: string, input: { key: string; lotNumber: string; expiryDate: string; quantity: number }): Promise<void> {
  const response = await page.request.post(`${baseURL}/api/inventory/receipts`, {
    headers: { "idempotency-key": input.key },
    data: {
      expectedRevisions: { medication: 1 },
      payload: {
        medicationId: "DEMO-MED-001",
        quantity: input.quantity,
        lotNumber: input.lotNumber,
        expiryDate: input.expiryDate,
        supplierName: "ผู้จำหน่าย E2E การเงิน",
        note: "รับเข้าทดสอบเส้นทางการเงิน",
      },
    },
  });
  expect(response.status()).toBe(201);
}

async function handoffOrder(page: Page, doctor: Page, baseURL: string, visitId: string): Promise<void> {
  await page.goto(`${baseURL}/dispensing/${visitId}`);
  await page.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
  await expect(page.getByText("PREPARING", { exact: true })).toBeVisible();
  const pickList = await page.request.get(`${baseURL}/api/dispensing/${visitId}`);
  expect(pickList.status()).toBe(200);
  const allocationCount = ((await pickList.json()) as {
    data: { reservation: { allocations: Array<{ id: string }> } | null };
  }).data.reservation?.allocations.length;
  expect(allocationCount).toBeGreaterThan(0);

  await page.addInitScript(() => { window.print = () => undefined; });
  await page.goto(`${baseURL}/dispensing/${visitId}/labels`);
  await page.getByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" }).click();
  await expect(page.getByText("บันทึกคำขอพิมพ์แล้ว", { exact: false })).toBeVisible();

  await page.goto(`${baseURL}/dispensing/${visitId}`);
  for (let index = 0; index < (allocationCount ?? 0); index += 1) {
    await page.getByLabel("สแกนบาร์โค้ดยา").fill("CF-DEMO-001");
    await page.getByLabel("สแกนบาร์โค้ดยา").press("Enter");
  }
  await page.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
  await expect(page.getByText("AWAITING_RELEASE", { exact: true })).toBeVisible();

  await doctor.goto(`${baseURL}/dispensing/${visitId}`);
  await doctor.getByRole("button", { name: "ปล่อยยา" }).click();
  await expect(doctor.getByText("AWAITING_HANDOFF", { exact: true })).toBeVisible();

  await page.goto(`${baseURL}/dispensing/${visitId}`);
  await page.getByRole("button", { name: "ยืนยันส่งมอบยา" }).click();
  await expect(page.getByText("AWAITING_CHARGE", { exact: true })).toBeVisible();
}

async function readCheckout(page: Page, baseURL: string, visitId: string): Promise<CheckoutDto> {
  const response = await page.request.get(`${baseURL}/api/checkout/${visitId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: CheckoutDto }).data;
}

function requireCharge(data: CheckoutDto): NonNullable<CheckoutDto["charge"]> {
  if (!data.charge) throw new Error("Expected immutable Charge evidence");
  return data.charge;
}

test("two browsers persist an ORDER multi-lot Charge, Assistant Cash, Doctor close, and A4 OPD evidence", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedPatient(assistant, server.baseURL, "อาการสังเคราะห์ E2E เงินสดหลายล็อต");
    await reviewNoneKnown(assistant, patient.hn);
    await openConsultation(doctor, server.baseURL, patient.hn);
    await signOrder(doctor, 8);
    await receiveLot(assistant, server.baseURL, { key: "finance-cash-lot-early", lotNumber: "FIN-CASH-EARLY", expiryDate: "2030-08-10", quantity: 5 });
    await receiveLot(assistant, server.baseURL, { key: "finance-cash-lot-late", lotNumber: "FIN-CASH-LATE", expiryDate: "2030-08-20", quantity: 10 });
    await handoffOrder(assistant, doctor, server.baseURL, patient.visitId);

    await doctor.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" })).toBeVisible();
    await doctor.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" }).click();
    await expect(doctor.getByRole("region", { name: "งานชำระเงินปัจจุบัน" }).locator(".status-pill")).toHaveText("รอรับชำระ");
    const charged = await readCheckout(doctor, server.baseURL, patient.visitId);
    const charge = requireCharge(charged);
    expect(charged).toMatchObject({
      visit: { id: patient.visitId, status: "AWAITING_PAYMENT" },
      sourceKind: "ORDER",
      grossTotalBaht: 140,
      adjustmentTotalBaht: 0,
      netDueBaht: 140,
      collectionState: "AWAITING_COLLECTION",
    });
    expect(charged.lines.map((line) => ({ lineType: line.lineType, quantity: line.quantity, unitPriceBaht: line.unitPriceBaht, lineTotalBaht: line.lineTotalBaht })))
      .toEqual([
        { lineType: "CONSULTATION", quantity: 1, unitPriceBaht: 100, lineTotalBaht: 100 },
        { lineType: "MEDICATION", quantity: 5, unitPriceBaht: 5, lineTotalBaht: 25 },
        { lineType: "MEDICATION", quantity: 3, unitPriceBaht: 5, lineTotalBaht: 15 },
      ]);
    expect(charge.finalizedBy).toMatchObject({ id: "doctor-e2e-001", displayName: "พญ. E2E" });

    await server.restart();
    const afterChargeRestart = await readCheckout(doctor, server.baseURL, patient.visitId);
    expect(afterChargeRestart).toMatchObject({ charge: { id: charge.id }, grossTotalBaht: 140, visit: { status: "AWAITING_PAYMENT" } });
    await assistant.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await assistant.getByRole("button", { name: "ยืนยันรับเงินสด 140 บาท" }).click();
    await expect(assistant.getByRole("region", { name: "งานชำระเงินปัจจุบัน" }).locator(".status-pill")).toHaveText("พร้อมปิด Visit");
    const paid = await readCheckout(assistant, server.baseURL, patient.visitId);
    expect(paid.resolution).toMatchObject({ kind: "PAYMENT", method: "CASH" });
    const paymentId = paid.resolution && paid.resolution.kind === "PAYMENT" ? paid.resolution.paymentId : "";
    expect(paymentId).toMatch(/\S/);

    await server.restart();
    await doctor.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ปิด Visit" })).toBeVisible();
    await doctor.getByRole("button", { name: "ปิด Visit" }).click();
    const journeyOpdLink = doctor.getByRole("region", { name: "งานถัดไป" }).getByRole("link", { name: "เปิดบัตร OPD" });
    await expect(journeyOpdLink).toBeVisible();
    const closed = await readCheckout(doctor, server.baseURL, patient.visitId);
    expect(closed).toMatchObject({ visit: { status: "CLOSED" }, collectionState: "CLOSED", charge: { id: charge.id } });

    await journeyOpdLink.click();
    await expect(doctor).toHaveURL(new RegExp(`/visits/${patient.visitId}/opd-card$`));
    const opd = await doctor.locator(".opd-card");
    await expect(opd).toContainText("PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้รักษาจริง");
    await expect(opd).toContainText(patient.hn.replace(/^HN\s+/, ""));
    await expect(opd).toContainText("เงินสด 140 บาท");
    await expect(opd).toContainText(charge.id);

    const assistantOpd = await assistant.request.get(`${server.baseURL}/api/visits/${patient.visitId}/opd-card`);
    expect(assistantOpd.status()).toBe(403);
    expect(await assistantOpd.text()).not.toMatch(/subjective|assessment|diagnos/i);
    await assistant.goto(`${server.baseURL}/visits/${patient.visitId}/opd-card`);
    await expect(assistant.getByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeVisible();
    await expect(assistant.locator(".opd-card")).toHaveCount(0);

    await doctor.setViewportSize({ width: Math.floor((186 / 25.4) * 96), height: 1123 });
    await doctor.emulateMedia({ media: "print" });
    const printed = await opd.evaluate((element) => {
      const chrome = Array.from(document.querySelectorAll<HTMLElement>(".desktop-sidebar, .mobile-topbar, .workspace-topbar, .page-header"));
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        chromeVisible: chrome.some((node) => getComputedStyle(node).display !== "none"),
      };
    });
    expect(printed.width).toBeGreaterThanOrEqual(700);
    expect(printed.width).toBeLessThanOrEqual(706);
    expect(printed.height).toBeGreaterThanOrEqual(1_000);
    expect(printed.chromeVisible).toBe(false);
    await doctor.emulateMedia({ media: "screen" });

    await doctor.goto(`${server.baseURL}/queue`);
    await expect(doctor.locator(".queue-card").filter({ hasText: patient.hn })).toHaveCount(0);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_charges WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM fulfillment_dispense_price_snapshots WHERE fulfillment_dispense_line_id IN (SELECT id FROM fulfillment_dispense_lines WHERE dispense_id IN (SELECT id FROM fulfillment_dispenses WHERE visit_id = ?))").pluck().get(patient.visitId)).toBe(2);
    expect(server.database.sqlite.prepare(`
      SELECT action, actor_role AS actorRole
      FROM audit_events
      WHERE action IN ('charge.finalized', 'payment.cash-recorded', 'visit.closed')
        AND (entity_id = ? OR entity_id = ?)
      ORDER BY action
    `).all(charge.id, paymentId)).toEqual([
      { action: "charge.finalized", actorRole: "doctor" },
      { action: "payment.cash-recorded", actorRole: "assistant" },
    ]);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action = 'visit.closed' AND actor_role = 'doctor'").pluck().get()).toBe(1);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("two browsers close an ORDER with Doctor PromptPay and a NO_MEDICATION Visit with an atomic full waiver", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");

    const promptPayPatient = await createQueuedPatient(assistant, server.baseURL, "อาการสังเคราะห์ E2E PromptPay");
    await reviewNoneKnown(assistant, promptPayPatient.hn);
    await openConsultation(doctor, server.baseURL, promptPayPatient.hn);
    await signOrder(doctor, 2);
    await receiveLot(assistant, server.baseURL, { key: "finance-promptpay-lot", lotNumber: "FIN-PP-LOT", expiryDate: "2031-08-10", quantity: 2 });
    await handoffOrder(assistant, doctor, server.baseURL, promptPayPatient.visitId);

    await doctor.goto(`${server.baseURL}/checkout/${promptPayPatient.visitId}`);
    await doctor.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" }).click();
    const promptPayCharged = await readCheckout(doctor, server.baseURL, promptPayPatient.visitId);
    expect(promptPayCharged).toMatchObject({ grossTotalBaht: 110, netDueBaht: 110, visit: { status: "AWAITING_PAYMENT" } });
    const promptPayCharge = requireCharge(promptPayCharged);
    await doctor.getByLabel("เลขอ้างอิง PromptPay").fill("PROMPTPAY-E2E-110");
    await doctor.getByRole("button", { name: "ยืนยัน PromptPay" }).click();
    await expect(doctor.getByRole("region", { name: "งานชำระเงินปัจจุบัน" }).locator(".status-pill")).toHaveText("พร้อมปิด Visit");
    const promptPayPaid = await readCheckout(doctor, server.baseURL, promptPayPatient.visitId);
    expect(promptPayPaid.resolution).toMatchObject({ kind: "PAYMENT", method: "PROMPTPAY" });
    await doctor.getByRole("button", { name: "ปิด Visit" }).click();
    const promptPayClosed = await readCheckout(doctor, server.baseURL, promptPayPatient.visitId);
    expect(promptPayClosed).toMatchObject({ visit: { status: "CLOSED" }, charge: { id: promptPayCharge.id }, collectionState: "CLOSED" });
    expect(server.database.sqlite.prepare("SELECT method, amount_baht, manual_reference FROM finance_payments WHERE charge_id = ?").get(promptPayCharge.id))
      .toEqual({ method: "PROMPTPAY", amount_baht: 110, manual_reference: "PROMPTPAY-E2E-110" });

    const noMedicationPatient = await createQueuedPatient(assistant, server.baseURL, "อาการสังเคราะห์ E2E ยกเว้นเต็มจำนวน");
    await reviewNoneKnown(assistant, noMedicationPatient.hn);
    await openConsultation(doctor, server.baseURL, noMedicationPatient.hn);
    await signNoMedication(doctor, "ดูแลตามอาการในข้อมูลสังเคราะห์");
    await doctor.goto(`${server.baseURL}/checkout/${noMedicationPatient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ยกเว้นเต็มจำนวน" })).toBeVisible();
    await doctor.getByRole("button", { name: "ยกเว้นเต็มจำนวน" }).click();
    const waiverDialog = doctor.getByRole("dialog", { name: "ยกเว้นเต็มจำนวน" });
    await waiverDialog.getByLabel("เหตุผลการยกเว้น").fill("ช่วยเหลือผู้ป่วยสังเคราะห์ครบจำนวน");
    await waiverDialog.getByRole("button", { name: "ยืนยันยกเว้นเต็มจำนวน" }).click();
    await expect(waiverDialog).toHaveCount(0);
    await expect(doctor.getByRole("region", { name: "งานชำระเงินปัจจุบัน" }).locator(".status-pill")).toHaveText("พร้อมปิด Visit");
    const waived = await readCheckout(doctor, server.baseURL, noMedicationPatient.visitId);
    const waiverCharge = requireCharge(waived);
    expect(waived).toMatchObject({
      sourceKind: "NO_MEDICATION",
      lines: [{ lineType: "CONSULTATION", quantity: 1, unitPriceBaht: 100, lineTotalBaht: 100 }],
      grossTotalBaht: 100,
      adjustmentTotalBaht: -100,
      netDueBaht: 0,
      collectionState: "COLLECTION_NOT_REQUIRED",
      resolution: { kind: "COLLECTION_NOT_REQUIRED" },
      visit: { status: "READY_TO_CLOSE" },
    });
    const adjustmentId = waived.resolution && waived.resolution.kind === "COLLECTION_NOT_REQUIRED" ? waived.resolution.adjustmentId : "";
    expect(adjustmentId).toMatch(/\S/);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE charge_id = ?").pluck().get(waiverCharge.id)).toBe(0);
    expect(server.database.sqlite.prepare("SELECT kind, amount_baht, reason FROM finance_charge_adjustments WHERE id = ?").get(adjustmentId))
      .toEqual({ kind: "FULL_WAIVER", amount_baht: -100, reason: "ช่วยเหลือผู้ป่วยสังเคราะห์ครบจำนวน" });
    expect(server.database.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action = 'charge.finalized' AND entity_id = ? AND actor_role = 'doctor'").pluck().get(waiverCharge.id)).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action = 'charge.waiver-approved' AND entity_id = ? AND actor_role = 'doctor'").pluck().get(adjustmentId)).toBe(1);

    await doctor.getByRole("button", { name: "ปิด Visit" }).click();
    const waivedClosed = await readCheckout(doctor, server.baseURL, noMedicationPatient.visitId);
    expect(waivedClosed).toMatchObject({ visit: { status: "CLOSED" }, collectionState: "CLOSED", charge: { id: waiverCharge.id } });
    const opdResponse = await doctor.request.get(`${server.baseURL}/api/visits/${noMedicationPatient.visitId}/opd-card`);
    expect(opdResponse.status()).toBe(200);
    const opd = ((await opdResponse.json()) as { data: OpdCardDto }).data;
    expect(opd).toMatchObject({
      medication: { kind: "NO_MEDICATION", noMedicationReason: "ดูแลตามอาการในข้อมูลสังเคราะห์", items: [] },
      charge: { id: waiverCharge.id, grossTotalBaht: 100, adjustmentTotalBaht: -100, netDueBaht: 0, resolution: { kind: "COLLECTION_NOT_REQUIRED", waiverAdjustmentId: adjustmentId } },
    });
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("two browsers reject unauthorized or stale finance commands and allow only one retry, collection race, and close", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedPatient(assistant, server.baseURL, "อาการสังเคราะห์ E2E ความปลอดภัยการเงิน");
    await reviewNoneKnown(assistant, patient.hn);
    await openConsultation(doctor, server.baseURL, patient.hn);
    await signNoMedication(doctor, "ไม่มีข้อบ่งใช้ยาในการทดสอบความปลอดภัย");

    const beforeFinalize = await readCheckout(doctor, server.baseURL, patient.visitId);
    expect(beforeFinalize).toMatchObject({ visit: { status: "AWAITING_CHARGE" }, sourceKind: "NO_MEDICATION", netDueBaht: 100 });
    const finalizeBody = {
      expectedRevisions: { visit: beforeFinalize.visit.revision, clinicPricing: beforeFinalize.clinicPricingRevision },
      payload: { settlementIntent: "COLLECT" as const },
    };
    const assistantFinalize = await assistant.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/charge-finalizations`, {
      headers: { "idempotency-key": "finance-safety-assistant-finalize" },
      data: finalizeBody,
    });
    expect(assistantFinalize.status()).toBe(403);

    const [firstFinalize, secondFinalize] = await Promise.all([
      doctor.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/charge-finalizations`, {
        headers: { "idempotency-key": "finance-safety-double-finalize" }, data: finalizeBody,
      }),
      doctor.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/charge-finalizations`, {
        headers: { "idempotency-key": "finance-safety-double-finalize" }, data: finalizeBody,
      }),
    ]);
    expect([firstFinalize.status(), secondFinalize.status()].sort()).toEqual([200, 201]);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_charges WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM audit_events WHERE action = 'charge.finalized'").pluck().get()).toBe(1);

    const charged = await readCheckout(doctor, server.baseURL, patient.visitId);
    const charge = requireCharge(charged);
    const assistantPromptPay = await assistant.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/payments/promptpay`, {
      headers: { "idempotency-key": "finance-safety-assistant-promptpay" },
      data: {
        expectedRevisions: { visit: charged.visit.revision },
        payload: { chargeId: charge.id, amountBaht: charged.netDueBaht, manualReference: "DENIED-PROMPTPAY" },
      },
    });
    const assistantWaiver = await assistant.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/waivers`, {
      headers: { "idempotency-key": "finance-safety-assistant-waiver" },
      data: {
        expectedRevisions: { visit: charged.visit.revision },
        payload: { chargeId: charge.id, reason: "การทดสอบต้องถูกปฏิเสธ" },
      },
    });
    const assistantClose = await assistant.request.post(`${server.baseURL}/api/visits/${patient.visitId}/close`, {
      headers: { "idempotency-key": "finance-safety-assistant-close" },
      data: {
        expectedRevisions: { visit: charged.visit.revision },
        payload: { chargeId: charge.id, resolution: { kind: "PAYMENT", paymentId: "forged-payment" } },
      },
    });
    const assistantOpd = await assistant.request.get(`${server.baseURL}/api/visits/${patient.visitId}/opd-card`);
    for (const denied of [assistantPromptPay, assistantWaiver, assistantClose, assistantOpd]) {
      expect(denied.status()).toBe(403);
      expect(await denied.text()).not.toMatch(/subjective|objective|assessment|plan|diagnos/i);
    }

    const staleCash = await assistant.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/payments/cash`, {
      headers: { "idempotency-key": "finance-safety-stale-cash" },
      data: {
        expectedRevisions: { visit: charged.visit.revision - 1 },
        payload: { chargeId: charge.id, amountBaht: charged.netDueBaht },
      },
    });
    expect(staleCash.status()).toBe(409);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(0);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM finance_charge_adjustments WHERE charge_id = ?").pluck().get(charge.id)).toBe(0);

    const [cash, promptPay, waiver] = await Promise.all([
      assistant.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/payments/cash`, {
        headers: { "idempotency-key": "finance-safety-race-cash" },
        data: { expectedRevisions: { visit: charged.visit.revision }, payload: { chargeId: charge.id, amountBaht: charged.netDueBaht } },
      }),
      doctor.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/payments/promptpay`, {
        headers: { "idempotency-key": "finance-safety-race-promptpay" },
        data: {
          expectedRevisions: { visit: charged.visit.revision },
          payload: { chargeId: charge.id, amountBaht: charged.netDueBaht, manualReference: "RACE-PROMPTPAY" },
        },
      }),
      doctor.request.post(`${server.baseURL}/api/checkout/${patient.visitId}/waivers`, {
        headers: { "idempotency-key": "finance-safety-race-waiver" },
        data: {
          expectedRevisions: { visit: charged.visit.revision },
          payload: { chargeId: charge.id, reason: "แข่งขันการชำระเงินสังเคราะห์" },
        },
      }),
    ]);
    expect([cash.status(), promptPay.status(), waiver.status()].sort()).toEqual([201, 409, 409]);
    const terminalEvidenceCount = Number(server.database.sqlite.prepare("SELECT count(*) FROM finance_payments WHERE visit_id = ?").pluck().get(patient.visitId))
      + Number(server.database.sqlite.prepare("SELECT count(*) FROM finance_charge_adjustments WHERE charge_id = ?").pluck().get(charge.id));
    expect(terminalEvidenceCount).toBe(1);

    const readyToClose = await readCheckout(doctor, server.baseURL, patient.visitId);
    expect(readyToClose).toMatchObject({ visit: { status: "READY_TO_CLOSE" } });
    if (!readyToClose.resolution) throw new Error("Collection race must leave terminal resolution evidence");
    const closeResolution = readyToClose.resolution.kind === "PAYMENT"
      ? { kind: "PAYMENT" as const, paymentId: readyToClose.resolution.paymentId }
      : { kind: "COLLECTION_NOT_REQUIRED" as const, waiverAdjustmentId: readyToClose.resolution.adjustmentId };
    const closeBody = {
      expectedRevisions: { visit: readyToClose.visit.revision },
      payload: {
        chargeId: charge.id,
        resolution: closeResolution,
      },
    };
    const [firstClose, secondClose] = await Promise.all([
      doctor.request.post(`${server.baseURL}/api/visits/${patient.visitId}/close`, {
        headers: { "idempotency-key": "finance-safety-double-close" }, data: closeBody,
      }),
      doctor.request.post(`${server.baseURL}/api/visits/${patient.visitId}/close`, {
        headers: { "idempotency-key": "finance-safety-double-close" }, data: closeBody,
      }),
    ]);
    expect([firstClose.status(), secondClose.status()].sort()).toEqual([200, 201]);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});
