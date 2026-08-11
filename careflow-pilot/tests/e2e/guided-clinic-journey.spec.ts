import { expect, test, type Page } from "@playwright/test";
import type { CheckoutDto, VisitJourneyDto } from "../../src/shared/contracts.js";
import { E2E_PASSWORD, loginAndAcknowledge, startPilotServer } from "./fixtures.js";

type PilotServer = Awaited<ReturnType<typeof startPilotServer>>;

type ControlledPilotServer = PilotServer & {
  expireSessionsForStaff(staffId: string): void;
};

type QueuedPatient = { hn: string; visitId: string };
type DemoMedication = { id: string; optionName: RegExp; selectionName: RegExp };

const demoMedicationA: DemoMedication = {
  id: "DEMO-MED-001",
  optionName: /\[DEMO\] ยาทดสอบชนิด A/,
  selectionName: /เลือก \[DEMO\] ยาทดสอบชนิด A/,
};

const demoMedicationB: DemoMedication = {
  id: "DEMO-MED-002",
  optionName: /\[DEMO\] ยาทดสอบชนิด B/,
  selectionName: /เลือก \[DEMO\] ยาทดสอบชนิด B/,
};

async function createQueuedNoAllergyPatient(page: Page, baseURL: string, complaint: string): Promise<QueuedPatient> {
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

async function signBackIn(page: Page, username: string): Promise<void> {
  await page.getByLabel("ชื่อผู้ใช้").fill(username);
  await page.getByLabel("รหัสผ่าน").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

async function openConsultation(page: Page, baseURL: string, patient: QueuedPatient): Promise<void> {
  await page.goto(`${baseURL}/queue`);
  const card = page.locator(".queue-card").filter({ hasText: patient.hn });
  await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "เริ่มตรวจ" }).click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${patient.visitId}$`));
}

async function completeClinicalNote(page: Page, suffix: string): Promise<void> {
  await page.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill(`SOAP ลับจากห้องตรวจ ${suffix}`);
  await page.getByLabel("Objective (ผลตรวจ)").fill(`ผลตรวจสังเคราะห์ ${suffix}`);
  await page.getByLabel("Assessment (การประเมิน)").fill(`การประเมินสังเคราะห์ ${suffix}`);
  await page.getByLabel("Plan (แผนการดูแล)").fill(`แผนสังเคราะห์ ${suffix}`);
  await page.getByRole("textbox", { name: "การวินิจฉัย", exact: true }).fill(`การวินิจฉัยสังเคราะห์ ${suffix}`);
}

async function signOrder(
  page: Page,
  quantity: number,
  suffix: string,
  medication: DemoMedication = demoMedicationA,
): Promise<void> {
  await completeClinicalNote(page, suffix);
  await page.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }).click();
  await page.getByLabel("ค้นหารายการยา").fill(medication.id);
  await page.getByRole("button", { name: medication.selectionName }).click();
  await page.getByLabel("จำนวน").fill(String(quantity));
  await page.getByLabel("วิธีใช้ยา").fill("รับประทานตามคำสั่งสังเคราะห์");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await expect(page.getByRole("button", { name: "ลงนามและส่งต่อ" })).toBeEnabled();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function signNoMedication(page: Page, suffix: string): Promise<void> {
  await completeClinicalNote(page, suffix);
  await page.getByRole("button", { name: "ไม่สั่งยา" }).click();
  await page.getByLabel("เหตุผลที่ไม่สั่งยา").fill("ดูแลตามอาการในข้อมูลสังเคราะห์");
  await page.getByRole("button", { name: "บันทึกร่าง" }).click();
  await page.getByRole("button", { name: "ลงนามและส่งต่อ" }).click();
  const dialog = page.getByRole("dialog", { name: "ยืนยันการลงนาม" });
  await dialog.getByRole("button", { name: "ยืนยันการลงนาม" }).click();
  await expect(page.getByRole("region", { name: "หลักฐานการตัดสินใจยา ที่ลงนาม" })).toBeVisible();
}

async function readJourney(page: Page, baseURL: string, visitId: string): Promise<VisitJourneyDto> {
  const response = await page.request.get(`${baseURL}/api/visits/${visitId}/journey`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: VisitJourneyDto }).data;
}

async function readCheckout(page: Page, baseURL: string, visitId: string): Promise<CheckoutDto> {
  const response = await page.request.get(`${baseURL}/api/checkout/${visitId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: CheckoutDto }).data;
}

function journeyWithoutClock(journey: VisitJourneyDto): Omit<VisitJourneyDto, "refreshedAt"> {
  const durable: Partial<VisitJourneyDto> = { ...journey };
  delete durable.refreshedAt;
  return durable as Omit<VisitJourneyDto, "refreshedAt">;
}

async function createQueuedPresentAllergyPatient(page: Page, baseURL: string, complaint: string): Promise<QueuedPatient> {
  await page.goto(`${baseURL}/intake`);
  await page.getByRole("button", { name: "สร้างผู้ป่วยสังเคราะห์" }).click();
  const header = page.locator(".patient-header");
  await expect(header).toBeVisible();
  const hn = (await header.innerText()).match(/HN DEMO-\d{6}/)?.[0];
  expect(hn).toMatch(/^HN DEMO-\d{6}$/);
  await page.getByRole("radio", { name: "แพ้", exact: true }).check();
  const first = page.locator(".intake-allergy-item").nth(0);
  await first.getByLabel("สารที่แพ้ *").fill("เพนิซิลลิน");
  await first.getByLabel("อาการแพ้ *").fill("ผื่น");
  await page.getByRole("button", { name: "เพิ่มรายการแพ้" }).click();
  const second = page.locator(".intake-allergy-item").nth(1);
  await second.getByLabel("สารที่แพ้ *").fill("ไอบูโพรเฟน");
  await second.getByLabel("อาการแพ้ *").fill("หายใจลำบาก");
  await page.getByLabel("อาการสำคัญ *").fill(complaint);
  await page.getByRole("button", { name: "ส่งพบแพทย์" }).click();
  const card = page.locator(".queue-card").filter({ hasText: hn as string });
  await expect(card).toHaveCount(1);
  const visitId = (await card.getAttribute("aria-label"))?.trim().match(/\S+$/)?.[0];
  expect(visitId).toBeTruthy();
  return { hn: hn as string, visitId: visitId as string };
}

async function receiveSyntheticLot(
  page: Page,
  baseURL: string,
  input: { lotNumber: string; quantity: number; medication?: DemoMedication },
): Promise<void> {
  const medication = input.medication ?? demoMedicationA;
  await page.goto(`${baseURL}/inventory/receive`);
  await page.getByLabel("ค้นหายา").fill(medication.id);
  const medicationOption = page.getByRole("option", { name: medication.optionName });
  await expect(medicationOption).toBeVisible();
  await medicationOption.click();
  await page.getByLabel("จำนวนที่รับ").fill(String(input.quantity));
  await page.getByLabel("ผู้ผลิต / ผู้จัดจำหน่าย").fill("ผู้จำหน่ายสังเคราะห์ Guided UAT");
  await page.getByLabel("เลขที่ล็อต").fill(input.lotNumber);
  await page.getByLabel("วันหมดอายุ").fill("2033-12-31");
  await page.getByRole("button", { name: "ยืนยันการรับยา" }).click();
}

function medicationReadiness(server: PilotServer, medicationId: string): { onHand: number; reserved: number; available: number } {
  const onHand = Number(server.database.sqlite.prepare(`
    SELECT COALESCE(SUM(movement.quantity_delta), 0)
    FROM inventory_stock_movements movement
    INNER JOIN inventory_lots lot ON lot.id = movement.lot_id
    WHERE lot.medication_id = ?
  `).pluck().get(medicationId));
  const reserved = Number(server.database.sqlite.prepare(`
    SELECT COALESCE(SUM(allocation.quantity), 0)
    FROM inventory_reservation_allocations allocation
    INNER JOIN inventory_reservations reservation ON reservation.id = allocation.reservation_id
    INNER JOIN inventory_lots lot ON lot.id = allocation.lot_id
    WHERE lot.medication_id = ?
      AND reservation.status = 'ACTIVE'
  `).pluck().get(medicationId));
  return { onHand, reserved, available: onHand - reserved };
}

test("returns safely after mid-Visit session expiry while retaining only committed Intake evidence", async ({ browser }) => {
  const server = await startPilotServer() as ControlledPilotServer;
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedNoAllergyPatient(assistant, server.baseURL, "ทดสอบหมดอายุระหว่าง Visit");

    await doctor.goto(`${server.baseURL}/queue`);
    const doctorCard = doctor.locator(".queue-card").filter({ hasText: patient.hn });
    await doctorCard.getByRole("button", { name: "เริ่มตรวจ" }).click();
    await expect(doctor).toHaveURL(new RegExp(`/consultations/${patient.visitId}$`));
    await doctor.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)").fill("ร่างที่ยังไม่ได้บันทึกหลังหมดอายุเซสชัน");

    const evidenceBeforeExpiry = {
      allergy: server.database.sqlite.prepare("SELECT count(*) FROM patient_allergy_revisions").pluck().get(),
      visits: server.database.sqlite.prepare("SELECT count(*) FROM visits WHERE id = ?").pluck().get(patient.visitId),
      notes: server.database.sqlite.prepare("SELECT count(*) FROM clinical_notes WHERE visit_id = ?").pluck().get(patient.visitId),
    };
    expect(typeof server.expireSessionsForStaff).toBe("function");
    server.expireSessionsForStaff("doctor-e2e-001");

    const expiredSessionResponse = doctor.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/session" && response.status() === 401,
    );
    await doctor.reload();
    await expect((await expiredSessionResponse).json()).resolves.toMatchObject({
      error: { code: "SESSION_EXPIRED" },
    });
    await expect(doctor).toHaveURL(new RegExp(`/login\\?returnTo=%2Fconsultations%2F${patient.visitId}&reason=session-expired$`));
    const sessionReturnNotice = doctor.getByText("เซสชันหมดอายุ งานยังไม่ได้ถูกบันทึก", { exact: true });
    await Promise.all([
      sessionReturnNotice.waitFor({ state: "visible" }),
      signBackIn(doctor, "doctor"),
    ]);
    await expect(doctor).toHaveURL(new RegExp(`/consultations/${patient.visitId}$`));
    await expect(doctor.getByLabel("Subjective (ข้อมูลจากผู้ป่วย)")).toHaveValue("");
    expect(await doctor.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
    expect({
      allergy: server.database.sqlite.prepare("SELECT count(*) FROM patient_allergy_revisions").pluck().get(),
      visits: server.database.sqlite.prepare("SELECT count(*) FROM visits WHERE id = ?").pluck().get(patient.visitId),
      notes: server.database.sqlite.prepare("SELECT count(*) FROM clinical_notes WHERE visit_id = ?").pluck().get(patient.visitId),
    }).toEqual(evidenceBeforeExpiry);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("guides two roles through ORDER stock recovery, fulfillment, cash, Closure, and restart evidence", async ({ browser }) => {
  test.setTimeout(90_000);
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedNoAllergyPatient(assistant, server.baseURL, "ทดสอบ Journey ORDER และสต็อก");

    const assistantWaitingCard = assistant.locator(".queue-card").filter({ hasText: patient.hn });
    await expect(
      assistantWaitingCard.getByRole("heading", { name: "รอแพทย์ตรวจและสั่งการรักษา" }),
    ).toBeVisible();
    await expect(assistantWaitingCard.getByRole("button", { name: "เริ่มตรวจ" })).toHaveCount(0);
    await openConsultation(doctor, server.baseURL, patient);
    await signOrder(doctor, 3, "ORDER-RECOVERY");

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    const stockBlocker = assistant.locator(".journey-blocker-card");
    await expect(stockBlocker).toContainText("ต้องการ 3 เม็ด");
    await expect(stockBlocker).toContainText("พร้อมใช้ 0 เม็ด");
    await expect(stockBlocker).toContainText("ขาด 3 เม็ด");
    await expect(stockBlocker.getByRole("link", { name: "รับยาเข้าคลัง" })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "เริ่มเตรียมยา" })).toHaveCount(0);

    await doctor.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(doctor.getByRole("heading", { name: "รับยาเข้าคลัง" })).toBeVisible();
    await expect(doctor.locator(".journey-blocker-card").getByText("บทบาทหลัก: ผู้ช่วย", { exact: true })).toBeVisible();
    await expect(doctor.getByRole("link", { name: "รับยาเข้าคลัง" })).toBeVisible();
    await expect(doctor.getByRole("button", { name: "เริ่มเตรียมยา" })).toHaveCount(0);

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByRole("link", { name: "รับยาเข้าคลัง" }).click();
    await expect(assistant).toHaveURL(new RegExp(`/inventory/receive\\?[^#]*returnTo=%2Fdispensing%2F${patient.visitId}`));
    await expect(assistant.getByLabel("ค้นหายา")).toHaveValue("[DEMO] ยาทดสอบชนิด A");
    await assistant.getByLabel("จำนวนที่รับ").fill("10");
    await assistant.getByLabel("ผู้ผลิต / ผู้จัดจำหน่าย").fill("ผู้จำหน่ายสังเคราะห์ UAT");
    await assistant.getByLabel("เลขที่ล็อต").fill("GUIDED-ORDER-LOT");
    await assistant.getByLabel("วันหมดอายุ").fill("2032-12-31");
    await assistant.getByRole("button", { name: "ยืนยันการรับยา" }).click();
    await expect(assistant).toHaveURL(new RegExp(`/dispensing/${patient.visitId}$`));

    await expect(assistant.getByRole("button", { name: "เริ่มเตรียมยา" })).toBeVisible();
    await assistant.getByRole("button", { name: "เริ่มเตรียมยา" }).click();
    await expect(assistant.getByText("PREPARING", { exact: true })).toBeVisible();
    await assistant.addInitScript(() => { window.print = () => undefined; });
    await assistant.getByRole("link", { name: "เปิดฉลากยา" }).click();
    await expect(assistant).toHaveURL(new RegExp(`/dispensing/${patient.visitId}/labels$`));
    await assistant.getByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" }).click();
    await expect(assistant.getByText("บันทึกคำขอพิมพ์แล้ว", { exact: false })).toBeVisible();

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await assistant.getByLabel("สแกนบาร์โค้ดยา").fill("CF-DEMO-001");
    await assistant.getByLabel("สแกนบาร์โค้ดยา").press("Enter");
    await assistant.getByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }).click();
    await expect(assistant.getByText("AWAITING_RELEASE", { exact: true })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "ปล่อยยา" })).toHaveCount(0);

    await doctor.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ปล่อยยา" })).toBeVisible();
    await doctor.getByRole("button", { name: "ปล่อยยา" }).click();
    await expect(doctor.getByText("AWAITING_HANDOFF", { exact: true })).toBeVisible();
    await expect(doctor.getByRole("button", { name: "ยืนยันส่งมอบยา" })).toBeVisible();
    await expect(doctor.getByLabel("งานถัดไป").getByText("บทบาทหลัก: ผู้ช่วย", { exact: true })).toBeVisible();

    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(assistant.getByRole("button", { name: "ยืนยันส่งมอบยา" })).toBeVisible();
    await assistant.getByRole("button", { name: "ยืนยันส่งมอบยา" }).click();
    await expect(assistant.getByText("AWAITING_CHARGE", { exact: true })).toBeVisible();
    expect(server.database.sqlite.prepare("SELECT count(*) FROM fulfillment_dispenses WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
    expect(server.database.sqlite.prepare(`
      SELECT COALESCE(SUM(quantity_delta), 0) AS onHand
      FROM inventory_stock_movements
      WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'GUIDED-ORDER-LOT')
    `).get()).toEqual({ onHand: 7 });
    expect(server.database.sqlite.prepare(`
      SELECT COALESCE(SUM(allocation.quantity), 0) AS reserved
      FROM inventory_reservation_allocations allocation
      INNER JOIN inventory_reservations reservation ON reservation.id = allocation.reservation_id
      WHERE allocation.lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'GUIDED-ORDER-LOT')
        AND reservation.status = 'ACTIVE'
    `).get()).toEqual({ reserved: 0 });

    await assistant.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(assistant.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" })).toHaveCount(0);
    await doctor.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" })).toBeVisible();
    await doctor.getByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" }).click();
    expect(await readCheckout(doctor, server.baseURL, patient.visitId)).toMatchObject({
      grossTotalBaht: 115,
      netDueBaht: 115,
      visit: { status: "AWAITING_PAYMENT" },
    });
    await expect(doctor.getByRole("button", { name: "ยืนยันรับเงินสด 115 บาท" })).toBeVisible();
    await expect(doctor.getByLabel("งานถัดไป").getByText("บทบาทหลัก: ผู้ช่วย", { exact: true })).toBeVisible();

    await assistant.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(assistant.getByRole("button", { name: "ยืนยันรับเงินสด 115 บาท" })).toBeVisible();
    await assistant.getByRole("button", { name: "ยืนยันรับเงินสด 115 บาท" }).click();
    await expect(assistant.getByText("รับชำระแล้ว รอแพทย์ปิด Visit", { exact: true })).toBeVisible();
    await expect(assistant.getByRole("button", { name: "ปิด Visit" })).toHaveCount(0);

    await doctor.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ปิด Visit" })).toBeVisible();
    await doctor.getByRole("button", { name: "ปิด Visit" }).click();
    const doctorOpenOpd = doctor.getByLabel("งานถัดไป").getByRole("link", { name: "เปิดบัตร OPD" });
    await expect(doctorOpenOpd).toBeVisible();
    await doctorOpenOpd.click();
    await expect(doctor).toHaveURL(new RegExp(`/visits/${patient.visitId}/opd-card$`));
    await expect(doctor.locator(".opd-card")).toBeVisible();

    const deniedWorkspace = await assistant.request.get(`${server.baseURL}/api/visits/${patient.visitId}/workspace`);
    const deniedOpd = await assistant.request.get(`${server.baseURL}/api/visits/${patient.visitId}/opd-card`);
    expect(deniedWorkspace.status()).toBe(403);
    expect(deniedOpd.status()).toBe(403);
    expect(await deniedWorkspace.text()).not.toContain("SOAP ลับจากห้องตรวจ");
    expect(await deniedOpd.text()).not.toContain("SOAP ลับจากห้องตรวจ");

    const auditCountBeforeJourneyRead = server.database.sqlite.prepare("SELECT count(*) FROM audit_events").pluck().get();
    const assistantJourney = await readJourney(assistant, server.baseURL, patient.visitId);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM audit_events").pluck().get()).toBe(auditCountBeforeJourneyRead);
    const journeyJson = JSON.stringify(assistantJourney);
    expect(journeyJson).not.toContain("SOAP ลับจากห้องตรวจ");
    expect(journeyJson).not.toMatch(/contentHash|subjective|objective|assessment|diagnos/i);

    const patientId = server.database.sqlite.prepare("SELECT patient_id FROM visits WHERE id = ?").pluck().get(patient.visitId) as string;
    const allergyAssessmentBeforeRestart = await assistant.request.get(`${server.baseURL}/api/patients/${patientId}/allergy-assessment`);
    expect(allergyAssessmentBeforeRestart.status()).toBe(200);
    const durableBeforeRestart = {
      journey: journeyWithoutClock(await readJourney(doctor, server.baseURL, patient.visitId)),
      allergy: (await allergyAssessmentBeforeRestart.json()).data,
      checkout: await readCheckout(doctor, server.baseURL, patient.visitId),
      stock: server.database.sqlite.prepare(`
        SELECT COALESCE(SUM(quantity_delta), 0) AS onHand
        FROM inventory_stock_movements
        WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'GUIDED-ORDER-LOT')
      `).get(),
      closure: server.database.sqlite.prepare(`
        SELECT charge_id AS chargeId, payment_id AS paymentId, waiver_adjustment_id AS waiverAdjustmentId, content_hash AS contentHash
        FROM visit_closures WHERE visit_id = ?
      `).get(patient.visitId),
      opd: (await (await doctor.request.get(`${server.baseURL}/api/visits/${patient.visitId}/opd-card`)).json()).data,
    };

    await server.restart();
    const allergyAssessmentAfterRestart = await assistant.request.get(`${server.baseURL}/api/patients/${patientId}/allergy-assessment`);
    expect(allergyAssessmentAfterRestart.status()).toBe(200);
    const durableAfterRestart = {
      journey: journeyWithoutClock(await readJourney(doctor, server.baseURL, patient.visitId)),
      allergy: (await allergyAssessmentAfterRestart.json()).data,
      checkout: await readCheckout(doctor, server.baseURL, patient.visitId),
      stock: server.database.sqlite.prepare(`
        SELECT COALESCE(SUM(quantity_delta), 0) AS onHand
        FROM inventory_stock_movements
        WHERE lot_id = (SELECT id FROM inventory_lots WHERE lot_number = 'GUIDED-ORDER-LOT')
      `).get(),
      closure: server.database.sqlite.prepare(`
        SELECT charge_id AS chargeId, payment_id AS paymentId, waiver_adjustment_id AS waiverAdjustmentId, content_hash AS contentHash
        FROM visit_closures WHERE visit_id = ?
      `).get(patient.visitId),
      opd: (await (await doctor.request.get(`${server.baseURL}/api/visits/${patient.visitId}/opd-card`)).json()).data,
    };
    expect(durableAfterRestart).toEqual(durableBeforeRestart);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("preserves two Intake Allergy items and Thai summaries through restart", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedPresentAllergyPatient(assistant, server.baseURL, "ทดสอบแพ้ยาสองรายการ");

    const queueCard = assistant.locator(".queue-card").filter({ hasText: patient.hn });
    await expect(queueCard).toContainText("ประวัติแพ้ยา: มีประวัติแพ้ยา");
    await openConsultation(doctor, server.baseURL, patient);
    const snapshot = doctor.getByRole("region", { name: "Patient Snapshot" });
    await expect(snapshot).toContainText("มีประวัติแพ้ยา");
    await expect(snapshot).toContainText("เพนิซิลลิน · ผื่น");
    await expect(snapshot).toContainText("ไอบูโพรเฟน · หายใจลำบาก");

    const patientId = server.database.sqlite.prepare("SELECT patient_id FROM visits WHERE id = ?").pluck().get(patient.visitId) as string;
    const before = await assistant.request.get(`${server.baseURL}/api/patients/${patientId}/allergy-assessment`);
    expect(before.status()).toBe(200);
    const beforeData = (await before.json()).data;
    expect(beforeData).toMatchObject({
      allergy: {
        state: "PRESENT",
        items: [
          { substance: "เพนิซิลลิน", reaction: "ผื่น" },
          { substance: "ไอบูโพรเฟน", reaction: "หายใจลำบาก" },
        ],
      },
    });

    await server.restart();
    await doctor.goto(`${server.baseURL}/consultations/${patient.visitId}`);
    await expect(snapshot).toContainText("มีประวัติแพ้ยา");
    await expect(snapshot).toContainText("เพนิซิลลิน · ผื่น");
    await expect(snapshot).toContainText("ไอบูโพรเฟน · หายใจลำบาก");
    const after = await assistant.request.get(`${server.baseURL}/api/patients/${patientId}/allergy-assessment`);
    expect(after.status()).toBe(200);
    expect((await after.json()).data).toEqual(beforeData);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("skips dispensing for NO_MEDICATION, completes Doctor full waiver, and closes without stock evidence", async ({ browser }) => {
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    const patient = await createQueuedNoAllergyPatient(assistant, server.baseURL, "ทดสอบไม่สั่งยาและยกเว้นเต็มจำนวน");
    await openConsultation(doctor, server.baseURL, patient);
    await signNoMedication(doctor, "ดูแลตามอาการในข้อมูลสังเคราะห์ Guided UAT");

    const beforeWaiver = await readJourney(doctor, server.baseURL, patient.visitId);
    expect(beforeWaiver.steps.find((step) => step.code === "PREPARATION")?.state).toBe("SKIPPED");
    expect(beforeWaiver.steps.find((step) => step.code === "HANDOFF")?.state).toBe("SKIPPED");
    expect(beforeWaiver.nextTask).toMatchObject({ action: "FINALIZE_CHARGE", primaryRole: "doctor" });
    await assistant.goto(`${server.baseURL}/dispensing/${patient.visitId}`);
    await expect(assistant.getByRole("button", { name: "เริ่มเตรียมยา" })).toHaveCount(0);
    await expect(assistant.getByRole("link", { name: "เปิดฉลากยา" })).toHaveCount(0);

    await assistant.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(assistant.getByRole("button", { name: "ยกเว้นเต็มจำนวน" })).toHaveCount(0);
    await doctor.goto(`${server.baseURL}/checkout/${patient.visitId}`);
    await expect(doctor.getByRole("button", { name: "ยกเว้นเต็มจำนวน" })).toBeVisible();
    await doctor.getByRole("button", { name: "ยกเว้นเต็มจำนวน" }).click();
    const waiverDialog = doctor.getByRole("dialog", { name: "ยกเว้นเต็มจำนวน" });
    await waiverDialog.getByLabel("เหตุผลการยกเว้น").fill("ช่วยเหลือผู้ป่วยสังเคราะห์ Guided UAT");
    await waiverDialog.getByRole("button", { name: "ยืนยันยกเว้นเต็มจำนวน" }).click();
    await expect(waiverDialog).toHaveCount(0);

    const waived = await readCheckout(doctor, server.baseURL, patient.visitId);
    expect(waived).toMatchObject({
      sourceKind: "NO_MEDICATION",
      grossTotalBaht: 100,
      adjustmentTotalBaht: -100,
      netDueBaht: 0,
      collectionState: "COLLECTION_NOT_REQUIRED",
      resolution: { kind: "COLLECTION_NOT_REQUIRED" },
      visit: { status: "READY_TO_CLOSE" },
    });
    const afterWaiver = await readJourney(doctor, server.baseURL, patient.visitId);
    expect(afterWaiver.steps.find((step) => step.code === "PAYMENT")?.state).toBe("SKIPPED");
    await expect(doctor.getByRole("button", { name: "ปิด Visit" })).toBeVisible();
    await doctor.getByRole("button", { name: "ปิด Visit" }).click();
    expect(server.database.sqlite.prepare("SELECT count(*) FROM inventory_reservations WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(0);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM fulfillment_dispenses WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(0);
    expect(server.database.sqlite.prepare("SELECT count(*) FROM visit_closures WHERE visit_id = ?").pluck().get(patient.visitId)).toBe(1);
  } finally {
    await assistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});

test("proves exactly one B-unit readiness before two visible final-lot reservation attempts without retrying", async ({ browser }) => {
  test.setTimeout(90_000);
  const server = await startPilotServer();
  const assistantContext = await browser.newContext();
  const secondAssistantContext = await browser.newContext();
  const doctorContext = await browser.newContext();
  const assistant = await assistantContext.newPage();
  const secondAssistant = await secondAssistantContext.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await loginAndAcknowledge(assistant, server.baseURL, "assistant");
    await loginAndAcknowledge(secondAssistant, server.baseURL, "assistant");
    await loginAndAcknowledge(doctor, server.baseURL, "doctor");
    expect(medicationReadiness(server, demoMedicationB.id)).toEqual({ onHand: 0, reserved: 0, available: 0 });
    const first = await createQueuedNoAllergyPatient(assistant, server.baseURL, "ทดสอบแข่งจองล็อตสุดท้าย รายที่หนึ่ง");
    const second = await createQueuedNoAllergyPatient(assistant, server.baseURL, "ทดสอบแข่งจองล็อตสุดท้าย รายที่สอง");
    await openConsultation(doctor, server.baseURL, first);
    await signOrder(doctor, 1, "FINAL-LOT-ONE", demoMedicationB);
    await openConsultation(doctor, server.baseURL, second);
    await signOrder(doctor, 1, "FINAL-LOT-TWO", demoMedicationB);
    await receiveSyntheticLot(assistant, server.baseURL, {
      lotNumber: "GUIDED-FINAL-LOT-B",
      quantity: 1,
      medication: demoMedicationB,
    });
    expect(medicationReadiness(server, demoMedicationB.id)).toEqual({ onHand: 1, reserved: 0, available: 1 });

    await assistant.goto(`${server.baseURL}/dispensing/${first.visitId}`);
    await secondAssistant.goto(`${server.baseURL}/dispensing/${second.visitId}`);
    const firstStart = assistant.getByRole("button", { name: "เริ่มเตรียมยา" });
    const secondStart = secondAssistant.getByRole("button", { name: "เริ่มเตรียมยา" });
    await expect(firstStart).toBeVisible();
    await expect(secondStart).toBeVisible();
    let firstReservationPosts = 0;
    let secondReservationPosts = 0;
    assistant.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith(`/api/dispensing/${first.visitId}/reservations`)) firstReservationPosts += 1;
    });
    secondAssistant.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith(`/api/dispensing/${second.visitId}/reservations`)) secondReservationPosts += 1;
    });
    await Promise.all([firstStart.click(), secondStart.click()]);

    await expect.poll(() => Number(server.database.sqlite.prepare("SELECT count(*) FROM inventory_reservations WHERE visit_id IN (?, ?) AND status = 'ACTIVE'").pluck().get(first.visitId, second.visitId))).toBe(1);
    const activeVisitId = server.database.sqlite.prepare("SELECT visit_id FROM inventory_reservations WHERE visit_id IN (?, ?) AND status = 'ACTIVE'").pluck().get(first.visitId, second.visitId) as string;
    const losing = activeVisitId === first.visitId
      ? { page: secondAssistant, visit: second, posts: () => secondReservationPosts }
      : { page: assistant, visit: first, posts: () => firstReservationPosts };
    await expect(losing.page.locator(".journey-blocker-card")).toContainText("ขาด 1 แคปซูล");
    await expect(losing.page.getByRole("button", { name: "เริ่มเตรียมยา" })).toHaveCount(0);
    expect(firstReservationPosts).toBe(1);
    expect(secondReservationPosts).toBe(1);
    expect(losing.posts()).toBe(1);
    const stock = medicationReadiness(server, demoMedicationB.id);
    expect(stock).toEqual({ onHand: 1, reserved: 1, available: 0 });
    expect(stock.available).toBeGreaterThanOrEqual(0);
  } finally {
    await assistantContext.close();
    await secondAssistantContext.close();
    await doctorContext.close();
    await server.close();
  }
});
