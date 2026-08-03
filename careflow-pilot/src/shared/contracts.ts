import { z } from "zod";

export interface Actor {
  id: string;
  role: "assistant" | "doctor";
  displayName: string;
}

export type Permission =
  | "patient:read"
  | "patient:create-synthetic"
  | "visit:submit-intake"
  | "visit:read-queue"
  | "visit:start-consultation";

export interface IdempotentEnvelope<T> {
  data: T;
  replayed: boolean;
}

export interface CommandWorkResult<T> {
  statusCode: number;
  data: T;
}

export interface CommandHttpResult<T> {
  statusCode: number;
  body: IdempotentEnvelope<T>;
}

export interface CommandBody<TPayload, TRevisions extends Record<string, number>> {
  expectedRevisions: TRevisions;
  payload: TPayload;
}

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "PASSWORD_CHANGE_REQUIRED",
  "PILOT_ACKNOWLEDGEMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ACTIVE_VISIT_EXISTS",
  "SYNTHETIC_ID_EXHAUSTED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const apiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    messageTh: z.string(),
    requestId: z.string().min(1),
    fieldErrors: z.record(z.string(), z.string()).optional(),
    currentRevisions: z.record(z.string(), z.number().int()).optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
