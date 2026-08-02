import { createSeedState } from "./seed";
import type { CareFlowState } from "./types";

export const STORAGE_KEY = "careflow.prototype.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function recoveredSeed(): CareFlowState {
  return { ...createSeedState(), storageRecovered: true };
}

function isCareFlowState(value: unknown): value is CareFlowState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CareFlowState>;
  return (
    candidate.version === 1 &&
    (candidate.role === "assistant" || candidate.role === "doctor") &&
    Array.isArray(candidate.patients) &&
    Array.isArray(candidate.visits) &&
    Array.isArray(candidate.inventory) &&
    Array.isArray(candidate.appointments)
  );
}

export function loadState(storage: StorageLike): CareFlowState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return createSeedState();

  try {
    const envelope = JSON.parse(raw) as { version?: number; state?: unknown };
    if (envelope.version !== 1 || !isCareFlowState(envelope.state)) return recoveredSeed();
    return { ...envelope.state, storageRecovered: false, toasts: [] };
  } catch {
    return recoveredSeed();
  }
}

export function saveState(storage: StorageLike, state: CareFlowState): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { ...state, toasts: [] } }));
}
