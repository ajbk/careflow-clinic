import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/careflow/seed";
import {
  selectDashboardMetrics,
  selectInventoryStatus,
  selectQueueColumns,
} from "@/lib/careflow/selectors";

describe("CareFlow selectors", () => {
  it("derives dashboard metrics from live workflow state", () => {
    const metrics = selectDashboardMetrics(createSeedState());

    expect(metrics).toEqual({
      currentPatients: 8,
      waiting: 5,
      dispensing: 2,
      payment: 1,
      lowStock: 3,
    });
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
