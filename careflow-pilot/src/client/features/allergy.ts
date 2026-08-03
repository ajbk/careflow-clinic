import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { allergyReviewResultSchema, type ReviewAllergyBody, type VisitWorkspaceDto } from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

const responseSchema = z.strictObject({ data: allergyReviewResultSchema, replayed: z.boolean() });
export type ReviewAllergyAttempt = CommandAttempt<ReviewAllergyBody["payload"], ReviewAllergyBody["expectedRevisions"]>;

export function createReviewAllergyAttempt(workspace: VisitWorkspaceDto, payload: ReviewAllergyBody["payload"]): ReviewAllergyAttempt {
  return createCommandAttempt({ patient: workspace.patient.revision, visit: workspace.visit.revision }, payload);
}

export function useReviewAllergy(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workspace, attempt }: { workspace: VisitWorkspaceDto; attempt: ReviewAllergyAttempt }) => client.command(`/api/patients/${encodeURIComponent(workspace.patient.id)}/allergy-revisions`, attempt, responseSchema),
    retry: false,
    onSuccess: async (_data, { workspace }) => { await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.visit(workspace.visit.id) }), queryClient.invalidateQueries({ queryKey: queryKeys.queue }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]); },
  });
}
