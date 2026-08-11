import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  allergyReviewResultSchema,
  type AllergyAssessmentDto,
  type AllergySeverity,
  type ReviewAllergyBody,
  type VisitWorkspaceDto,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { invalidateJourney } from "./journey";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

const responseSchema = z.strictObject({ data: allergyReviewResultSchema, replayed: z.boolean() });
export type ReviewAllergyAttempt = CommandAttempt<ReviewAllergyBody["payload"], ReviewAllergyBody["expectedRevisions"]>;
export type AllergyReviewContext = {
  patient: Pick<VisitWorkspaceDto["patient"], "id" | "revision">;
  visit: Pick<VisitWorkspaceDto["visit"], "id" | "revision">;
};

export function allergyStateLabelTh(state: AllergyAssessmentDto["state"]): string {
  if (state === "NONE_KNOWN") return "ยืนยันว่าไม่แพ้";
  if (state === "PRESENT") return "มีประวัติแพ้ยา";
  return "ยังไม่ทราบ";
}

export function allergySeverityLabelTh(severity: AllergySeverity): string {
  if (severity === "MILD") return "เล็กน้อย";
  if (severity === "MODERATE") return "ปานกลาง";
  if (severity === "SEVERE") return "รุนแรง";
  return "ยังไม่ทราบ";
}

export function createReviewAllergyAttempt(context: AllergyReviewContext, payload: ReviewAllergyBody["payload"]): ReviewAllergyAttempt {
  return createCommandAttempt({ patient: context.patient.revision, visit: context.visit.revision }, payload);
}

export function useReviewAllergy(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ context, attempt }: { context: AllergyReviewContext; attempt: ReviewAllergyAttempt }) => client.command(`/api/patients/${encodeURIComponent(context.patient.id)}/allergy-revisions`, attempt, responseSchema),
    retry: false,
    onSuccess: async (_data, { context }) => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.visit(context.visit.id) }), invalidateJourney(queryClient, context.visit.id), queryClient.invalidateQueries({ queryKey: queryKeys.queue }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]); },
  });
}
