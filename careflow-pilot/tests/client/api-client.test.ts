import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/client/lib/api-client";
import { ApiError } from "../../src/client/lib/api-error";
import { createCommandAttempt } from "../../src/client/lib/idempotency";
import { z } from "zod";

const responseSchema = z.object({ data: z.string() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApiClient", () => {
  it("uses same-origin credentials and decodes a valid response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new ApiClient().get("/api/test", responseSchema)).resolves.toEqual({ data: "ok" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("rejects malformed success bodies without returning data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 })));

    await expect(new ApiClient().get("/api/test", responseSchema)).rejects.toMatchObject({
      code: "RESPONSE_CONTRACT_INVALID",
    });
  });

  it("preserves structured API error details and bounded retry metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "REVISION_CONFLICT",
              messageTh: "ข้อมูลเปลี่ยนแปลงแล้ว",
              requestId: "req-1",
              fieldErrors: { name: "ไม่ถูกต้อง" },
              currentRevisions: { patient: 2 },
            },
          }),
          { status: 409, headers: { "retry-after": "9999" } },
        ),
      ),
    );

    const error = await new ApiClient().get("/api/test", responseSchema).catch((value) => value as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "REVISION_CONFLICT",
      messageTh: "ข้อมูลเปลี่ยนแปลงแล้ว",
      requestId: "req-1",
      fieldErrors: { name: "ไม่ถูกต้อง" },
      currentRevisions: { patient: 2 },
      retryAfterSeconds: 300,
    });
  });

  it("maps a rejected fetch to a non-committing server unavailable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(new ApiClient().get("/api/test", responseSchema)).rejects.toMatchObject({
      code: "SERVER_UNAVAILABLE",
      status: 0,
    });
  });

  it("sends an immutable command attempt with one idempotency key", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: "ok" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const attempt = createCommandAttempt({ patient: 1 }, { value: "x" });

    await new ApiClient().command("/api/test", attempt, responseSchema);
    await new ApiClient().command("/api/test", attempt, responseSchema);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/test",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "Idempotency-Key": attempt.idempotencyKey }),
        body: JSON.stringify({ expectedRevisions: { patient: 1 }, payload: { value: "x" } }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body);
  });

  it("requires an empty 204 response for void lifecycle requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new ApiClient().void("POST", "/api/auth/logout")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
  });
});
