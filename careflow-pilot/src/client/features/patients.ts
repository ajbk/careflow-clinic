import { useQuery } from "@tanstack/react-query";
import type { PatientCommandResponse, PatientDto } from "../../shared/contracts";
import { patientCommandResponseSchema, patientSearchResponseSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import type { CommandAttempt } from "../lib/idempotency";

export type SyntheticPatientAttempt = CommandAttempt<
  Record<string, never>,
  Record<string, never>
>;

/**
 * Search is intentionally a plain query: the server is the only Patient
 * authority, and React Query's AbortSignal cancels stale debounced searches.
 */
export function usePatientSearch(
  query: string,
  apiClient: ApiClient = defaultApiClient,
) {
  const normalized = query.trim();
  const enabled = Array.from(normalized).length >= 2;
  return useQuery({
    queryKey: queryKeys.patientSearch(normalized),
    enabled,
    queryFn: async ({ signal }): Promise<PatientDto[]> => {
      const response = await apiClient.get(
        `/api/patients/search?q=${encodeURIComponent(normalized)}`,
        patientSearchResponseSchema,
        signal,
      );
      return response.data;
    },
    staleTime: 30_000,
  });
}

export async function createSyntheticPatient(
  client: ApiClient,
  attempt: SyntheticPatientAttempt,
  signal?: AbortSignal,
): Promise<PatientCommandResponse> {
  return client.command(
    "/api/patients/synthetic",
    attempt,
    patientCommandResponseSchema,
    signal,
  );
}
