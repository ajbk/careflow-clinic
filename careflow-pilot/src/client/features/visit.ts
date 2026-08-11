import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import type { QueueItemDto, VisitWorkspaceDto } from "../../shared/contracts";
import { queueItemSchema, visitWorkspaceSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { invalidateJourney } from "./journey";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";
import { isApiError } from "../lib/api-error";

export type StartConsultationAttempt = CommandAttempt<Record<string, never>, { visit: number }>;

function pollInterval(): number | false {
  return typeof document !== "undefined" && document.hidden ? false : 5_000;
}

const startConsultationResponseSchema = z.strictObject({
  data: queueItemSchema,
  replayed: z.boolean(),
});

export function createStartConsultationAttempt(item: QueueItemDto): StartConsultationAttempt {
  return createCommandAttempt({ visit: item.visit.revision }, {});
}

export function getVisitWorkspace(
  client: ApiClient = defaultApiClient,
  visitId: string,
  signal?: AbortSignal,
): Promise<VisitWorkspaceDto> {
  return client
    .get(`/api/visits/${encodeURIComponent(visitId)}/workspace`, z.strictObject({ data: visitWorkspaceSchema }), signal)
    .then((response) => response.data);
}

export function startConsultation(
  client: ApiClient = defaultApiClient,
  visitId: string,
  attempt: StartConsultationAttempt,
  signal?: AbortSignal,
): Promise<QueueItemDto> {
  return client
    .command<Record<string, never>, { visit: number }, z.infer<typeof startConsultationResponseSchema>>(
      `/api/visits/${encodeURIComponent(visitId)}/start-consultation`,
      attempt,
      startConsultationResponseSchema,
      signal,
    )
    .then((response) => response.data);
}

export function useVisitWorkspace(visitId: string, client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!visitId) return undefined;
    const handleFocus = () => {
      if (typeof document === "undefined" || document.hidden) return;
      void queryClient.refetchQueries({ queryKey: queryKeys.visit(visitId) });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient, visitId]);
  return useQuery({
    queryKey: queryKeys.visit(visitId),
    enabled: visitId.length > 0,
    queryFn: async ({ signal }) => {
      try {
        if (typeof document !== "undefined" && document.hidden) {
          return queryClient.getQueryData<VisitWorkspaceDto>(queryKeys.visit(visitId)) ?? getVisitWorkspace(client, visitId, signal);
        }
        return await getVisitWorkspace(client, visitId, signal);
      } catch (error) {
        if (isApiError(error) && error.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("careflow-auth-required"));
        throw error;
      }
    },
    refetchInterval: pollInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useStartConsultation(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, attempt }: { visitId: string; attempt: StartConsultationAttempt }) =>
      startConsultation(client, visitId, attempt),
    retry: false,
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
        queryClient.invalidateQueries({ queryKey: queryKeys.visit(variables.visitId) }),
        invalidateJourney(queryClient, variables.visitId),
      ]);
    },
  });
}
