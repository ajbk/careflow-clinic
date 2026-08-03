import { z } from "zod";

const invalidPrototypeKey = Symbol("invalid-prototype-key");

function hasOwnPrototypeKey(value: unknown, seen = new Set<object>()): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (Object.prototype.hasOwnProperty.call(current, "__proto__")) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const key of Object.keys(record)) pending.push(record[key]);
  }
  return false;
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
  "patient:update-allergy",
  "clinical:read",
  "clinical:save-draft",
  "clinical:sign",
  "clinical:amend",
  "medication:read-catalog",
  "medication:sign-decision",
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

export const visitStatuses = [
  "WAITING",
  "CONSULTING",
  "AWAITING_PREPARATION",
  "PREPARING",
  "AWAITING_RELEASE",
  "AWAITING_HANDOFF",
  "AWAITING_ORDER_REVISION",
  "AWAITING_CHARGE",
  "AWAITING_PAYMENT",
  "READY_TO_CLOSE",
  "CLOSED",
] as const;

export const visitStatusSchema = z.enum(visitStatuses);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

export const allergyStateSchema = z.enum(["UNKNOWN", "NONE_KNOWN", "PRESENT"]);
export const allergySeveritySchema = z.enum(["UNKNOWN", "MILD", "MODERATE", "SEVERE"]);
export const medicationDecisionDraftKindSchema = z.enum(["UNDECIDED", "ORDER", "NO_MEDICATION"]);
export const medicationDecisionKindSchema = z.enum(["ORDER", "NO_MEDICATION"]);
export type AllergySeverity = z.infer<typeof allergySeveritySchema>;

const intakeVitalsSchema = z.strictObject({
  weightKg: z.number().finite().min(1).max(350).nullable(),
  heightCm: z.number().finite().min(30).max(250).nullable(),
  temperatureC: z.number().finite().min(30).max(45).nullable(),
  systolicMmhg: z.number().finite().int().min(50).max(260).nullable(),
  diastolicMmhg: z.number().finite().int().min(30).max(180).nullable(),
  heartRateBpm: z.number().finite().int().min(20).max(250).nullable(),
  spo2Percent: z.number().finite().int().min(50).max(100).nullable(),
});

const intakeVitalsWithRelationshipSchema = intakeVitalsSchema.superRefine((vitals, context) => {
  if (
    vitals.systolicMmhg !== null &&
    vitals.diastolicMmhg !== null &&
    vitals.systolicMmhg < vitals.diastolicMmhg
  ) {
    context.addIssue({
      code: "custom",
      path: ["systolicMmhg"],
      message: "ค่าความดันตัวบนต้องไม่น้อยกว่าค่าความดันตัวล่าง",
    });
  }
});

export const intakePayloadSchema = rejectOwnPrototypeKeys(
  z.strictObject({
    patientId: z.string().trim().min(1).max(120),
    chiefComplaint: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 500, {
        message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
      }),
    vitals: intakeVitalsWithRelationshipSchema,
  }),
);
export type IntakePayload = z.infer<typeof intakePayloadSchema>;

export const submitIntakeBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ patient: z.number().int().min(1) }),
    payload: intakePayloadSchema,
  }),
);
export type SubmitIntakeBody = z.infer<typeof submitIntakeBodySchema>;

const queueVisitSchema = z.strictObject({
  id: z.string().min(1),
  status: z.enum(["WAITING", "CONSULTING"]),
  revision: z.number().int().min(1),
  arrivedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
});

const queuePatientSchema = patientSchema.pick({
  id: true,
  hn: true,
  displayName: true,
  birthDate: true,
  sex: true,
});

export const queueItemSchema = z.strictObject({
  visit: queueVisitSchema,
  patient: queuePatientSchema,
  chiefComplaint: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= 500, {
      message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
    }),
  vitals: intakeVitalsSchema,
  allowedActions: z.array(z.literal("START_CONSULTATION")),
});
export type QueueItemDto = z.infer<typeof queueItemSchema>;

export const queueResponseSchema = z.strictObject({
  data: z.array(queueItemSchema),
});
export type QueueResponse = z.infer<typeof queueResponseSchema>;

export const dashboardTodayResponseSchema = z.strictObject({
  data: z.strictObject({
    waiting: z.number().int().min(0),
    consulting: z.number().int().min(0),
    updatedAt: z.string().datetime(),
  }),
});
export type DashboardTodayResponse = z.infer<typeof dashboardTodayResponseSchema>;

export const visitWorkspaceSchema = z.strictObject({
  visit: queueVisitSchema,
  patient: patientSchema,
  intake: z.strictObject({
    id: z.string().min(1),
    chiefComplaint: z
      .string()
      .min(1)
      .refine((value) => Array.from(value).length <= 500, {
        message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
      }),
    vitals: intakeVitalsSchema,
    recordedAt: z.string().datetime(),
    recordedBy: z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) }),
  }),
  allowedActions: z.array(z.literal("START_CONSULTATION")),
});
export type VisitWorkspaceDto = z.infer<typeof visitWorkspaceSchema>;

export const startConsultationBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ visit: z.number().int().min(1) }),
    payload: z.strictObject({}),
  }),
);
export type StartConsultationBody = z.infer<typeof startConsultationBodySchema>;

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
