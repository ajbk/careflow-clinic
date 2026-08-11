import { describe, expect, it } from "vitest";
import { createAppQueryClient, queryKeys } from "../../src/client/app/query-client";
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
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("has an isolated Checkout key so committed finance commands can invalidate only their Visit", () => {
    const keys = queryKeys as Record<string, unknown>;
    expect(keys.checkout).toBeTypeOf("function");
    const checkout = keys.checkout as ((visitId: string) => readonly string[]) | undefined;
    expect(checkout?.("visit-42")).toEqual(["checkout", "visit-42"]);
    expect(checkout?.("visit-43")).not.toEqual(checkout?.("visit-42"));
  });

  it("has an isolated Patient Allergy context key", () => {
    const keys = queryKeys as Record<string, unknown>;
    expect(keys.patientAllergy).toBeTypeOf("function");
    const patientAllergy = keys.patientAllergy as ((patientId: string) => readonly string[]) | undefined;
    expect(patientAllergy?.("patient-42")).toEqual(["patient-allergy", "patient-42"]);
    expect(patientAllergy?.("patient-43")).not.toEqual(patientAllergy?.("patient-42"));
  });
});
