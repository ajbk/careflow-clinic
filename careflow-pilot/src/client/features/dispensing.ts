import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  fulfillmentCurrentLabelSchema,
  fulfillmentPickListSchema,
  type FulfillmentAbandonPreparationBody,
  type FulfillmentCompletePreparationBody,
  type FulfillmentConfirmationBody,
  type FulfillmentPickListDto,
  type FulfillmentPrintBody,
  type FulfillmentReleaseBody,
  type FulfillmentRejectBody,
  type FulfillmentHandoffBody,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

const pickListResponseSchema = z.strictObject({ data: fulfillmentPickListSchema });
const labelResponseSchema = z.strictObject({ data: fulfillmentCurrentLabelSchema });
const commandResponseSchema = z.strictObject({ data: fulfillmentPickListSchema, replayed: z.boolean() });

export type ReserveDispensingAttempt = CommandAttempt<{ labelVersionId: string }, { visit: number; medicationDecision: number }>;
export type PrintLabelAttempt = CommandAttempt<FulfillmentPrintBody["payload"], FulfillmentPrintBody["expectedRevisions"]>;
export type ConfirmAllocationAttempt = CommandAttempt<FulfillmentConfirmationBody["payload"], FulfillmentConfirmationBody["expectedRevisions"]>;
export type CompletePreparationAttempt = CommandAttempt<FulfillmentCompletePreparationBody["payload"], FulfillmentCompletePreparationBody["expectedRevisions"]>;
export type AbandonPreparationAttempt = CommandAttempt<FulfillmentAbandonPreparationBody["payload"], FulfillmentAbandonPreparationBody["expectedRevisions"]>;
export type ReleaseAttempt = CommandAttempt<FulfillmentReleaseBody["payload"], FulfillmentReleaseBody["expectedRevisions"]>;
export type RejectAttempt = CommandAttempt<FulfillmentRejectBody["payload"], FulfillmentRejectBody["expectedRevisions"]>;
export type HandoffAttempt = CommandAttempt<FulfillmentHandoffBody["payload"], FulfillmentHandoffBody["expectedRevisions"]>;

export function getDispensingPickList(client: ApiClient = defaultApiClient, visitId: string, signal?: AbortSignal): Promise<FulfillmentPickListDto> {
  return client.get(`/api/dispensing/${encodeURIComponent(visitId)}`, pickListResponseSchema, signal).then((result) => result.data);
}

export function getCurrentLabel(client: ApiClient = defaultApiClient, visitId: string, signal?: AbortSignal) {
  return client.get(`/api/dispensing/${encodeURIComponent(visitId)}/labels`, labelResponseSchema, signal).then((result) => result.data);
}

function requiredPreparation(data: FulfillmentPickListDto) {
  if (!data.preparation || data.preparation.status !== "ACTIVE") throw new Error("An active preparation is required");
  return data.preparation;
}

export function createReserveDispensingAttempt(data: FulfillmentPickListDto): ReserveDispensingAttempt {
  if (!data.medicationDecision || data.medicationDecision.kind !== "ORDER" || !data.label) throw new Error("A current signed label is required");
  return createCommandAttempt({ visit: data.visit.revision, medicationDecision: data.medicationDecision.version }, { labelVersionId: data.label.id });
}

export function createPrintLabelAttempt(data: FulfillmentPickListDto): PrintLabelAttempt {
  if (!data.label) throw new Error("A current label is required");
  if (!data.medicationDecision || data.medicationDecision.kind !== "ORDER") throw new Error("A signed order is required");
  return createCommandAttempt({ visit: data.visit.revision }, { rendererVersion: "careflow-label-ui-v1", decisionVersion: data.medicationDecision.version });
}

export function createConfirmAllocationAttempt(data: FulfillmentPickListDto, payload: FulfillmentConfirmationBody["payload"]): ConfirmAllocationAttempt {
  const preparation = requiredPreparation(data);
  return createCommandAttempt({ visit: data.visit.revision, preparation: preparation.revision }, payload);
}

export function createCompletePreparationAttempt(data: FulfillmentPickListDto): CompletePreparationAttempt {
  const preparation = requiredPreparation(data);
  if (!data.reservation) throw new Error("An active reservation is required");
  return createCommandAttempt({ visit: data.visit.revision, preparation: preparation.revision }, { preparationId: preparation.id, reservationId: data.reservation.id });
}

export function createAbandonPreparationAttempt(data: FulfillmentPickListDto, reason: string): AbandonPreparationAttempt {
  const preparation = requiredPreparation(data);
  if (!data.reservation) throw new Error("An active reservation is required");
  return createCommandAttempt({ visit: data.visit.revision, preparation: preparation.revision }, { preparationId: preparation.id, reservationId: data.reservation.id, reason: reason.trim() });
}

function requiredCompletedPreparation(data: FulfillmentPickListDto) {
  if (!data.preparation || data.preparation.status !== "COMPLETED") throw new Error("A completed preparation is required");
  if (!data.medicationDecision || data.medicationDecision.kind !== "ORDER" || !data.label || !data.reservation || !data.preparation.latestPrintEventId) throw new Error("The reviewed release chain is incomplete");
  return data.preparation;
}

export function createReleaseAttempt(data: FulfillmentPickListDto): ReleaseAttempt {
  const preparation = requiredCompletedPreparation(data);
  const printEventId = preparation.latestPrintEventId;
  if (!printEventId) throw new Error("A qualifying print event is required");
  return createCommandAttempt({ visit: data.visit.revision, preparation: preparation.revision }, {
    decisionId: data.medicationDecision!.id, decisionVersion: data.medicationDecision!.version, labelVersionId: data.label!.id,
    labelPrintEventId: printEventId, preparationId: preparation.id, reservationId: data.reservation!.id,
  });
}

export function createRejectAttempt(data: FulfillmentPickListDto, reason: string): RejectAttempt {
  const preparation = requiredCompletedPreparation(data);
  const printEventId = preparation.latestPrintEventId;
  if (!printEventId) throw new Error("A qualifying print event is required");
  return createCommandAttempt({ visit: data.visit.revision, preparation: preparation.revision }, {
    decisionId: data.medicationDecision!.id, decisionVersion: data.medicationDecision!.version, labelVersionId: data.label!.id,
    labelPrintEventId: printEventId, preparationId: preparation.id, reservationId: data.reservation!.id, reason: reason.trim(),
  });
}

export function createHandoffAttempt(data: FulfillmentPickListDto): HandoffAttempt {
  if (!data.medicationDecision || data.medicationDecision.kind !== "ORDER" || !data.label || !data.release || !data.reservation) throw new Error("The reviewed handoff chain is incomplete");
  return createCommandAttempt({ visit: data.visit.revision }, {
    decisionId: data.medicationDecision.id, decisionVersion: data.medicationDecision.version, labelVersionId: data.label.id,
    releaseId: data.release.id, reservationId: data.reservation.id,
  });
}

function invalidateAfterCommand(queryClient: ReturnType<typeof useQueryClient>, visitId: string, data: FulfillmentPickListDto): void {
  queryClient.setQueryData(queryKeys.dispensing(visitId), data);
  queryClient.invalidateQueries({ queryKey: queryKeys.dispensing(visitId), refetchType: "none" });
  queryClient.invalidateQueries({ queryKey: queryKeys.label(visitId), refetchType: "none" });
  void Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory }),
    queryClient.invalidateQueries({ queryKey: queryKeys.visit(visitId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  ]);
}

export function useDispensingPickList(visitId: string, client: ApiClient = defaultApiClient) {
  return useQuery({ queryKey: queryKeys.dispensing(visitId), enabled: visitId.length > 0, queryFn: ({ signal }) => getDispensingPickList(client, visitId, signal), retry: false });
}

export function useCurrentLabel(visitId: string, client: ApiClient = defaultApiClient) {
  return useQuery({ queryKey: queryKeys.label(visitId), enabled: visitId.length > 0, queryFn: ({ signal }) => getCurrentLabel(client, visitId, signal), retry: false });
}

function useCommandMutation<TPayload, TRevisions extends Record<string, number>>(
  client: ApiClient,
  endpoint: (visitId: string) => string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, attempt }: { visitId: string; attempt: CommandAttempt<TPayload, TRevisions> }) => client.command(endpoint(visitId), attempt, commandResponseSchema),
    retry: false,
    onSuccess: (result, variables) => invalidateAfterCommand(queryClient, variables.visitId, result.data),
  });
}

export function useReserveDispensing(client: ApiClient = defaultApiClient) { return useCommandMutation<{ labelVersionId: string }, { visit: number; medicationDecision: number }>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/reservations`); }
export function usePrintLabel(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, labelVersionId, attempt }: { visitId: string; labelVersionId: string; attempt: PrintLabelAttempt }) =>
      client.command(`/api/dispensing/${encodeURIComponent(visitId)}/labels/${encodeURIComponent(labelVersionId)}/print-events`, attempt, commandResponseSchema),
    retry: false,
    onSuccess: (result, variables) => invalidateAfterCommand(queryClient, variables.visitId, result.data),
  });
}
export function useConfirmAllocation(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentConfirmationBody["payload"], FulfillmentConfirmationBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/preparation-confirmations`); }
export function useCompletePreparation(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentCompletePreparationBody["payload"], FulfillmentCompletePreparationBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/complete-preparation`); }
export function useAbandonPreparation(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentAbandonPreparationBody["payload"], FulfillmentAbandonPreparationBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/reservation-release`); }
export function useRelease(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentReleaseBody["payload"], FulfillmentReleaseBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/release`); }
export function useReject(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentRejectBody["payload"], FulfillmentRejectBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/reject`); }
export function useHandoff(client: ApiClient = defaultApiClient) { return useCommandMutation<FulfillmentHandoffBody["payload"], FulfillmentHandoffBody["expectedRevisions"]>(client, (visitId) => `/api/dispensing/${encodeURIComponent(visitId)}/handoff`); }
