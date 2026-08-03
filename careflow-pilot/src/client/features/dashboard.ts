import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { DashboardTodayResponse } from "../../shared/contracts";
import { dashboardTodayResponseSchema } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { isApiError } from "../lib/api-error";

export type DashboardToday = DashboardTodayResponse["data"];

function pollInterval(): number | false {
  return typeof document !== "undefined" && document.hidden ? false : 5_000;
}

export function getDashboardToday(client: ApiClient = defaultApiClient, signal?: AbortSignal): Promise<DashboardToday> {
  return client.get("/api/dashboard/today", dashboardTodayResponseSchema, signal).then((response) => response.data);
}

export function useDashboardToday(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const handleFocus = () => {
      if (typeof document === "undefined" || document.hidden) return;
      void queryClient.refetchQueries({ queryKey: queryKeys.dashboard });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: async ({ signal }) => {
      try {
        if (typeof document !== "undefined" && document.hidden) {
          return queryClient.getQueryData<DashboardToday>(queryKeys.dashboard) ?? getDashboardToday(client, signal);
        }
        return await getDashboardToday(client, signal);
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
