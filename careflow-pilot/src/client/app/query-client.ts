import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isApiError } from "../lib/api-error";

export const queryKeys = {
  session: ["session"] as const,
  dashboard: ["dashboard"] as const,
  queue: ["queue"] as const,
  patientSearch: (q: string) => ["patients", q] as const,
  visit: (id: string) => ["visit", id] as const,
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
  window.dispatchEvent(new CustomEvent("careflow-auth-required"));
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
