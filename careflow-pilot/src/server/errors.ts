import type { ApiErrorCode } from "../shared/contracts.js";

const defaultStatusByCode: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 422,
  AUTH_REQUIRED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  PILOT_ACKNOWLEDGEMENT_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ACTIVE_VISIT_EXISTS: 409,
  SYNTHETIC_ID_EXHAUSTED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;
  readonly fieldErrors?: Record<string, string>;
  readonly currentRevisions?: Record<string, number>;
  readonly retryAfterSeconds?: number;

  constructor(options: {
    code: ApiErrorCode;
    statusCode?: number;
    messageTh: string;
    fieldErrors?: Record<string, string>;
    currentRevisions?: Record<string, number>;
    retryAfterSeconds?: number;
  }) {
    super(options.messageTh);
    this.name = "ApiError";
    this.code = options.code;
    this.statusCode = options.statusCode ?? defaultStatusByCode[options.code];
    this.fieldErrors = options.fieldErrors;
    this.currentRevisions = options.currentRevisions;
    this.retryAfterSeconds =
      options.code === "RATE_LIMITED"
        ? Math.min(300, Math.max(1, options.retryAfterSeconds ?? 60))
        : undefined;
  }
}

export const errorMessages = {
  malformedJson: "รูปแบบ JSON ไม่ถูกต้อง",
  validation: "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่",
  notFound: "ไม่พบข้อมูลที่ร้องขอ",
  internal: "ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง",
} as const;
