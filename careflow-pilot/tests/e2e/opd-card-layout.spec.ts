import { expect, test, type Page } from "@playwright/test";
import { opdCardSchema, type OpdCardDto, type VisitJourneyDto } from "../../src/shared/contracts.js";
import { loginAndAcknowledge, startPilotServer } from "./fixtures.js";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "a".repeat(64);

function maximumText(character: string, length: number): string {
  return character.repeat(length);
}

function maximumOpdCard(): OpdCardDto {
  const card = {
    syntheticOnly: true,
    closure: {
      id: maximumText("c", 120),
      visitId: "layout-max",
      visitRevision: 9,
      chargeId: maximumText("h", 120),
      resolution: { kind: "PAYMENT", paymentId: maximumText("p", 120) },
      clinic: { id: maximumText("k", 120), name: maximumText("ค", 120) },
      patient: {
        id: maximumText("u", 120),
        hn: "DEMO-999999",
        displayName: maximumText("ผ", 200),
        birthDate: "1990-01-01",
        sex: "unknown",
      },
      doctor: { id: maximumText("d", 120), displayName: maximumText("แ", 200) },
      closedAt: NOW,
      contentHash: HASH,
      visit: {
        id: "layout-max",
        status: "CLOSED",
        revision: 10,
        arrivedAt: NOW,
        startedAt: NOW,
        closedAt: NOW,
      },
    },
    visit: {
      id: "layout-max",
      chiefComplaint: maximumText("อ", 500),
      arrivedAt: NOW,
      startedAt: NOW,
      closedAt: NOW,
      vitals: {
        weightKg: 350,
        heightCm: 250,
        temperatureC: 45,
        systolicMmhg: 260,
        diastolicMmhg: 180,
        heartRateBpm: 250,
        spo2Percent: 100,
      },
    },
    clinicalNote: {
      id: maximumText("n", 120),
      visitId: "layout-max",
      version: 1,
      subjective: maximumText("ส", 4000),
      objective: maximumText("ต", 4000),
      assessment: maximumText("ว", 4000),
      plan: maximumText("ผ", 4000),
      diagnoses: Array.from({ length: 20 }, (_, index) => `${index}`.padStart(2, "0") + maximumText("ก", 298)),
      sourceDraftRevision: 1,
      revisionReason: maximumText("ร", 500),
      supersedesId: maximumText("s", 120),
      signedBy: { id: maximumText("d", 120), displayName: maximumText("แ", 200) },
      signedAt: NOW,
      contentHash: "b".repeat(64),
    },
    amendments: Array.from({ length: 3 }, (_, index) => ({
      id: `amendment-${index}`,
      clinicalNoteId: maximumText("n", 120),
      version: index + 1,
      content: maximumText(String.fromCharCode(0x0e01 + index), 4000),
      reason: maximumText("ห", 500),
      signedBy: { id: maximumText("d", 120), displayName: maximumText("แ", 200) },
      signedAt: NOW,
      contentHash: `${index + 2}`.repeat(64),
    })),
    medication: {
      kind: "ORDER",
      decision: { id: maximumText("m", 120), version: 1, signedAt: NOW, contentHash: "f".repeat(64) },
      dispense: { id: maximumText("x", 120), handedOffAt: NOW },
      items: Array.from({ length: 20 }, (_, index) => ({
        dispenseLineId: `dispense-line-${index}`,
        orderItemId: `order-item-${index}`,
        displayName: maximumText("ย", 200),
        strengthText: maximumText("ข", 100),
        dosageFormText: maximumText("ม", 100),
        quantity: 999_999,
        unit: maximumText("ห", 100),
        directionsTh: maximumText("ร", 500),
        lotNumber: maximumText(`${index % 10}`, 100),
        expiryDate: "2030-12-31",
      })),
    },
    charge: {
      id: maximumText("h", 120),
      sourceKind: "ORDER",
      currency: "THB",
      lines: Array.from({ length: 21 }, (_, position) => ({
        id: `charge-line-${position}`,
        position,
        lineType: position === 0 ? "CONSULTATION" : "MEDICATION",
        descriptionSnapshot: maximumText("ค", 200),
        quantity: 1,
        unitPriceBaht: position === 0 ? 100 : 1,
        lineTotalBaht: position === 0 ? 100 : 1,
        medicationOrderItemId: position === 0 ? null : `order-item-${position - 1}`,
        fulfillmentDispenseLineId: position === 0 ? null : `dispense-line-${position - 1}`,
      })),
      grossTotalBaht: 120,
      adjustmentTotalBaht: 0,
      netDueBaht: 120,
      resolution: {
        kind: "PAYMENT",
        paymentId: maximumText("p", 120),
        method: "PROMPTPAY",
        amountBaht: 120,
        manualReference: maximumText("q", 100),
        confirmedBy: { id: maximumText("a", 120), displayName: maximumText("ผ", 200) },
        confirmedAt: NOW,
        contentHash: "d".repeat(64),
      },
      contentHash: "e".repeat(64),
    },
  } as const;

  return opdCardSchema.parse(card);
}

function closedJourney(): VisitJourneyDto {
  return {
    visit: { id: "layout-max", status: "CLOSED", revision: 10 },
    refreshedAt: NOW,
    steps: [
      { code: "INTAKE", labelTh: "รับผู้ป่วย", state: "COMPLETE" },
      { code: "SCREENING", labelTh: "คัดกรอง", state: "COMPLETE" },
      { code: "CONSULTATION", labelTh: "ตรวจรักษา", state: "COMPLETE" },
      { code: "MEDICATION_DECISION", labelTh: "ตัดสินใจเรื่องยา", state: "COMPLETE" },
      { code: "PREPARATION", labelTh: "เตรียมยา", state: "COMPLETE" },
      { code: "HANDOFF", labelTh: "ส่งมอบยา", state: "COMPLETE" },
      { code: "PAYMENT", labelTh: "ชำระเงิน", state: "COMPLETE" },
      { code: "CLOSURE", labelTh: "ปิด Visit", state: "COMPLETE" },
    ],
    nextTask: { action: "OPEN_OPD_CARD", labelTh: "เปิดบัตร OPD", primaryRole: "doctor", permittedRoles: ["doctor"], availability: "AVAILABLE" },
    blockers: [],
    allowedActions: ["OPEN_OPD_CARD"],
  };
}

async function openMaximumOpdCard(page: Page, baseURL: string): Promise<void> {
  const card = maximumOpdCard();
  await loginAndAcknowledge(page, baseURL, "doctor");
  await page.route("**/api/visits/layout-max/opd-card", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: card }) });
  });
  await page.route("**/api/visits/layout-max/journey", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: closedJourney() }) });
  });
  await page.goto(`${baseURL}/visits/layout-max/opd-card`);
  await expect(page.getByLabel("บัตร OPD สำหรับพิมพ์")).toBeVisible();
}

async function expectClosedJourneyRibbon(page: Page, mobile: boolean): Promise<void> {
  const ribbon = page.getByRole("navigation", { name: "เส้นทางผู้ป่วย" });
  const current = ribbon.locator("li[aria-current='step']");
  await expect(ribbon.locator("li")).toHaveCount(8);
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(/ปิด Visit/);
  await expect(current).toHaveClass(/is-complete/);
  if (mobile) {
    await expect(current).toBeVisible();
    expect(await current.evaluate((element) => getComputedStyle(element).position)).not.toBe("absolute");
  }
}

async function expectRequiredEvidenceVisible(page: Page): Promise<void> {
  const card = page.getByLabel("บัตร OPD สำหรับพิมพ์");
  await expect(card.getByText("PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้รักษาจริง")).toBeVisible();
  await expect(card.getByRole("heading", { name: "บันทึกการตรวจแบบ SOAP" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "ภาคผนวกการแก้ไข" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "การรักษาและยา" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "สรุปค่าใช้จ่าย" })).toBeVisible();
  await expect(card.getByLabel("แฮช Closure")).toBeVisible();
}

async function opdHorizontalOverflows(page: Page): Promise<string[]> {
  return page.getByLabel("บัตร OPD สำหรับพิมพ์").evaluate((card) => {
    const cardBounds = card.getBoundingClientRect();
    return [card, ...card.querySelectorAll<HTMLElement>("*")].flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      const clipsItsContent = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
      const escapesCard = bounds.left < cardBounds.left - 1 || bounds.right > cardBounds.right + 1;
      if (!clipsItsContent && !escapesCard) return [];
      return [`${element.tagName.toLowerCase()}.${element.className}: ${element.scrollWidth}/${element.clientWidth}`];
    });
  });
}

for (const viewport of [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const) {
  test(`maximum OPD evidence has no horizontal overflow at ${viewport.width}px`, async ({ browser }) => {
    const server = await startPilotServer();
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    try {
      await openMaximumOpdCard(page, server.baseURL);
      await expectClosedJourneyRibbon(page, viewport.width === 375);
      await expectRequiredEvidenceVisible(page);
      expect(await opdHorizontalOverflows(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    } finally {
      await context.close();
      await server.close();
    }
  });
}

test("maximum SOAP and addenda paginate without print overflow", async ({ browser }) => {
  const server = await startPilotServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await openMaximumOpdCard(page, server.baseURL);
    // A4 is 210mm wide with the declared 12mm page margins: 186mm at 96 CSS px/in.
    await page.setViewportSize({ width: Math.floor((186 / 25.4) * 96), height: 1123 });
    await page.emulateMedia({ media: "print" });
    await expectRequiredEvidenceVisible(page);

    const pagination = await page.evaluate(() => {
      const soap = document.querySelector<HTMLElement>(".opd-soap");
      const soapSection = soap?.closest<HTMLElement>(".opd-section");
      const addenda = document.querySelector<HTMLElement>(".opd-addenda");
      const firstAddendum = addenda?.querySelector<HTMLElement>("article");
      return {
        soapSectionBreakInside: soapSection ? getComputedStyle(soapSection).breakInside : "missing",
        firstSoapBreakInside: soap?.firstElementChild ? getComputedStyle(soap.firstElementChild).breakInside : "missing",
        addendaBreakInside: addenda ? getComputedStyle(addenda).breakInside : "missing",
        firstAddendumBreakInside: firstAddendum ? getComputedStyle(firstAddendum).breakInside : "missing",
        soapHeight: soap?.getBoundingClientRect().height ?? 0,
        addendaHeight: addenda?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(pagination.soapHeight).toBeGreaterThan(1_000);
    expect(pagination.addendaHeight).toBeGreaterThan(1_000);
    expect(pagination.soapSectionBreakInside).toBe("auto");
    expect(pagination.firstSoapBreakInside).toBe("auto");
    expect(pagination.addendaBreakInside).toBe("auto");
    expect(pagination.firstAddendumBreakInside).toBe("auto");
    expect(await opdHorizontalOverflows(page)).toEqual([]);

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(10_000);
  } finally {
    await context.close();
    await server.close();
  }
});
