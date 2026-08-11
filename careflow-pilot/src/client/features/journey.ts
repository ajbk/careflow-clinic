import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";
import { type VisitJourneyDto, visitJourneyResponseSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { isApiError } from "../lib/api-error";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";

export function getVisitJourney(
  client: ApiClient = defaultApiClient,
  visitId: string,
  signal?: AbortSignal,
): Promise<VisitJourneyDto> {
  return client
    .get(`/api/visits/${encodeURIComponent(visitId)}/journey`, visitJourneyResponseSchema, signal)
    .then((response) => response.data);
}

function retryJourneyRead(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1 || !isApiError(error)) return false;
  return error.status === 0 || error.status >= 500;
}

export function useVisitJourney(
  visitId: string,
  client: ApiClient = defaultApiClient,
): UseQueryResult<VisitJourneyDto> {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!visitId) return undefined;
    const refetchOnFocus = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void queryClient.refetchQueries({ queryKey: queryKeys.journey(visitId) });
    };
    window.addEventListener("focus", refetchOnFocus);
    return () => window.removeEventListener("focus", refetchOnFocus);
  }, [queryClient, visitId]);

  return useQuery<VisitJourneyDto>({
    queryKey: queryKeys.journey(visitId),
    enabled: visitId.length > 0,
    queryFn: ({ signal }) => getVisitJourney(client, visitId, signal),
    retry: retryJourneyRead,
    refetchOnWindowFocus: true,
  });
}

export function journeyAuthorityUnavailable(query: Pick<UseQueryResult<VisitJourneyDto>, "isPending" | "isError" | "isFetching" | "error">): boolean {
  return query.isPending || query.isError || (query.isFetching && query.error !== null);
}

export function invalidateJourney(queryClient: QueryClient, visitId: string): Promise<void> {
  if (!visitId) return Promise.resolve();
  return queryClient.invalidateQueries({ queryKey: queryKeys.journey(visitId) }).then(() => undefined);
}
