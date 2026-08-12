import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inventoryMedicationSearchResponseSchema,
  inventoryLotCommandResponseSchema,
  inventoryLotsResponseSchema,
  inventoryResponseSchema,
  receiveInventoryResponseSchema,
  type InventorySummaryDto,
  type MedicationDto,
  type ReceiveInventoryPayload,
  type InventoryLotBalanceDto,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { invalidateJourney } from "./journey";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

export type ReceiveInventoryAttempt = CommandAttempt<ReceiveInventoryPayload, { medication: number }>;
export type InventoryLotAttempt = CommandAttempt<{ reason: string }, { lot: number }>;
export type InventoryAdjustmentAttempt = CommandAttempt<{ correctsMovementId: string; quantityDelta: number; reason: string }, { lot: number }>;

export function getInventory(client: ApiClient = defaultApiClient, signal?: AbortSignal): Promise<InventorySummaryDto[]> {
  return client.get("/api/inventory", inventoryResponseSchema, signal).then((response) => response.data);
}

export function getInventoryMedicationSearch(client: ApiClient = defaultApiClient, query: string, signal?: AbortSignal): Promise<MedicationDto[]> {
  return client.get(`/api/inventory/medications?q=${encodeURIComponent(query)}`, inventoryMedicationSearchResponseSchema, signal).then((response) => response.data);
}

export function getInventoryLots(client: ApiClient = defaultApiClient, medicationId: string, signal?: AbortSignal): Promise<InventoryLotBalanceDto[]> {
  return client.get(`/api/inventory/medications/${encodeURIComponent(medicationId)}/lots`, inventoryLotsResponseSchema, signal).then((response) => response.data);
}

export function createReceiveInventoryAttempt(medication: MedicationDto, payload: ReceiveInventoryPayload): ReceiveInventoryAttempt {
  return createCommandAttempt({ medication: medication.revision }, payload);
}

export function useInventory(client: ApiClient = defaultApiClient) {
  return useQuery({
    queryKey: queryKeys.inventory,
    queryFn: ({ signal }) => getInventory(client, signal),
  });
}

export function useInventoryMedicationSearch(query: string, enabled: boolean, client: ApiClient = defaultApiClient) {
  const normalized = query.trim();
  return useQuery({
    queryKey: queryKeys.inventoryMedicationSearch(normalized),
    enabled: enabled && Array.from(normalized).length >= 2,
    queryFn: ({ signal }) => getInventoryMedicationSearch(client, normalized, signal),
    retry: false,
  });
}

export function useInventoryLots(medicationId: string | null, client: ApiClient = defaultApiClient) {
  return useQuery({
    queryKey: queryKeys.inventoryLots(medicationId ?? ""),
    enabled: Boolean(medicationId),
    queryFn: ({ signal }) => getInventoryLots(client, medicationId ?? "", signal),
    retry: false,
  });
}

function invalidateInventoryLot(queryClient: ReturnType<typeof useQueryClient>, medicationId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.inventory });
  void queryClient.invalidateQueries({ queryKey: queryKeys.inventoryLots(medicationId) });
}

export function useInventoryLotStatusCommand(medicationId: string, action: "quarantine" | "unquarantine", client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, attempt }: { lotId: string; attempt: InventoryLotAttempt }) => client.command(`/api/inventory/lots/${encodeURIComponent(lotId)}/${action}`, attempt, inventoryLotCommandResponseSchema),
    retry: false,
    onSuccess: () => invalidateInventoryLot(queryClient, medicationId),
  });
}

export function useInventoryAdjustment(medicationId: string, client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lotId, attempt }: { lotId: string; attempt: InventoryAdjustmentAttempt }) => client.command(`/api/inventory/lots/${encodeURIComponent(lotId)}/adjustments`, attempt, inventoryLotCommandResponseSchema),
    retry: false,
    onSuccess: () => invalidateInventoryLot(queryClient, medicationId),
  });
}

export function useReceiveInventory(visitId?: string, client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attempt: ReceiveInventoryAttempt) => client.command("/api/inventory/receipts", attempt, receiveInventoryResponseSchema),
    retry: false,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory }),
      invalidateJourney(queryClient, visitId ?? ""),
    ]).then(() => undefined),
  });
}
