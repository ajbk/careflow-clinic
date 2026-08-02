import { describe, expect, it } from "vitest";
import { createSeedState } from "@/lib/careflow/seed";
import { loadState, saveState, STORAGE_KEY } from "@/lib/careflow/storage";

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
