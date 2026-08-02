import { describe, expect, it } from "vitest";
import { careFlowReducer } from "@/lib/careflow/reducer";
import { createSeedState } from "@/lib/careflow/seed";

describe("careFlowReducer", () => {
  it("adds a valid intake to the waiting queue", () => {
    const state = createSeedState();
    const next = careFlowReducer(state, {
      type: "SUBMIT_INTAKE",
      payload: {
        patient: {
          id: "patient-new",
          hn: "HN-66021",
          name: "มาลี ทองดี",
          age: 52,
          gender: "หญิง",
          phone: "081-555-2121",
          allergies: [],
        },
        visit: {
          id: "visit-new",
          arrivedAt: "2026-08-02T09:15:00.000Z",
          vitals: {
            weight: 54,
            height: 158,
            temperature: 36.8,
            systolic: 128,
            diastolic: 82,
            heartRate: 76,
            spo2: 98,
          },
          chiefComplaint: "เวียนศีรษะเล็กน้อย",
        },
      },
    });

    expect(next.patients.at(-1)?.name).toBe("มาลี ทองดี");
    expect(next.visits.at(-1)).toMatchObject({
      id: "visit-new",
      patientId: "patient-new",
      status: "waiting",
      chiefComplaint: "เวียนศีรษะเล็กน้อย",
    });
  });

  it("moves a waiting visit into consultation", () => {
    const state = createSeedState();
    const next = careFlowReducer(state, {
      type: "START_CONSULTATION",
      payload: { visitId: "demo-visit", startedAt: "2026-08-02T09:30:00.000Z" },
    });

    expect(next.visits.find((visit) => visit.id === "demo-visit")).toMatchObject({
      status: "consulting",
      startedAt: "2026-08-02T09:30:00.000Z",
    });
  });

  it("requires a diagnosis before signing a consultation", () => {
    const state = careFlowReducer(createSeedState(), {
      type: "START_CONSULTATION",
      payload: { visitId: "demo-visit", startedAt: "2026-08-02T09:30:00.000Z" },
    });
    const next = careFlowReducer(state, {
      type: "SIGN_VISIT",
      payload: {
        visitId: "demo-visit",
        signedAt: "2026-08-02T09:45:00.000Z",
        clinical: {
          subjective: "ไอแห้งมา 4 วัน",
          objective: "ปอดใส ไม่มีเสียงผิดปกติ",
          assessment: "",
          plan: "พักผ่อนและดื่มน้ำมากขึ้น",
          diagnosis: null,
        },
      },
    });

    expect(next.visits.find((visit) => visit.id === "demo-visit")?.status).toBe("consulting");
    expect(next.toasts.at(-1)?.tone).toBe("error");
  });

  it("signs a valid visit and makes it ready for dispensing", () => {
    const state = careFlowReducer(createSeedState(), {
      type: "START_CONSULTATION",
      payload: { visitId: "demo-visit", startedAt: "2026-08-02T09:30:00.000Z" },
    });
    const next = careFlowReducer(state, {
      type: "SIGN_VISIT",
      payload: {
        visitId: "demo-visit",
        signedAt: "2026-08-02T09:45:00.000Z",
        clinical: {
          subjective: "ไอแห้งมา 4 วัน",
          objective: "ปอดใส ไม่มีเสียงผิดปกติ",
          assessment: "ติดเชื้อทางเดินหายใจส่วนบน",
          plan: "พักผ่อน ดื่มน้ำ และรับประทานยาตามคำสั่ง",
          diagnosis: {
            code: "J06.9",
            labelTh: "การติดเชื้อทางเดินหายใจส่วนบนเฉียบพลัน",
            labelEn: "Acute upper respiratory infection",
          },
        },
      },
    });

    expect(next.visits.find((visit) => visit.id === "demo-visit")).toMatchObject({
      status: "awaiting-dispensing",
      signedAt: "2026-08-02T09:45:00.000Z",
    });
  });

  it("takes a newly intaken patient through a prescribed medication, dispensing, and payment", () => {
    let state = careFlowReducer(createSeedState(), {
      type: "SUBMIT_INTAKE",
      payload: {
        patient: { id: "patient-new-flow", hn: "HN-66022", name: "ใหม่ ใจดี", age: 40, gender: "หญิง", phone: "081-000-0000", allergies: [] },
        visit: {
          id: "visit-new-flow",
          arrivedAt: "2026-08-02T09:15:00.000Z",
          vitals: { weight: 55, height: 160, temperature: 37, systolic: 120, diastolic: 80, heartRate: 76, spo2: 98 },
          chiefComplaint: "ปวดศีรษะ",
        },
      },
    });
    state = careFlowReducer(state, { type: "START_CONSULTATION", payload: { visitId: "visit-new-flow", startedAt: "2026-08-02T09:20:00.000Z" } });
    state = careFlowReducer(state, {
      type: "ADD_PRESCRIPTION",
      payload: { visitId: "visit-new-flow", inventoryId: "med-paracetamol", quantity: 10 },
    });
    state = careFlowReducer(state, {
      type: "SIGN_VISIT",
      payload: {
        visitId: "visit-new-flow", signedAt: "2026-08-02T09:25:00.000Z",
        clinical: { subjective: "ปวดศีรษะ", objective: "ไม่มีไข้", assessment: "ปวดศีรษะทั่วไป", plan: "พักผ่อนและรับประทานยา", diagnosis: { code: "R51", labelTh: "ปวดศีรษะ", labelEn: "Headache" } },
      },
    });
    const prescribed = state.visits.find((visit) => visit.id === "visit-new-flow");
    const stockBefore = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;
    expect(prescribed?.medications).toHaveLength(1);
    expect(prescribed?.status).toBe("awaiting-dispensing");

    state = careFlowReducer(state, { type: "TOGGLE_MEDICATION_PREPARED", payload: { visitId: "visit-new-flow", medicationId: prescribed!.medications[0].id } });
    state = careFlowReducer(state, { type: "CONFIRM_DISPENSING", payload: { visitId: "visit-new-flow", dispensedAt: "2026-08-02T09:30:00.000Z" } });
    const stockAfterDispensing = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;
    state = careFlowReducer(state, { type: "CONFIRM_DISPENSING", payload: { visitId: "visit-new-flow", dispensedAt: "2026-08-02T09:31:00.000Z" } });
    state = careFlowReducer(state, { type: "COMPLETE_PAYMENT", payload: { visitId: "visit-new-flow", method: "cash", paidAt: "2026-08-02T09:35:00.000Z" } });

    expect(stockAfterDispensing).toBe(stockBefore! - 10);
    expect(state.inventory.find((item) => item.id === "med-paracetamol")?.stock).toBe(stockAfterDispensing);
    expect(state.visits.find((visit) => visit.id === "visit-new-flow")?.status).toBe("complete");
  });

  it("blocks dispensing until every medication is prepared", () => {
    let state = createSeedState({ demoVisitStatus: "awaiting-dispensing" });
    state = careFlowReducer(state, {
      type: "TOGGLE_MEDICATION_PREPARED",
      payload: { visitId: "demo-visit", medicationId: "rx-paracetamol" },
    });
    const next = careFlowReducer(state, {
      type: "CONFIRM_DISPENSING",
      payload: { visitId: "demo-visit", dispensedAt: "2026-08-02T10:00:00.000Z" },
    });

    expect(next.visits.find((visit) => visit.id === "demo-visit")?.status).toBe(
      "awaiting-dispensing",
    );
    expect(next.toasts.at(-1)?.message).toContain("ตรวจยาครบทุกรายการ");
  });

  it("deducts stock exactly once when dispensing is confirmed", () => {
    let state = createSeedState({ demoVisitStatus: "awaiting-dispensing", allPrepared: true });
    const before = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;

    state = careFlowReducer(state, {
      type: "CONFIRM_DISPENSING",
      payload: { visitId: "demo-visit", dispensedAt: "2026-08-02T10:00:00.000Z" },
    });
    const afterFirst = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;
    const usageAfterFirst = state.inventory.find((item) => item.id === "med-paracetamol")?.dispensedThisMonth;
    state = careFlowReducer(state, {
      type: "CONFIRM_DISPENSING",
      payload: { visitId: "demo-visit", dispensedAt: "2026-08-02T10:01:00.000Z" },
    });
    const afterSecond = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;

    expect(before).toBe(42);
    expect(afterFirst).toBe(22);
    expect(afterSecond).toBe(22);
    expect(usageAfterFirst).toBe(1870);
    expect(state.inventory.find((item) => item.id === "med-paracetamol")?.dispensedThisMonth).toBe(1870);
    expect(state.visits.find((visit) => visit.id === "demo-visit")?.status).toBe(
      "awaiting-payment",
    );
  });

  it("keeps the second prepared visit untouched when competing stock is no longer sufficient", () => {
    const state = createSeedState({ demoVisitStatus: "awaiting-dispensing", allPrepared: true });
    const first = state.visits.find((visit) => visit.id === "demo-visit")!;
    const firstMedication = { ...first.medications[0], id: "rx-first-paracetamol", quantity: 30, quantityLabel: "30 เม็ด" };
    const secondMedication = { ...firstMedication, id: "rx-second-paracetamol" };
    state.visits = [
      { ...first, medications: [firstMedication] },
      { ...first, id: "visit-competing", medications: [secondMedication], inventoryDeducted: false },
    ];

    const afterFirst = careFlowReducer(state, { type: "CONFIRM_DISPENSING", payload: { visitId: "demo-visit", dispensedAt: "2026-08-02T10:00:00.000Z" } });
    const afterSecond = careFlowReducer(afterFirst, { type: "CONFIRM_DISPENSING", payload: { visitId: "visit-competing", dispensedAt: "2026-08-02T10:01:00.000Z" } });
    const paracetamol = afterSecond.inventory.find((item) => item.id === "med-paracetamol");

    expect(afterSecond.visits.find((visit) => visit.id === "demo-visit")?.status).toBe("awaiting-payment");
    expect(afterSecond.visits.find((visit) => visit.id === "visit-competing")?.status).toBe("awaiting-dispensing");
    expect(paracetamol).toMatchObject({ stock: 12, dispensedThisMonth: 1880 });
    expect(afterSecond.toasts.at(-1)?.message).toContain("ไม่เพียงพอ");
  });

  it("completes payment and records a transaction", () => {
    const state = createSeedState({ demoVisitStatus: "awaiting-payment" });
    const next = careFlowReducer(state, {
      type: "COMPLETE_PAYMENT",
      payload: {
        visitId: "demo-visit",
        method: "promptpay",
        paidAt: "2026-08-02T10:10:00.000Z",
      },
    });

    expect(next.visits.find((visit) => visit.id === "demo-visit")?.status).toBe("complete");
    expect(next.transactions.at(-1)).toMatchObject({
      visitId: "demo-visit",
      method: "promptpay",
      total: 350,
    });
  });

  it("adds received stock and its batch", () => {
    const state = createSeedState();
    const next = careFlowReducer(state, {
      type: "RECEIVE_STOCK",
      payload: {
        inventoryId: "med-amoxicillin",
        quantity: 20,
        unit: "กล่อง",
        supplier: "บริษัท ไทยเมด จำกัด",
        batchNumber: "LOT-2026-A",
        expiry: "2028-12-31",
        receivedAt: "2026-08-02T10:20:00.000Z",
      },
    });

    expect(next.inventory.find((item) => item.id === "med-amoxicillin")?.stock).toBe(470);
    expect(next.batches.at(-1)).toMatchObject({ batchNumber: "LOT-2026-A", quantity: 20 });
    expect(next.inventory.find((item) => item.id === "med-amoxicillin")?.earliestExpiry).toBe("2028-10-31");
  });

  it("rejects non-integer stock, missing supplier, and expired batches without changing stock", () => {
    const state = createSeedState();
    const attempts = [
      { quantity: Number.NaN, supplier: "บริษัท ไทยเมด", batchNumber: "LOT-NAN", expiry: "2028-12-31" },
      { quantity: 1.5, supplier: "บริษัท ไทยเมด", batchNumber: "LOT-FRACTION", expiry: "2028-12-31" },
      { quantity: 10, supplier: "", batchNumber: "LOT-NOSUPPLIER", expiry: "2028-12-31" },
      { quantity: 10, supplier: "บริษัท ไทยเมด", batchNumber: "LOT-OLD", expiry: "2000-01-01" },
    ];

    for (const attempt of attempts) {
      const next = careFlowReducer(state, { type: "RECEIVE_STOCK", payload: { inventoryId: "med-paracetamol", unit: "กล่อง", receivedAt: "2026-08-02T10:20:00.000Z", ...attempt } });
      expect(next.inventory.find((item) => item.id === "med-paracetamol")?.stock).toBe(42);
    }
  });

  it("propagates an earlier valid expiry from a received batch", () => {
    const next = careFlowReducer(createSeedState(), { type: "RECEIVE_STOCK", payload: { inventoryId: "med-paracetamol", quantity: 10, unit: "กล่อง", supplier: "บริษัท ไทยเมด", batchNumber: "LOT-EARLY", expiry: "2027-01-31", receivedAt: "2026-08-02T10:20:00.000Z" } });

    expect(next.inventory.find((item) => item.id === "med-paracetamol")?.earliestExpiry).toBe("2027-01-31");
  });

  it("rejects an appointment that conflicts with an occupied slot", () => {
    const state = createSeedState();
    const next = careFlowReducer(state, {
      type: "CREATE_APPOINTMENT",
      payload: {
        id: "appt-conflict",
        patientId: "patient-somchai",
        patientName: "สมชาย ใจดี",
        date: "2026-08-03",
        time: "09:00",
        durationMinutes: 60,
        reason: "ตรวจติดตามเบาหวาน",
        notes: "",
        tone: "mint",
      },
    });

    expect(next.appointments.some((appointment) => appointment.id === "appt-conflict")).toBe(false);
    expect(next.toasts.at(-1)?.tone).toBe("error");
  });
});
