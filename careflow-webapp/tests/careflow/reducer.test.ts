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
    state = careFlowReducer(state, {
      type: "CONFIRM_DISPENSING",
      payload: { visitId: "demo-visit", dispensedAt: "2026-08-02T10:01:00.000Z" },
    });
    const afterSecond = state.inventory.find((item) => item.id === "med-paracetamol")?.stock;

    expect(before).toBe(42);
    expect(afterFirst).toBe(22);
    expect(afterSecond).toBe(22);
    expect(state.visits.find((visit) => visit.id === "demo-visit")?.status).toBe(
      "awaiting-payment",
    );
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
