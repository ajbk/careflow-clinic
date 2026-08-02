import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/careflow/seed";
import {
  selectAnalyticsReport,
  selectDashboardMetrics,
  selectInventoryStatus,
  selectQueueColumns,
} from "@/lib/careflow/selectors";

describe("CareFlow selectors", () => {
  it("derives dashboard metrics from live workflow state", () => {
    const metrics = selectDashboardMetrics(createSeedState());

    expect(metrics).toEqual({
      currentPatients: 10,
      waiting: 5,
      dispensing: 2,
      payment: 1,
      lowStock: 3,
    });
  });

  it("keeps active patients counted while a visit progresses to dispensing", () => {
    const state = createSeedState();
    state.visits[0] = { ...state.visits[0], status: "awaiting-dispensing" };

    expect(selectDashboardMetrics(state).currentPatients).toBe(10);
  });

  it("layers live workflow deltas onto the October 2566 analytics baseline", () => {
    const state = createSeedState();
    state.patients.push({ id: "patient-extra", hn: "69-10001", name: "ทดสอบ เพิ่ม", age: 40, gender: "หญิง", phone: "0800000000", allergies: [] });
    state.visits[0] = {
      ...state.visits[0],
      status: "awaiting-payment",
      signedAt: "2026-08-02T09:45:00.000Z",
      clinical: { ...state.visits[0].clinical, assessment: "ติดเชื้อ", diagnosis: { code: "J06.9", labelTh: "การติดเชื้อทางเดินหายใจส่วนบน", labelEn: "URI" } },
    };
    state.transactions.push({ id: "txn-extra", visitId: "demo-visit", method: "cash", consultationFee: 100, medicationTotal: 250, total: 350, paidAt: "2026-08-02T10:00:00.000Z" });
    state.inventory[1] = { ...state.inventory[1], stock: 80 };

    const report = selectAnalyticsReport(state);

    expect(report.patientVolume).toBe(249);
    expect(report.consultations).toBe(313);
    expect(report.revenue).toBe(45_550);
    expect(report.monthlySeries.at(-1)?.value).toBeGreaterThan(92);
    expect(report.diagnoses.find((item) => item.code === "J06.9")?.count).toBe(32);
    expect(report.lowStock).toBe(2);
  });

  it("groups queue cards into three visual columns", () => {
    const columns = selectQueueColumns(createSeedState());

    expect(columns.waiting).toHaveLength(5);
    expect(columns.inProgress).toHaveLength(2);
    expect(columns.completed).toHaveLength(4);
  });

  it("marks depleted and low-stock inventory without storing duplicate status", () => {
    expect(selectInventoryStatus({ stock: 0, threshold: 20 })).toBe("depleted");
    expect(selectInventoryStatus({ stock: 12, threshold: 20 })).toBe("low");
    expect(selectInventoryStatus({ stock: 21, threshold: 20 })).toBe("healthy");
  });
});
