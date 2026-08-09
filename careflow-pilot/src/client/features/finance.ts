import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z, type ZodType } from "zod";
import {
  checkoutDtoSchema,
  collectionResponseSchema,
  finalizeChargeResponseSchema,
  type ApproveFullWaiverBody,
  type CheckoutDto,
  type CollectionResponse,
  type ConfirmPromptPayBody,
  type FinalizeChargeBody,
  type FinalizeChargeResponse,
  type RecordCashBody,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { isApiError } from "../lib/api-error";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

const checkoutResponseSchema = z.strictObject({ data: checkoutDtoSchema });

export type FinalizeChargeAttempt = CommandAttempt<FinalizeChargeBody["payload"], FinalizeChargeBody["expectedRevisions"]>;
export type ApproveFullWaiverAttempt = CommandAttempt<ApproveFullWaiverBody["payload"], ApproveFullWaiverBody["expectedRevisions"]>;
export type RecordCashAttempt = CommandAttempt<RecordCashBody["payload"], RecordCashBody["expectedRevisions"]>;
export type ConfirmPromptPayAttempt = CommandAttempt<ConfirmPromptPayBody["payload"], ConfirmPromptPayBody["expectedRevisions"]>;

type FinanceCommandResponse = FinalizeChargeResponse | CollectionResponse;

function allowed(data: CheckoutDto, action: CheckoutDto["allowedActions"][number]): void {
  if (!data.allowedActions.includes(action)) throw new Error(`Server did not authorize ${action}`);
}

function requireCharge(data: CheckoutDto) {
  if (!data.charge) throw new Error("A finalized charge is required");
  return data.charge;
}

export function getCheckout(
  client: ApiClient = defaultApiClient,
  visitId: string,
  signal?: AbortSignal,
): Promise<CheckoutDto> {
  return client
    .get(`/api/checkout/${encodeURIComponent(visitId)}`, checkoutResponseSchema, signal)
    .then((response) => response.data);
}

export function createFinalizeChargeAttempt(data: CheckoutDto): FinalizeChargeAttempt {
  allowed(data, "FINALIZE_CHARGE");
  return createCommandAttempt(
    { visit: data.visit.revision, clinicPricing: data.clinicPricingRevision },
    { settlementIntent: "COLLECT" },
  );
}

export function createFinalizeFullWaiverAttempt(data: CheckoutDto, waiverReason: string): FinalizeChargeAttempt {
  allowed(data, "FINALIZE_CHARGE");
  return createCommandAttempt(
    { visit: data.visit.revision, clinicPricing: data.clinicPricingRevision },
    { settlementIntent: "FULL_WAIVER", waiverReason: waiverReason.trim() },
  );
}

export function createApproveFullWaiverAttempt(data: CheckoutDto, reason: string): ApproveFullWaiverAttempt {
  allowed(data, "APPROVE_FULL_WAIVER");
  const charge = requireCharge(data);
  return createCommandAttempt({ visit: data.visit.revision }, { chargeId: charge.id, reason: reason.trim() });
}

export function createRecordCashAttempt(data: CheckoutDto): RecordCashAttempt {
  allowed(data, "RECORD_CASH");
  const charge = requireCharge(data);
  return createCommandAttempt({ visit: data.visit.revision }, { chargeId: charge.id, amountBaht: data.netDueBaht });
}

export function createConfirmPromptPayAttempt(data: CheckoutDto, manualReference: string): ConfirmPromptPayAttempt {
  allowed(data, "CONFIRM_PROMPTPAY");
  const charge = requireCharge(data);
  return createCommandAttempt(
    { visit: data.visit.revision },
    { chargeId: charge.id, amountBaht: data.netDueBaht, manualReference: manualReference.trim() },
  );
}

export function useCheckout(visitId: string, client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!visitId) return undefined;
    const handleFocus = () => {
      if (typeof document === "undefined" || document.hidden) return;
      void queryClient.refetchQueries({ queryKey: queryKeys.checkout(visitId) });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient, visitId]);

  return useQuery({
    queryKey: queryKeys.checkout(visitId),
    enabled: visitId.length > 0,
    queryFn: async ({ signal }) => {
      try {
        if (typeof document !== "undefined" && document.hidden) {
          return queryClient.getQueryData<CheckoutDto>(queryKeys.checkout(visitId)) ?? getCheckout(client, visitId, signal);
        }
        return await getCheckout(client, visitId, signal);
      } catch (error) {
        if (isApiError(error) && error.status === 401 && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("careflow-auth-required"));
        }
        throw error;
      }
    },
    retry: false,
    refetchOnWindowFocus: true,
  });
}

function invalidateAfterFinanceCommand(
  queryClient: ReturnType<typeof useQueryClient>,
  visitId: string,
  data: CheckoutDto,
): Promise<void> {
  queryClient.setQueryData(queryKeys.checkout(visitId), data);
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.checkout(visitId), refetchType: "none" }),
    queryClient.invalidateQueries({ queryKey: queryKeys.visit(visitId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dispensing(visitId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
  ]).then(() => undefined);
}

function useFinanceCommand<TPayload, TRevisions extends Record<string, number>, TResult extends FinanceCommandResponse>(
  client: ApiClient,
  endpoint: (visitId: string) => string,
  responseSchema: ZodType<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, attempt }: { visitId: string; attempt: CommandAttempt<TPayload, TRevisions> }) =>
      client.command<TPayload, TRevisions, TResult>(endpoint(visitId), attempt, responseSchema),
    retry: false,
    onSuccess: (result, variables) => invalidateAfterFinanceCommand(queryClient, variables.visitId, result.data),
  });
}

export function useFinalizeCharge(client: ApiClient = defaultApiClient) {
  return useFinanceCommand<FinalizeChargeBody["payload"], FinalizeChargeBody["expectedRevisions"], FinalizeChargeResponse>(
    client,
    (visitId) => `/api/checkout/${encodeURIComponent(visitId)}/charge-finalizations`,
    finalizeChargeResponseSchema,
  );
}

export function useApproveWaiver(client: ApiClient = defaultApiClient) {
  return useFinanceCommand<ApproveFullWaiverBody["payload"], ApproveFullWaiverBody["expectedRevisions"], CollectionResponse>(
    client,
    (visitId) => `/api/checkout/${encodeURIComponent(visitId)}/waivers`,
    collectionResponseSchema,
  );
}

export function useRecordCash(client: ApiClient = defaultApiClient) {
  return useFinanceCommand<RecordCashBody["payload"], RecordCashBody["expectedRevisions"], CollectionResponse>(
    client,
    (visitId) => `/api/checkout/${encodeURIComponent(visitId)}/payments/cash`,
    collectionResponseSchema,
  );
}

export function useConfirmPromptPay(client: ApiClient = defaultApiClient) {
  return useFinanceCommand<ConfirmPromptPayBody["payload"], ConfirmPromptPayBody["expectedRevisions"], CollectionResponse>(
    client,
    (visitId) => `/api/checkout/${encodeURIComponent(visitId)}/payments/promptpay`,
    collectionResponseSchema,
  );
}
