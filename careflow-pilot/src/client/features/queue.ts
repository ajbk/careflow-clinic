import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { QueueItemDto, QueueResponse } from "../../shared/contracts";
import { queueResponseSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { isApiError } from "../lib/api-error";

export type QueueItem = QueueItemDto;

function pollInterval(): number | false {
  return typeof document !== "undefined" && document.hidden ? false : 5_000;
}

export function getQueue(client: ApiClient = defaultApiClient, signal?: AbortSignal): Promise<QueueItem[]> {
  return client.get("/api/queue", queueResponseSchema, signal).then((response: QueueResponse) => response.data);
}

export function useQueue(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handleFocus = () => {
      if (typeof document === "undefined" || document.hidden) return;
      void queryClient.refetchQueries({ queryKey: queryKeys.queue });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);
  return useQuery({
    queryKey: queryKeys.queue,
    queryFn: async ({ signal }) => {
      try {
        if (typeof document !== "undefined" && document.hidden) {
          return queryClient.getQueryData<QueueItem[]>(queryKeys.queue) ?? getQueue(client, signal);
        }
        return await getQueue(client, signal);
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
