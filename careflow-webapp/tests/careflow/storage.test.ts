import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/careflow/seed";
import { LEGACY_STORAGE_KEY, loadState, saveState, STORAGE_KEY } from "@/lib/careflow/storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("CareFlow storage", () => {
  it("round-trips a versioned CareFlow state", () => {
    const storage = memoryStorage();
    const state = createSeedState();
    state.role = "assistant";

    saveState(storage, state);

    expect(loadState(storage).role).toBe("assistant");
  });

  it("migrates a real v1 workflow to v2 without losing clinical, appointment, batch, transaction, or toast data", () => {
    const completed = createSeedState({ demoVisitStatus: "complete", allPrepared: true });
    const legacyState = {
      ...completed,
      version: 1,
      inventory: completed.inventory.map((item) => ({ ...item, unit: item.unit === "ขวด" ? "ขวด" : "กล่อง" })),
      batches: [{ id: "batch-v1", inventoryId: "med-paracetamol", quantity: 20, unit: "กล่อง", supplier: "คลังจังหวัด", batchNumber: "V1-PCM", expiry: "2028-12-31", receivedAt: "2026-08-01T08:00:00.000Z" }],
      appointments: [...completed.appointments, { id: "appt-v1", patientId: "patient-somchai", patientName: "สมชาย ใจดี", date: "2026-08-12", time: "10:00", durationMinutes: 60, reason: "ติดตามอาการ", notes: "นำสมุดยา", tone: "mint" as const }],
      transactions: [{ id: "txn-v1", visitId: "demo-visit", method: "cash" as const, consultationFee: 100, medicationTotal: 250, total: 350, paidAt: "2026-08-02T10:00:00.000Z" }],
      toasts: [{ id: "toast-v1", tone: "info" as const, message: "ข้อมูลเดิม" }],
      visits: completed.visits.map((visit) => ({
        ...visit,
        medications: visit.medications.map((medication) => {
          const legacyMedication = { ...medication } as Record<string, unknown>;
          delete legacyMedication.unit;
          return legacyMedication;
        }),
      })),
    };
    const storage = memoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify({ version: 1, state: legacyState }),
    });

    const migrated = loadState(storage);

    expect(migrated).toMatchObject({ version: 2, storageRecovered: false });
    expect(migrated.visits.find((visit) => visit.id === "demo-visit")?.status).toBe("complete");
    expect(migrated.visits.find((visit) => visit.id === "demo-visit")?.medications[0]).toMatchObject({ unit: "เม็ด", quantityLabel: "20 เม็ด" });
    expect(migrated.inventory.find((item) => item.id === "med-paracetamol")).toMatchObject({ stock: 42, unit: "เม็ด" });
    expect(migrated.batches).toMatchObject([{ id: "batch-v1", unit: "เม็ด", quantity: 20 }]);
    expect(migrated.appointments.some((appointment) => appointment.id === "appt-v1")).toBe(true);
    expect(migrated.transactions).toMatchObject([{ id: "txn-v1", total: 350 }]);
    expect(migrated.toasts).toMatchObject([{ id: "toast-v1", message: "ข้อมูลเดิม" }]);
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("prefers an existing v2 envelope over a legacy v1 fallback", () => {
    const v2 = createSeedState();
    v2.role = "assistant";
    const v1 = { ...createSeedState(), role: "doctor", version: 1 };
    const storage = memoryStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify({ version: 1, state: v1 }),
    });
    saveState(storage, v2);

    expect(loadState(storage).role).toBe("assistant");
  });

  it("returns a fresh seed when saved JSON is malformed", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "{not-json" });

    expect(loadState(storage)).toMatchObject({ role: "doctor", storageRecovered: true });
  });

  it("returns a fresh seed when the envelope version is unsupported", () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: 99, state: { role: "assistant" } }),
    });

    expect(loadState(storage)).toMatchObject({ role: "doctor", storageRecovered: true });
  });

  it("recovers from a structurally partial envelope before screens can dereference it", () => {
    const valid = createSeedState();
    const partialState = {
      ...valid,
      batches: undefined,
      transactions: undefined,
      toasts: undefined,
      visits: [{ id: "not-a-visit" }],
    };
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: 1, state: partialState }),
    });

    const recovered = loadState(storage);

    expect(recovered.storageRecovered).toBe(true);
    expect(recovered.batches).toEqual([]);
    expect(recovered.transactions).toEqual([]);
    expect(recovered.visits.find((visit) => visit.id === "demo-visit")).toBeDefined();
  });
});
