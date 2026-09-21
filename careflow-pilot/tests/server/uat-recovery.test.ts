import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkoutDtoSchema,
  opdCardSchema,
  type CheckoutDto,
  type FulfillmentPickListDto,
  type PatientDto,
  type VisitClosureDto,
} from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Drive the public workflow: historical preparations and per-lot evidence must
// remain usable through payment, closure, and the printed clinical record.
async function handoff(lotCount: number, abandon: boolean) {
  const test = await createTestApp({ idFactory: randomUUID });
  cleanups.push(test.cleanup);
  const assistant = await seedAccount(test.database, {
    id: "assistant", username: "assistant", role: "assistant", mustChangePassword: false,
  });
  const doctor = await seedAccount(test.database, {
    id: "doctor", username: "doctor", role: "doctor", mustChangePassword: false,
  });
  const cookies = {
    assistant: cookieFrom(await login(test.app, assistant.username, assistant.password)),
    doctor: cookieFrom(await login(test.app, doctor.username, doctor.password)),
  };
  async function request<T>(role: keyof typeof cookies, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
    const result = await test.app.inject({
      method, url,
      headers: { cookie: cookies[role], "idempotency-key": randomUUID() },
      ...(payload === undefined ? {} : { payload }),
    });
    expect([200, 201], `${method} ${url}: ${result.body}`).toContain(result.statusCode);
    return result.json<{ data: T }>().data;
  }
  const patient = await request<PatientDto>("assistant", "POST", "/api/patients/synthetic", {
    expectedRevisions: {}, payload: {},
  });
  const intake = await request<{ visit: { id: string } }>("assistant", "POST", "/api/visits/intake", {
    expectedRevisions: { patient: patient.revision },
    payload: {
      patientId: patient.id, chiefComplaint: "ทดสอบการจัดยาและปิด Visit",
      vitals: { weightKg: 60, heightCm: 165, temperatureC: 37, systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 80, spo2Percent: 98 },
      allergy: { answer: "NO", items: [], changeReason: null },
    },
  });
  const visitId = intake.visit.id;
  await request("doctor", "POST", `/api/visits/${visitId}/start-consultation`, {
    expectedRevisions: { visit: 1 }, payload: {},
  });
  await request("doctor", "POST", `/api/visits/${visitId}/consultation-draft`, {
    expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
    payload: {
      note: { subjective: "อาการทดสอบ", objective: "ผลตรวจทดสอบ", assessment: "ประเมินทดสอบ", plan: "แผนทดสอบ", diagnoses: ["การวินิจฉัยทดสอบ"] },
      medicationDecision: { kind: "ORDER", items: [{ medicationId: "DEMO-MED-001", medicationRevision: 1, quantity: lotCount, directionsTh: "คำแนะนำทดสอบ" }] },
    },
  });
  await request("doctor", "POST", `/api/visits/${visitId}/finalize-consultation`, {
    expectedRevisions: { visit: 2, patient: 2, noteDraft: 1, medicationDraft: 1 }, payload: {},
  });
  for (let index = 0; index < lotCount; index += 1) {
    await request("assistant", "POST", "/api/inventory/receipts", {
      expectedRevisions: { medication: 1 },
      payload: { medicationId: "DEMO-MED-001", lotNumber: `LOT-${index}`, expiryDate: "2027-12-31", supplierName: "ผู้จำหน่ายสังเคราะห์", quantity: 1, note: "" },
    });
  }
  let pick = await request<FulfillmentPickListDto>("assistant", "GET", `/api/dispensing/${visitId}`);
  async function start() {
    pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/reservations`, {
      expectedRevisions: { visit: pick.visit.revision, medicationDecision: pick.medicationDecision!.version },
      payload: { labelVersionId: pick.label!.id },
    });
  }
  await start();
  const firstPreparationId = pick.preparation!.id;
  if (abandon) {
    pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/reservation-release`, {
      expectedRevisions: { visit: pick.visit.revision, preparation: pick.preparation!.revision },
      payload: { preparationId: pick.preparation!.id, reservationId: pick.reservation!.id, reason: "ยกเลิกและจัดเตรียมใหม่" },
    });
    await start();
  }
  pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/labels/${pick.label!.id}/print-events`, {
    expectedRevisions: { visit: pick.visit.revision },
    payload: { rendererVersion: "uat-regression", decisionVersion: pick.medicationDecision!.version },
  });
  for (const allocation of pick.reservation!.allocations) {
    pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/preparation-confirmations`, {
      expectedRevisions: { visit: pick.visit.revision, preparation: pick.preparation!.revision },
      payload: { preparationId: pick.preparation!.id, allocationId: allocation.id, method: "BARCODE", barcode: "CF-DEMO-001" },
    });
  }
  pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/complete-preparation`, {
    expectedRevisions: { visit: pick.visit.revision, preparation: pick.preparation!.revision },
    payload: { preparationId: pick.preparation!.id, reservationId: pick.reservation!.id },
  });
  pick = await request<FulfillmentPickListDto>("doctor", "POST", `/api/dispensing/${visitId}/release`, {
    expectedRevisions: { visit: pick.visit.revision, preparation: pick.preparation!.revision },
    payload: { decisionId: pick.medicationDecision!.id, decisionVersion: pick.medicationDecision!.version, labelVersionId: pick.label!.id, labelPrintEventId: pick.preparation!.latestPrintEventId, preparationId: pick.preparation!.id, reservationId: pick.reservation!.id },
  });
  pick = await request<FulfillmentPickListDto>("assistant", "POST", `/api/dispensing/${visitId}/handoff`, {
    expectedRevisions: { visit: pick.visit.revision },
    payload: { decisionId: pick.medicationDecision!.id, decisionVersion: pick.medicationDecision!.version, labelVersionId: pick.label!.id, releaseId: pick.release!.id, reservationId: pick.reservation!.id },
  });
  expect(pick.dispense!.lines).toHaveLength(lotCount);
  return { ...test, request, visitId, firstPreparationId };
}

async function collectAndClose(test: Awaited<ReturnType<typeof handoff>>, expectedTotal: number, lineCount: number) {
  const { request, visitId } = test;
  const quote = checkoutDtoSchema.parse(await request<CheckoutDto>("doctor", "GET", `/api/checkout/${visitId}`));
  expect(quote.grossTotalBaht).toBe(expectedTotal);
  expect(quote.lines).toHaveLength(lineCount);
  const finalized = checkoutDtoSchema.parse(await request<CheckoutDto>("doctor", "POST", `/api/checkout/${visitId}/charge-finalizations`, {
    expectedRevisions: { visit: quote.visit.revision, clinicPricing: 1 }, payload: { settlementIntent: "COLLECT" },
  }));
  const paid = checkoutDtoSchema.parse(await request<CheckoutDto>("assistant", "POST", `/api/checkout/${visitId}/payments/cash`, {
    expectedRevisions: { visit: finalized.visit.revision }, payload: { chargeId: finalized.charge!.id, amountBaht: expectedTotal },
  }));
  if (paid.resolution?.kind !== "PAYMENT") throw new Error("Expected a payment resolution");
  const closed = await request<VisitClosureDto>("doctor", "POST", `/api/visits/${visitId}/close`, {
    expectedRevisions: { visit: paid.visit.revision },
    payload: { chargeId: paid.charge!.id, resolution: { kind: "PAYMENT", paymentId: paid.resolution.paymentId } },
  });
  expect(closed.visit.status).toBe("CLOSED");
  const opd = opdCardSchema.parse(await request("doctor", "GET", `/api/visits/${visitId}/opd-card`));
  expect(opd.charge.grossTotalBaht).toBe(expectedTotal);
  expect(opd.charge.lines).toHaveLength(lineCount);
  expect(opd.medication.items).toHaveLength(lineCount - 1);
  expect(test.database.sqlite.pragma("foreign_key_check")).toEqual([]);
}

describe("UAT fulfillment recovery through Visit closure", () => {
  it("closes after an abandoned preparation is replaced without erasing historical evidence", async () => {
    const test = await handoff(1, true);
    await collectAndClose(test, 105, 2);
    expect(test.database.sqlite.prepare("SELECT status FROM fulfillment_preparations WHERE id = ?").pluck().get(test.firstPreparationId)).toBe("ACTIVE");
    expect(test.database.sqlite.prepare("SELECT trigger FROM fulfillment_artifact_invalidations WHERE artifact_type = 'PREPARATION' AND artifact_id = ?").pluck().get(test.firstPreparationId)).toBe("ABANDON");
  });

  it("charges, collects, closes, and renders every lot when one medication spans 21 lots", async () => {
    const test = await handoff(21, false);
    await collectAndClose(test, 205, 22);
    expect(test.database.sqlite.prepare("SELECT count(DISTINCT fulfillment_dispense_line_id) FROM finance_charge_lines WHERE line_type = 'MEDICATION'").pluck().get()).toBe(21);
  });
});
