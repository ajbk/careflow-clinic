import { z } from "zod";

const invalidPrototypeKey = Symbol("invalid-prototype-key");

function hasOwnPrototypeKey(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.hasOwnProperty.call(value, "__proto__")) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasOwnPrototypeKey(item, seen));
  const record = value as Record<string, unknown>;
  return Object.keys(record).some((key) => hasOwnPrototypeKey(record[key], seen));
}

function rejectOwnPrototypeKeys<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (hasOwnPrototypeKey(value) ? invalidPrototypeKey : value),
    schema,
  );
}

export interface Actor {
  id: string;
  role: "assistant" | "doctor";
  displayName: string;
}

export const roleSchema = z.enum(["assistant", "doctor"]);
export const permissionSchema = z.enum([
  "patient:read",
  "patient:create-synthetic",
  "visit:submit-intake",
  "visit:read-queue",
  "visit:start-consultation",
]);

export const loginBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const sessionDtoSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1),
    username: z.string().min(1),
    displayName: z.string().min(1),
    role: roleSchema,
  }),
  clinic: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  permissions: z.array(permissionSchema),
  pilotAcknowledgedAt: z.string().datetime().nullable(),
  mustChangePassword: z.boolean(),
  idleExpiresAt: z.string().datetime(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const sessionResponseSchema = z.strictObject({ data: sessionDtoSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const pilotAcknowledgementBodySchema = z.strictObject({ accepted: z.literal(true) });
export type PilotAcknowledgementBody = z.infer<typeof pilotAcknowledgementBodySchema>;

export const changePasswordBodySchema = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const createSyntheticPatientBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({}),
    payload: z.strictObject({}),
  }),
);
export type CreateSyntheticPatientBody = z.infer<typeof createSyntheticPatientBodySchema>;

export const patientSchema = z.strictObject({
  id: z.string().min(1),
  hn: z.string().regex(/^DEMO-[0-9]{6}$/),
  displayName: z.string().min(1),
  phone: z.string().regex(/^000000[0-9]{4}$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["female", "male", "unknown"]),
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(),
});
export type PatientDto = z.infer<typeof patientSchema>;

export const patientCommandResponseSchema = z.strictObject({
  data: patientSchema,
  replayed: z.boolean(),
});
export type PatientCommandResponse = z.infer<typeof patientCommandResponseSchema>;

export const patientSearchQuerySchema = z.strictObject({
  q: z.string()
    .trim()
    .refine(
      (value) => {
        const length = Array.from(value).length;
        return length >= 2 && length <= 80;
      },
      { message: "คำค้นหาต้องมี 2–80 ตัวอักษร" },
    ),
});
export type PatientSearchQuery = z.infer<typeof patientSearchQuerySchema>;

export const patientSearchResponseSchema = z.strictObject({
  data: z.array(patientSchema),
});
export type PatientSearchResponse = z.infer<typeof patientSearchResponseSchema>;

export type Permission = z.infer<typeof permissionSchema>;

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
