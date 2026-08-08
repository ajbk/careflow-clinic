import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  inventoryPickListSchema,
  inventoryReservationResponseSchema,
  type InventoryPickListDto,
  type ReleaseInventoryBody,
  type ReserveInventoryBody,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

const pickListResponseSchema = z.strictObject({ data: inventoryPickListSchema });

export type ReserveDispensingAttempt = CommandAttempt<ReserveInventoryBody["payload"], ReserveInventoryBody["expectedRevisions"]>;
export type ReleaseDispensingAttempt = CommandAttempt<ReleaseInventoryBody["payload"], ReleaseInventoryBody["expectedRevisions"]>;

export function getDispensingPickList(
  client: ApiClient = defaultApiClient,
  visitId: string,
  signal?: AbortSignal,
): Promise<InventoryPickListDto> {
  return client
    .get(`/api/dispensing/${encodeURIComponent(visitId)}`, pickListResponseSchema, signal)
    .then((response) => response.data);
}

export function createReserveDispensingAttempt(pickList: InventoryPickListDto): ReserveDispensingAttempt {
  if (pickList.medicationDecision.kind !== "ORDER") throw new Error("Only signed medication orders can reserve stock");
  return createCommandAttempt(
    { visit: pickList.visit.revision, medicationDecision: pickList.medicationDecision.version },
    {},
  );
}

export function createReleaseDispensingAttempt(
  pickList: InventoryPickListDto,
  reason: string,
): ReleaseDispensingAttempt {
  if (!pickList.reservation || pickList.reservation.status !== "ACTIVE") throw new Error("An active reservation is required");
  return createCommandAttempt({ visit: pickList.visit.revision }, { reason: reason.trim() });
}

function invalidateAfterCommand(queryClient: ReturnType<typeof useQueryClient>, visitId: string, data: InventoryPickListDto): void {
  // Keep the mutation response immediately visible, while marking the query stale for the next refresh.
  queryClient.invalidateQueries({ queryKey: queryKeys.dispensing(visitId), refetchType: "none" });
  queryClient.setQueryData(queryKeys.dispensing(visitId), data);
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.visit(visitId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  ]);
}

export function useDispensingPickList(visitId: string, client: ApiClient = defaultApiClient) {
  return useQuery({
    queryKey: queryKeys.dispensing(visitId),
    enabled: visitId.length > 0,
    queryFn: ({ signal }) => getDispensingPickList(client, visitId, signal),
  });
}

export function useReserveDispensing(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, attempt }: { visitId: string; attempt: ReserveDispensingAttempt }) =>
      client.command(`/api/dispensing/${encodeURIComponent(visitId)}/reservations`, attempt, inventoryReservationResponseSchema),
    retry: false,
    onSuccess: (result, variables) => invalidateAfterCommand(queryClient, variables.visitId, result.data),
  });
}

export function useReleaseDispensing(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, attempt }: { visitId: string; attempt: ReleaseDispensingAttempt }) =>
      client.command(`/api/dispensing/${encodeURIComponent(visitId)}/reservation-release`, attempt, inventoryReservationResponseSchema),
    retry: false,
    onSuccess: (result, variables) => invalidateAfterCommand(queryClient, variables.visitId, result.data),
  });
}
