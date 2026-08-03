import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  clinicalNoteAmendmentResponseSchema, finalizeConsultationResponseSchema, medicationDecisionRevisionResponseSchema,
  saveConsultationDraftResponseSchema, type FinalizeConsultationBody, type SaveConsultationDraftBody,
  type SignClinicalNoteAmendmentBody, type SignMedicationDecisionRevisionBody, type VisitWorkspaceDto,
} from "../../shared/contracts";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

export type ConsultationFormValue = SaveConsultationDraftBody["payload"];
export type SaveDraftAttempt = CommandAttempt<ConsultationFormValue, SaveConsultationDraftBody["expectedRevisions"]>;
export type FinalizeAttempt = CommandAttempt<Record<string, never>, FinalizeConsultationBody["expectedRevisions"]>;

export function createSaveDraftAttempt(workspace: VisitWorkspaceDto, value: ConsultationFormValue): SaveDraftAttempt {
  return createCommandAttempt({ visit: workspace.visit.revision, noteDraft: workspace.consultationDraft.note?.revision ?? 0, medicationDraft: workspace.consultationDraft.medicationDecision?.revision ?? 0 }, value);
}
export function createFinalizeAttempt(workspace: VisitWorkspaceDto): FinalizeAttempt {
  const noteDraft = workspace.consultationDraft.note;
  const medicationDraft = workspace.consultationDraft.medicationDecision;
  if (!noteDraft || !medicationDraft) throw new Error("Consultation drafts must be saved before signing");
  return createCommandAttempt({ visit: workspace.visit.revision, patient: workspace.patient.revision, noteDraft: noteDraft.revision, medicationDraft: medicationDraft.revision }, {});
}
function invalidate(queryClient: ReturnType<typeof useQueryClient>, visitId: string) { return Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.visit(visitId) }), queryClient.invalidateQueries({ queryKey: queryKeys.queue }), queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })]); }
export function useSaveConsultationDraft(client: ApiClient = defaultApiClient) { const queryClient = useQueryClient(); return useMutation({ mutationFn: ({ visitId, attempt }: { visitId: string; attempt: SaveDraftAttempt }) => client.command(`/api/visits/${encodeURIComponent(visitId)}/consultation-draft`, attempt, saveConsultationDraftResponseSchema), retry: false, onSuccess: (_data, variables) => invalidate(queryClient, variables.visitId) }); }
export function useFinalizeConsultation(client: ApiClient = defaultApiClient) { const queryClient = useQueryClient(); return useMutation({ mutationFn: ({ visitId, attempt }: { visitId: string; attempt: FinalizeAttempt }) => client.command(`/api/visits/${encodeURIComponent(visitId)}/finalize-consultation`, attempt, finalizeConsultationResponseSchema), retry: false, onSuccess: (_data, variables) => invalidate(queryClient, variables.visitId) }); }
export function useAmendClinicalNote(client: ApiClient = defaultApiClient) { const queryClient = useQueryClient(); return useMutation({ mutationFn: ({ noteId, attempt }: { noteId: string; attempt: CommandAttempt<SignClinicalNoteAmendmentBody["payload"], SignClinicalNoteAmendmentBody["expectedRevisions"]> }) => client.command(`/api/clinical-notes/${encodeURIComponent(noteId)}/amendments`, attempt, clinicalNoteAmendmentResponseSchema), retry: false, onSuccess: (_data, variables) => invalidate(queryClient, variables.noteId) }); }
export function useReviseMedicationDecision(client: ApiClient = defaultApiClient) { const queryClient = useQueryClient(); return useMutation({ mutationFn: ({ visitId, attempt }: { visitId: string; attempt: CommandAttempt<SignMedicationDecisionRevisionBody["payload"], SignMedicationDecisionRevisionBody["expectedRevisions"]> }) => client.command(`/api/visits/${encodeURIComponent(visitId)}/medication-decision-revisions`, attempt, medicationDecisionRevisionResponseSchema), retry: false, onSuccess: (_data, variables) => invalidate(queryClient, variables.visitId) }); }
