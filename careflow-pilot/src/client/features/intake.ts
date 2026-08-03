import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  IntakePayload,
  PatientDto,
  QueueItemDto,
  SubmitIntakeBody,
} from "../../shared/contracts";
import { queueItemSchema } from "../../shared/contracts";
import { z } from "zod";
import { queryKeys } from "../app/query-client";
import { ApiClient, apiClient as defaultApiClient } from "../lib/api-client";
import { createCommandAttempt, type CommandAttempt } from "../lib/idempotency";

export type IntakeDraft = {
  chiefComplaint: string;
  weightKg: string;
  heightCm: string;
  temperatureC: string;
  systolicMmhg: string;
  diastolicMmhg: string;
  heartRateBpm: string;
  spo2Percent: string;
};

export type IntakeAttempt = CommandAttempt<IntakePayload, { patient: number }>;

export const initialIntakeDraft: IntakeDraft = {
  chiefComplaint: "",
  weightKg: "",
  heightCm: "",
  temperatureC: "",
  systolicMmhg: "",
  diastolicMmhg: "",
  heartRateBpm: "",
  spo2Percent: "",
};

export const vitalFields = [
  { key: "temperatureC", label: "อุณหภูมิ", placeholder: "°C", step: "0.1" },
  { key: "systolicMmhg", label: "ความดันตัวบน", placeholder: "mmHg", step: "1" },
  { key: "diastolicMmhg", label: "ความดันตัวล่าง", placeholder: "mmHg", step: "1" },
  { key: "heartRateBpm", label: "ชีพจร", placeholder: "ครั้ง/นาที", step: "1" },
  { key: "spo2Percent", label: "ออกซิเจนปลายนิ้ว", placeholder: "%", step: "1" },
  { key: "weightKg", label: "น้ำหนัก", placeholder: "กก.", step: "0.1" },
  { key: "heightCm", label: "ส่วนสูง", placeholder: "ซม.", step: "1" },
] as const;

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

export function intakePayloadFromDraft(patientId: string, draft: IntakeDraft): IntakePayload {
  return {
    patientId,
    chiefComplaint: draft.chiefComplaint.trim(),
    vitals: {
      weightKg: nullableNumber(draft.weightKg),
      heightCm: nullableNumber(draft.heightCm),
      temperatureC: nullableNumber(draft.temperatureC),
      systolicMmhg: nullableNumber(draft.systolicMmhg),
      diastolicMmhg: nullableNumber(draft.diastolicMmhg),
      heartRateBpm: nullableNumber(draft.heartRateBpm),
      spo2Percent: nullableNumber(draft.spo2Percent),
    },
  };
}

export function createIntakeAttempt(patient: PatientDto, draft: IntakeDraft): IntakeAttempt {
  return createCommandAttempt(
    { patient: patient.revision },
    intakePayloadFromDraft(patient.id, draft),
  );
}

export async function submitIntake(
  client: ApiClient,
  attempt: IntakeAttempt,
  signal?: AbortSignal,
): Promise<QueueItemDto> {
  const response = await client.command<SubmitIntakeBody["payload"], { patient: number }, IntakeCommandResponse>(
    "/api/visits/intake",
    attempt,
    intakeCommandResponseSchema,
    signal,
  );
  return response.data;
}

const intakeCommandResponseSchema = z.strictObject({
  data: queueItemSchema,
  replayed: z.boolean(),
});
type IntakeCommandResponse = z.infer<typeof intakeCommandResponseSchema>;

/** Mutation wrapper keeps the server response authoritative and refreshes read models. */
export function useSubmitIntake(client: ApiClient = defaultApiClient) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attempt: IntakeAttempt) => submitIntake(client, attempt),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: ["patients"] }),
      ]);
    },
  });
}
