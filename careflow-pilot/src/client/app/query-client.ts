import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isApiError } from "../lib/api-error";

export type AuthRequiredReason = "AUTH_REQUIRED" | "SESSION_EXPIRED";
export const authRequiredEventName = "careflow-auth-required";

export const queryKeys = {
  session: ["session"] as const,
  dashboard: ["dashboard"] as const,
  queue: ["queue"] as const,
  checkout: (id: string) => ["checkout", id] as const,
  opdCard: (id: string) => ["opd-card", id] as const,
  patientSearch: (q: string) => ["patients", q] as const,
  patientAllergy: (patientId: string) => ["patient-allergy", patientId] as const,
  medicationSearch: (q: string) => ["medications", q] as const,
  inventory: ["inventory"] as const,
  inventoryMedicationSearch: (q: string) => ["inventory-medications", q] as const,
  inventoryLots: (medicationId: string) => ["inventory-lots", medicationId] as const,
  visit: (id: string) => ["visit", id] as const,
  journey: (visitId: string) => ["journey", visitId] as const,
  dispensing: (id: string) => ["dispensing", id] as const,
  label: (id: string) => ["dispensing", id, "label"] as const,
};

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  ) {
    return false;
  }
  if (!isApiError(error)) return false;
  return error.status === 0 || error.status >= 500;
}

function notifyUnauthorized(error: unknown): void {
  if (!isApiError(error) || error.status !== 401 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ reason: AuthRequiredReason }>(authRequiredEventName, {
    detail: { reason: "AUTH_REQUIRED" },
  }));
}

export function createAppQueryClient(): QueryClient {
  const queryCache = new QueryCache({ onError: notifyUnauthorized });
  const mutationCache = new MutationCache({ onError: notifyUnauthorized });
  return new QueryClient({
    queryCache,
    mutationCache,
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export const createQueryClient = createAppQueryClient;
