import { apiErrorBodySchema, type ApiErrorCode } from "../../shared/contracts";

export type ClientApiErrorCode = "RESPONSE_CONTRACT_INVALID" | "SERVER_UNAVAILABLE";
export type ClientErrorCode = ApiErrorCode | ClientApiErrorCode;

export interface ApiErrorOptions {
  status: number;
  code: ClientErrorCode;
  messageTh: string;
  requestId?: string;
  fieldErrors?: Record<string, string>;
  currentRevisions?: Record<string, number>;
  retryAfterSeconds?: number;
  cause?: unknown;
}

/** A stable, safe error boundary for all browser API requests. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly code: ClientErrorCode;
  readonly messageTh: string;
  readonly requestId?: string;
  readonly fieldErrors?: Record<string, string>;
  readonly currentRevisions?: Record<string, number>;
  readonly retryAfterSeconds?: number;

  constructor(options: ApiErrorOptions) {
    super(options.messageTh, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.status = options.status;
    this.statusCode = options.status;
    this.code = options.code;
    this.messageTh = options.messageTh;
    this.requestId = options.requestId;
    this.fieldErrors = options.fieldErrors;
    this.currentRevisions = options.currentRevisions;
    this.retryAfterSeconds =
      options.retryAfterSeconds === undefined
        ? undefined
        : Math.min(300, Math.max(1, Math.floor(options.retryAfterSeconds)));
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function responseContractError(status: number, cause?: unknown): ApiError {
  return new ApiError({
    status,
    code: "RESPONSE_CONTRACT_INVALID",
    messageTh: "ข้อมูลตอบกลับจากระบบไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
    cause,
  });
}

export function serverUnavailableError(cause?: unknown): ApiError {
  return new ApiError({
    status: 0,
    code: "SERVER_UNAVAILABLE",
    messageTh: "ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่",
    cause,
  });
}

export function parseApiErrorResponse(
  status: number,
  text: string,
  retryAfterHeader?: string | null,
): ApiError {
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? undefined : JSON.parse(text);
  } catch (cause) {
    return responseContractError(status, cause);
  }

  const result = apiErrorBodySchema.safeParse(parsed);
  if (!result.success) return responseContractError(status, result.error);

  const retryAfterSeconds = retryAfterHeader === undefined || retryAfterHeader === null
    ? undefined
    : Number.parseInt(retryAfterHeader, 10);
  return new ApiError({
    status,
    code: result.data.error.code,
    messageTh: result.data.error.messageTh,
    requestId: result.data.error.requestId,
    fieldErrors: result.data.error.fieldErrors,
    currentRevisions: result.data.error.currentRevisions,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
  });
}
