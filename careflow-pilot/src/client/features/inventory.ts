import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  inventoryMedicationSearchResponseSchema,
  inventoryResponseSchema,
  receiveInventoryResponseSchema,
  type InventorySummaryDto,
  type MedicationDto,
  type ReceiveInventoryPayload,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

export type ReceiveInventoryAttempt = CommandAttempt<ReceiveInventoryPayload, { medication: number }>;

export function getInventory(client: ApiClient = defaultApiClient, signal?: AbortSignal): Promise<InventorySummaryDto[]> {
  return client.get("/api/inventory", inventoryResponseSchema, signal).then((response) => response.data);
}

export function getInventoryMedicationSearch(client: ApiClient = defaultApiClient, query: string, signal?: AbortSignal): Promise<MedicationDto[]> {
  return client.get(`/api/inventory/medications?q=${encodeURIComponent(query)}`, inventoryMedicationSearchResponseSchema, signal).then((response) => response.data);
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

export function useReceiveInventory(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attempt: ReceiveInventoryAttempt) => client.command("/api/inventory/receipts", attempt, receiveInventoryResponseSchema),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inventory }),
  });
}
