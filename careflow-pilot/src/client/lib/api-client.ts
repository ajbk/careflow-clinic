import type { ZodType } from "zod";
import { ApiError, parseApiErrorResponse, responseContractError, serverUnavailableError } from "./api-error";
import { setCommandGeneration, type CommandAttempt } from "./idempotency";
import type { SessionDto } from "../../shared/contracts";
import { operationForPath } from "../../shared/operations";
import { notifyCommandRecovery, operationStatusResponse, pendingOutcomeError, readBreadcrumbs, storeBreadcrumbs, type CommandBreadcrumb } from "./command-recovery";

export interface ApiClientOptions {
  fetchImpl?: typeof fetch;
  fetch?: typeof fetch;
  onUnauthorized?: (error: ApiError) => void;
}

function assertSameOriginPath(path: string): void {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  ) {
    throw new TypeError("API paths must be same-origin relative paths");
  }
}

function retryAfterHeader(response: Response): string | null {
  return response.headers.get("retry-after");
}

export class ApiClient {
  private readonly fetchImpl?: typeof fetch;
  private readonly onUnauthorized?: (error: ApiError) => void;
  private security?: SessionDto["security"];
  private principalId?: string;
  private contextVersion = 0;
  private readonly retries = new Map<string, () => Promise<unknown>>();
  private readonly activeCommands = new Set<string>();

  setSecurity(security: SessionDto["security"], principalId?: string): void {
    if (this.principalId !== principalId || this.security?.generation !== security?.generation) { this.retries.clear(); this.contextVersion++; }
    this.security = security; this.principalId = principalId;
    setCommandGeneration(security?.generation, principalId);
  }

  pendingCommands(): CommandBreadcrumb[] {
    return this.security ? readBreadcrumbs().filter((row) => row.owner === this.principalId && !this.activeCommands.has(row.key)) : [];
  }
  canRetryCommand(key: string): boolean { return this.retries.has(key); }
  async retryCommand(key: string): Promise<void> {
    const retry = this.retries.get(key);
    if (!retry) throw pendingOutcomeError();
    await retry();
  }
  async resolveCommand(key: string, cancel: boolean): Promise<"UNKNOWN" | "COMMITTED" | "CANCELLED"> {
    const contextVersion = this.contextVersion;
    const owner = this.principalId;
    const row = this.pendingCommands().find((item) => item.key === key);
    if (!row) throw pendingOutcomeError();
    const path = `/api/operations/${encodeURIComponent(key)}`;
    const result = cancel
      ? await this.json("POST", `${path}/cancel`, { operation: row.operation, generation: row.generation }, operationStatusResponse)
      : await this.get(`${path}?generation=${encodeURIComponent(row.generation)}`, operationStatusResponse);
    if (this.contextVersion !== contextVersion || result.data.generation !== row.generation) throw pendingOutcomeError();
    if (result.data.status !== "UNKNOWN") this.forgetCommand(key, owner);
    return result.data.status;
  }
  private forgetCommand(key: string, owner = this.principalId): void {
    storeBreadcrumbs(readBreadcrumbs().filter((row) => row.owner !== owner || row.key !== key));
    this.retries.delete(key); notifyCommandRecovery();
  }

  constructor(options: ApiClientOptions | typeof fetch = {}) {
    if (typeof options === "function") {
      this.fetchImpl = options;
      this.onUnauthorized = undefined;
    } else {
      this.fetchImpl = options.fetchImpl ?? options.fetch;
      this.onUnauthorized = options.onUnauthorized;
    }
  }

  get<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.request("GET", path, undefined, schema, signal);
  }

  json<TBody, TResult>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: TBody,
    schema: ZodType<TResult>,
    signal?: AbortSignal,
  ): Promise<TResult> {
    return this.request(method, path, body, schema, signal);
  }

  void<TBody>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: TBody,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.requestVoid(method, path, body, signal);
  }

  async command<TPayload, TRevisions extends Record<string, number>, TResult>(
    path: string,
    attempt: CommandAttempt<TPayload, TRevisions>,
    schema: ZodType<TResult>,
    signal?: AbortSignal,
  ): Promise<TResult> {
    const cloud = this.security;
    const owner = this.principalId;
    const contextVersion = this.contextVersion;
    let wasUnresolved = false;
    if (cloud) {
      if (attempt.owner !== owner) throw new ApiError({ code: "FORBIDDEN", status: 403, messageTh: "บัญชีผู้ใช้งานเปลี่ยนแล้ว กรุณาตรวจสอบข้อมูลใหม่ก่อนสร้างคำสั่ง" });
      if (attempt.generation !== cloud.generation) throw new ApiError({ code: "GENERATION_CHANGED", status: 409, messageTh: "ระบบผ่านการกู้คืนข้อมูล กรุณาตรวจสอบรายการเดิมก่อนสร้างคำสั่งใหม่" });
      const operation = operationForPath(path);
      if (!operation || !this.principalId) throw pendingOutcomeError();
      const rows = readBreadcrumbs();
      wasUnresolved = rows.some((row) => row.owner === this.principalId && row.key === attempt.idempotencyKey);
      if (rows.some((row) => row.owner === this.principalId && row.key !== attempt.idempotencyKey)) throw pendingOutcomeError();
      if (this.activeCommands.has(attempt.idempotencyKey)) throw pendingOutcomeError();
      if (!rows.some((row) => row.owner === this.principalId && row.key === attempt.idempotencyKey)) {
        storeBreadcrumbs([...rows, { key: attempt.idempotencyKey, owner: this.principalId, generation: cloud.generation, operation }]);
      }
      this.retries.set(attempt.idempotencyKey, () => this.command(path, attempt, schema));
      this.activeCommands.add(attempt.idempotencyKey);
    }
    try {
    const result = await this.request(
      "POST",
      path,
      { expectedRevisions: attempt.expectedRevisions, payload: attempt.payload },
      schema,
      signal,
      { "Idempotency-Key": attempt.idempotencyKey, ...(attempt.generation ? { "X-Careflow-Generation": attempt.generation } : {}) },
    );
    if (cloud) {
      if (this.contextVersion !== contextVersion) throw pendingOutcomeError();
      this.forgetCommand(attempt.idempotencyKey, owner);
    }
    return result;
    } catch (error) {
      // A validated business rejection proves no effect for this immutable request.
      if (cloud && this.contextVersion === contextVersion && !wasUnresolved && error instanceof ApiError && [409, 422, 429].includes(error.status) &&
          !["GENERATION_CHANGED", "COMMAND_OUTCOME_UNKNOWN", "RESPONSE_CONTRACT_INVALID"].includes(error.code)) this.forgetCommand(attempt.idempotencyKey, owner);
      throw error;
    } finally {
      this.activeCommands.delete(attempt.idempotencyKey);
      if (cloud) notifyCommandRecovery();
    }
  }

  private getFetch(): typeof fetch {
    return this.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    schema: ZodType<T>,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const response = await this.perform(method, path, body, signal, extraHeaders);
    const text = await this.readText(response);
    if (!response.ok) throw this.errorFromResponse(response, text);
    if (text.trim().length === 0) throw responseContractError(response.status);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw responseContractError(response.status, cause);
    }
    const decoded = schema.safeParse(parsed);
    if (!decoded.success) throw responseContractError(response.status, decoded.error);
    return decoded.data;
  }

  private async requestVoid(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.perform(method, path, body, signal);
    const text = await this.readText(response);
    if (!response.ok) throw this.errorFromResponse(response, text);
    if (response.status !== 204 || text.trim().length > 0) {
      throw responseContractError(response.status);
    }
  }

  private async perform(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    assertSameOriginPath(path);
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (method !== "GET" && this.security) headers["X-CSRF-Token"] = this.security.csrfToken;
    const hasBody = body !== undefined;
    if (hasBody) headers["Content-Type"] = "application/json";
    try {
      return await this.getFetch()(path, {
        method,
        credentials: "include",
        headers,
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      if (typeof cause === "object" && cause !== null && "name" in cause && cause.name === "AbortError") {
        throw cause;
      }
      throw serverUnavailableError(cause);
    }
  }

  private async readText(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (cause) {
      throw responseContractError(response.status, cause);
    }
  }

  private errorFromResponse(response: Response, text: string): ApiError {
    const error = parseApiErrorResponse(response.status, text, retryAfterHeader(response));
    if (error.status === 401) this.onUnauthorized?.(error);
    return error;
  }
}

export const apiClient = new ApiClient();
