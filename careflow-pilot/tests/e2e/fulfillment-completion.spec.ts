import { expect, test, type Page } from "@playwright/test";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

type Receipt = { lot: { id: string; revision: number }; inventory: { onHand: number } };

async function createQueuedPatient(page: Page, complaint: string): Promise<{ hn: string; visitId: string }> {
  await page.goto(`${new URL(page.url()).origin}/intake`);
  await page.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
  const header = page.locator(".patient-header");
  await expect(header).toBeVisible();
  const hn = (await header.innerText()).match(/HN DEMO-\d{6}/)?.[0];
  expect(hn).toMatch(/^HN DEMO-\d{6}$/);
  await page.getByLabel("อาการสำคัญ *").fill(complaint);
  await page.getByRole("button", { name: "ส่งพบแพทย์" }).click();
  const card = page.locator(".queue-card").filter({ hasText: hn as string });
  await expect(card).toHaveCount(1);
  const visitId = (await card.getAttribute("aria-label"))?.trim().match(/\S+$/)?.[0];
  expect(visitId).toBeTruthy();
  return { hn: hn as string, visitId: visitId as string };
}

async function reviewAllergy(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }).click();
  const dialog = page.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
  await dialog.getByRole("button", { name: "NONE_KNOWN" }).click();
  await dialog.getByRole("button", { name: "บันทึกการทบทวน" }).click();
  await expect(dialog).toHaveCount(0);
}

async function signOrder(page: Page, quantity: number, directions = "รับประทานตามคำสั่งสังเคราะห์"): Promise<void> {
  await page.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill("อาการสังเคราะห์สำหรับเส้นทางจัดยาครบวงจร");
  await page.getByLabel("Objective (ผลตรวจ)").fill("ผลตรวจสังเคราะห์");
  await page.getByLabel("Assessment (การประเมิน)").fill("การประเมินสังเคราะห์");
  await page.getByLabel("Plan (แผนการดูแล)").fill("แผนสังเคราะห์");
  await page.getByRole("textbox", { name: "การวินิจฉัย", exact: true }).fill("การวินิจฉัยสังเคราะห์");
  await page.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }).click();
  await page.getByLabel("ค้นหารายการยา").fill("DEMO-MED-001");
  await page.getByRole("button", { name: /เลือก \[DEMO\] ยาทดสอบชนิด A/ }).click();
  await page.getByLabel("จำนวน").fill(String(quantity));
  await page.getByLabel("วิธีใช้ยา").fill(directions);
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function receiveLot(page: Page, input: { key: string; lotNumber: string; expiryDate: string; quantity: number }): Promise<Receipt> {
  const response = await page.request.post(`${new URL(page.url()).origin}/api/inventory/receipts`, {
    headers: { "idempotency-key": input.key },
    data: {
      expectedRevisions: { medication: 1 },
      payload: {
        medicationId: "DEMO-MED-001", quantity: input.quantity, lotNumber: input.lotNumber,
        expiryDate: input.expiryDate, supplierName: "ผู้จำหน่าย E2E", note: "รับเข้าทดสอบเส้นทางจัดยา",
      },
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data as Receipt;
}

async function queueDoctorIntoConsultation(page: Page, hn: string): Promise<void> {
  await page.goto(`${new URL(page.url()).origin}/queue`);
  const card = page.locator(".queue-card").filter({ hasText: hn });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "เริ่มการตรวจ" }).click();
  await expect(page).toHaveURL(/\/consultations\/[^/]+$/);
}

async function printCurrentLabel(page: Page, baseURL: string, visitId: string): Promise<void> {
  await page.addInitScript(() => { window.print = () => undefined; });
  await page.goto(`${baseURL}/dispensing/${visitId}/labels`);
  await expect(page.getByText("ขนาดสื่อ 80 × 100 มม.")).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const printedBounds = await page.locator(".medicine-label").evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(printedBounds.width).toBeGreaterThanOrEqual(301);
  expect(printedBounds.width).toBeLessThanOrEqual(303);
  expect(printedBounds.height).toBeGreaterThanOrEqual(377);
  expect(printedBounds.height).toBeLessThanOrEqual(379);
  expect(printedBounds.scrollHeight).toBeLessThanOrEqual(printedBounds.clientHeight);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" }).click();
  await expect(page.getByText("บันทึกคำขอพิมพ์แล้ว", { exact: false })).toBeVisible();
}

test("two browsers complete the signed ORDER through FEFO, release, restart, and stock-out", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    const patient = await createQueuedPatient(assistant, "อาการสังเคราะห์สำหรับ E2E ครบวงจร");
    await reviewAllergy(assistant);
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    await queueDoctorIntoConsultation(doctor, patient.hn);
    await signOrder(doctor, 8, "รับประทานหลังอาหารทันทีตามคำแนะนำของแพทย์ ".repeat(12).slice(0, 500));

    const early = await receiveLot(assistant, { key: "completion-early", lotNumber: "COMPLETE-EARLY", expiryDate: "2030-08-10", quantity: 5 });
    const late = await receiveLot(assistant, { key: "completion-late", lotNumber: "COMPLETE-LATE", expiryDate: "2030-08-20", quantity: 10 });

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
    await expect(assistant.getByText("PREPARING", { exact: true })).toBeVisible();
    const reserved = await assistant.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}`);
    await expect(reserved.json()).resolves.toMatchObject({ data: { reservation: { allocations: expect.arrayContaining([
      expect.objectContaining({ lotId: early.lot.id, quantity: 5 }),
      expect.objectContaining({ lotId: late.lot.id, quantity: 3 }),
    ]) } } });

    await printCurrentLabel(assistant, server.baseURL, patient.visitId);
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByLabel("สแกนบาร์โค้ดยา").fill("WRONG-CODE");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").press("Enter");
    await expect(assistant.getByRole("alert")).toContainText("บาร์โค้ดไม่ตรง");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").fill("CF-DEMO-001");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").press("Enter");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").fill("CF-DEMO-001");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").press("Enter");
    await assistant.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
    await expect(assistant.getByText("AWAITING_RELEASE", { exact: true })).toBeVisible();

    await doctor.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(doctor.getByText("AWAITING_RELEASE", { exact: true })).toBeVisible();
    await doctor.getByRole("button", { name: "ปล่อยยา" }).click();
    await expect(doctor.getByText("AWAITING_HANDOFF", { exact: true })).toBeVisible();

    // Restarting the host must keep the signed handoff chain readable.
    await server.restart();
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(assistant.getByText("AWAITING_HANDOFF", { exact: true })).toBeVisible();
    await assistant.getByRole("button", { name: "ยืนยันส่งมอบยา" }).click();
    await expect(assistant.getByText("AWAITING_CHARGE", { exact: true })).toBeVisible();

    const pickList = await assistant.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}`);
    expect(pickList.status()).toBe(200);
    await expect(pickList.json()).resolves.toMatchObject({ data: {
      visit: { status: "AWAITING_CHARGE" },
      dispense: { lines: expect.arrayContaining([
        expect.objectContaining({ lotId: early.lot.id, quantity: 5 }),
        expect.objectContaining({ lotId: late.lot.id, quantity: 3 }),
      ]) },
    } });
    const stock = server.database.sqlite.prepare(`
      SELECT lot_id AS lotId, SUM(quantity_delta) AS onHand
      FROM inventory_stock_movements WHERE lot_id IN (?, ?) GROUP BY lot_id ORDER BY lot_id
    `).all(early.lot.id, late.lot.id);
    expect(stock.sort((left, right) => String(left.lotId).localeCompare(String(right.lotId)))).toEqual([
      { lotId: early.lot.id, onHand: 0 },
      { lotId: late.lot.id, onHand: 7 },
    ].sort((left, right) => left.lotId.localeCompare(right.lotId)));
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("reject/reprint, stale evidence, inventory safeguards, and role denial remain explicit", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    await receiveLot(assistant, { key: "completion-safety", lotNumber: "COMPLETE-SAFETY", expiryDate: "2031-08-10", quantity: 3 });
    const patient = await createQueuedPatient(assistant, "อาการสังเคราะห์สำหรับเส้นทางปฏิเสธ");
    await reviewAllergy(assistant);
    await queueDoctorIntoConsultation(doctor, patient.hn);
    await signOrder(doctor, 1);

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
    const active = (await (await assistant.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}`)).json()).data as { visit: { revision: number }; preparation: { id: string; revision: number }; reservation: { allocations: Array<{ id: string }> } };
    const confirmationsBefore = Number((server.database.sqlite.prepare("SELECT count(*) AS count FROM fulfillment_preparation_confirmations").get() as { count: number }).count);
    const missingReason = await assistant.request.post(`${server.baseURL}/api/dispensing/${patient.visitId}/preparation-confirmations`, { headers: { "idempotency-key": "completion-manual-without-reason" }, data: { expectedRevisions: { visit: active.visit.revision, preparation: active.preparation.revision }, payload: { method: "MANUAL", preparationId: active.preparation.id, allocationId: active.reservation.allocations[0]?.id } } });
    expect(missingReason.status()).toBe(422);
    expect((await missingReason.json()).error.code).toBe("VALIDATION_FAILED");
    expect(Number((server.database.sqlite.prepare("SELECT count(*) AS count FROM fulfillment_preparation_confirmations").get() as { count: number }).count)).toBe(confirmationsBefore);
    await printCurrentLabel(assistant, server.baseURL, patient.visitId);
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByLabel("เหตุผลการยืนยันด้วยตนเอง").fill("เครื่องสแกนทดสอบไม่พร้อม");
    await assistant.getByRole("button", { name: "ยืนยันด้วยตนเอง" }).click();
    await assistant.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
    await doctor.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await doctor.getByLabel("เหตุผลการปฏิเสธ").fill("ฉลากต้องพิมพ์ใหม่เพื่อทบทวน");
    await doctor.getByRole("button", { name: "ปฏิเสธการจัดยา" }).click();
    await expect(doctor.getByText("AWAITING_PREPARATION", { exact: true })).toBeVisible();
    const invalidated = await doctor.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}/labels`);
    await expect(invalidated.json()).resolves.toMatchObject({ data: { medicationDecisionVersion: 1, version: 1 } });

    // Re-preparing must request fresh print evidence; a release attempted with a
    // stale artifact must fail before it can alter the Visit.
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
    await assistant.getByLabel("เหตุผลการยืนยันด้วยตนเอง").fill("ยืนยันรอบที่สองเพื่อทดสอบฉลากใหม่");
    await assistant.getByRole("button", { name: "ยืนยันด้วยตนเอง" }).click();
    await assistant.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
    await expect(assistant.getByRole("alert")).toContainText("คำขอพิมพ์ฉลากรอบใหม่");
    await printCurrentLabel(assistant, server.baseURL, patient.visitId);
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
    await expect(assistant.getByText("AWAITING_RELEASE", { exact: true })).toBeVisible();
    const current = await assistant.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}`);
    const data = (await current.json()).data as { visit: { revision: number }; preparation: { id: string; revision: number }; medicationDecision: { id: string; version: number }; label: { id: string }; reservation: { id: string } };
    const stale = await doctor.request.post(`${server.baseURL}/api/dispensing/${patient.visitId}/release`, {
      headers: { "idempotency-key": "completion-stale-release" },
      data: { expectedRevisions: { visit: data.visit.revision, preparation: data.preparation.revision }, payload: {
        decisionId: data.medicationDecision.id, decisionVersion: data.medicationDecision.version,
        labelVersionId: "stale-label", labelPrintEventId: "stale-print", preparationId: data.preparation.id, reservationId: data.reservation.id,
      } },
    });
    expect(stale.status()).toBe(409);

    const denied = await assistant.request.post(`${server.baseURL}/api/dispensing/${patient.visitId}/release`, {
      headers: { "idempotency-key": "completion-assistant-release-denied" },
      data: { expectedRevisions: { visit: data.visit.revision, preparation: data.preparation.revision }, payload: {
        decisionId: data.medicationDecision.id, decisionVersion: data.medicationDecision.version,
        labelVersionId: data.label.id, labelPrintEventId: "missing-print", preparationId: data.preparation.id, reservationId: data.reservation.id,
      } },
    });
    expect(denied.status()).toBe(403);

    const integrityLot = await receiveLot(assistant, { key: "completion-integrity", lotNumber: "COMPLETE-INTEGRITY", expiryDate: "2032-08-10", quantity: 2 });
    const quarantined = await assistant.request.post(`${server.baseURL}/api/inventory/lots/${integrityLot.lot.id}/quarantine`, {
      headers: { "idempotency-key": "completion-quarantine" }, data: { expectedRevisions: { lot: integrityLot.lot.revision }, payload: { reason: "กักกันสำหรับทดสอบ" } },
    });
    expect(quarantined.status()).toBe(201);
    const quarantineData = (await quarantined.json()).data as { revision: number; recentMovements: Array<{ id: string }> };
    const movementId = quarantineData.recentMovements[0]?.id;
    expect(movementId).toBeTruthy();
    const adjustment = await doctor.request.post(`${server.baseURL}/api/inventory/lots/${integrityLot.lot.id}/adjustments`, {
      headers: { "idempotency-key": "completion-adjustment" }, data: { expectedRevisions: { lot: quarantineData.revision }, payload: { correctsMovementId: movementId, quantityDelta: -1, reason: "แก้ไขยอดทดสอบ" } },
    });
    expect(adjustment.status()).toBe(201);
    const immutableEvidenceBeforeRestart = server.database.sqlite.prepare("SELECT count(*) AS count FROM inventory_lot_status_events WHERE lot_id = ?").get(integrityLot.lot.id) as { count: number };
    const adjustmentEvidenceBeforeRestart = server.database.sqlite.prepare("SELECT count(*) AS count FROM inventory_adjustments WHERE lot_id = ?").get(integrityLot.lot.id) as { count: number };
    expect(immutableEvidenceBeforeRestart.count).toBe(1);
    expect(adjustmentEvidenceBeforeRestart.count).toBe(1);
    await server.restart();
    expect(server.database.sqlite.prepare("SELECT count(*) AS count FROM inventory_lot_status_events WHERE lot_id = ?").get(integrityLot.lot.id)).toEqual(immutableEvidenceBeforeRestart);
    expect(server.database.sqlite.prepare("SELECT count(*) AS count FROM inventory_adjustments WHERE lot_id = ?").get(integrityLot.lot.id)).toEqual(adjustmentEvidenceBeforeRestart);
    expect(server.database.sqlite.prepare("SELECT status FROM inventory_lots WHERE id = ?").get(integrityLot.lot.id)).toEqual({ status: "QUARANTINED" });
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("an active reservation is invalidated by a real allergy revision and blocks stale fulfillment actions", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext(); const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage(); const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    await receiveLot(assistant, { key: "active-invalidation-stock", lotNumber: "ACTIVE-INVALIDATION", expiryDate: "2032-12-31", quantity: 2 });
    const patient = await createQueuedPatient(assistant, "ทดสอบการยกเลิกรายการจองจริง");
    await reviewAllergy(assistant); await queueDoctorIntoConsultation(doctor, patient.hn); await signOrder(doctor, 1);
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`); await assistant.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
    const active = (await (await assistant.request.get(`${server.baseURL}/api/dispensing/${patient.visitId}`)).json()).data as { visit: { revision: number }; patient: { id: string; revision: number }; label: { id: string }; reservation: { id: string }; preparation: { id: string; revision: number } };
    const invalidated = await doctor.request.post(`${server.baseURL}/api/patients/${active.patient.id}/allergy-revisions`, { headers: { "idempotency-key": "active-reservation-allergy" }, data: { expectedRevisions: { patient: active.patient.revision, visit: active.visit.revision }, payload: { visitId: patient.visitId, state: "PRESENT", items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }], sourceText: "ข้อมูล E2E", reason: "พบประวัติแพ้ยาหลังเริ่มจัดยา" } } });
    expect(invalidated.status()).toBe(201);
    expect((await invalidated.json()).data.visit.status).toBe("AWAITING_ORDER_REVISION");
    const writesBefore = Number((server.database.sqlite.prepare("SELECT count(*) AS count FROM fulfillment_label_print_events").get() as { count: number }).count);
    const stalePrint = await assistant.request.post(`${server.baseURL}/api/dispensing/${patient.visitId}/labels/${active.label.id}/print-events`, { headers: { "idempotency-key": "active-reservation-stale-print" }, data: { expectedRevisions: { visit: active.visit.revision + 1 }, payload: { rendererVersion: "e2e", decisionVersion: 1 } } });
    expect(stalePrint.status()).toBe(409); expect((await stalePrint.json()).error.code).toBe("ARTIFACT_STALE");
    expect(Number((server.database.sqlite.prepare("SELECT count(*) AS count FROM fulfillment_label_print_events").get() as { count: number }).count)).toBe(writesBefore);
    expect(server.database.sqlite.prepare("SELECT status FROM inventory_reservations WHERE id = ?").get(active.reservation.id)).toEqual({ status: "RELEASED" });
    expect(Number((server.database.sqlite.prepare("SELECT count(*) AS count FROM fulfillment_artifact_invalidations WHERE visit_id = ?").get(patient.visitId) as { count: number }).count)).toBeGreaterThan(0);
  } finally { await assistantContext.close(); await doctorContext.close(); await server.close(); }
});
