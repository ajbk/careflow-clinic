import type { ZodType } from "zod";
import { ApiError, parseApiErrorResponse, responseContractError, serverUnavailableError } from "./api-error";
import type { CommandAttempt } from "./idempotency";

export interface ApiClientOptions {
  fetchImpl?: typeof fetch;
  fetch?: typeof fetch;
  onUnauthorized?: (error: ApiError) => void;
}

function assertSameOriginPath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new TypeError("API paths must be same-origin relative paths");
  }
}

function retryAfterHeader(response: Response): string | null {
  return response.headers.get("retry-after");
}

export class ApiClient {
  private readonly fetchImpl?: typeof fetch;
  private readonly onUnauthorized?: (error: ApiError) => void;

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

  command<TPayload, TRevisions extends Record<string, number>, TResult>(
    path: string,
    attempt: CommandAttempt<TPayload, TRevisions>,
    schema: ZodType<TResult>,
    signal?: AbortSignal,
  ): Promise<TResult> {
    return this.request(
      "POST",
      path,
      { expectedRevisions: attempt.expectedRevisions, payload: attempt.payload },
      schema,
      signal,
      { "Idempotency-Key": attempt.idempotencyKey },
    );
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
