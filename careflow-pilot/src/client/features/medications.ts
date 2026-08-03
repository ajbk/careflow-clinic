import { useQuery } from "@tanstack/react-query";
import { medicationSearchResponseSchema, type MedicationDto } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";

export function getMedicationSearch(client: ApiClient = defaultApiClient, query: string, signal?: AbortSignal): Promise<MedicationDto[]> {
  return client.get(`/api/medications?q=${encodeURIComponent(query)}`, medicationSearchResponseSchema, signal).then((response) => response.data);
}

export function useMedicationSearch(query: string, enabled: boolean, client: ApiClient = defaultApiClient) {
  const normalized = query.trim();
  return useQuery({
    queryKey: queryKeys.medicationSearch(normalized),
    enabled: enabled && Array.from(normalized).length >= 2,
    queryFn: ({ signal }) => getMedicationSearch(client, normalized, signal),
    retry: false,
  });
}
