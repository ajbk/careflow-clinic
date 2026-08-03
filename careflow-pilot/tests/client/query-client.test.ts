import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "../../src/client/app/query-client";
import { ApiError } from "../../src/client/lib/api-error";

describe("QueryClient retry policy", () => {
  it("does not retry cancelled reads and retries network/5xx reads at most once", () => {
    const client = createAppQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") return;
    expect(retry(0, new DOMException("cancelled", "AbortError"))).toBe(false);
    expect(retry(0, new ApiError({ status: 0, code: "SERVER_UNAVAILABLE", messageTh: "offline" }))).toBe(true);
    expect(retry(1, new ApiError({ status: 503, code: "INTERNAL_ERROR", messageTh: "busy" }))).toBe(false);
    expect(retry(0, new ApiError({ status: 401, code: "AUTH_REQUIRED", messageTh: "login" }))).toBe(false);
    expect(retry(0, new Error("contract failure"))).toBe(false);
    expect(retry(0, new TypeError("client failure"))).toBe(false);
  });
});
