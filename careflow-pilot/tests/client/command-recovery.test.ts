import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiClient } from "../../src/client/lib/api-client";
import { createCommandAttempt } from "../../src/client/lib/idempotency";

const schema = z.object({ data: z.object({ recorded: z.boolean() }) });
const security = { csrfToken: "a".repeat(64), generation: "generation-before-restore" };
afterEach(() => { sessionStorage.clear(); new ApiClient().setSecurity(undefined); vi.restoreAllMocks(); });

describe("cloud command recovery", () => {
  it.each(["command", "rejection", "status", "cancel"])("retains an old breadcrumb when a delayed %s reply arrives after generation change", async (phase) => {
    const isCommand = phase === "command" || phase === "rejection";
    let deliver!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => { deliver = resolve; });
    const fetcher = vi.fn();
    if (!isCommand) fetcher.mockRejectedValueOnce(new TypeError("lost"));
    fetcher.mockReturnValue(delayed);
    const client = new ApiClient(fetcher);
    client.setSecurity(security, "opaque-account-1");
    const attempt = createCommandAttempt({}, {});
    if (!isCommand) await expect(client.command("/api/inventory/receipts", attempt, schema)).rejects.toThrow();
    const result = isCommand ? client.command("/api/inventory/receipts", attempt, schema) : client.resolveCommand(attempt.idempotencyKey, phase === "cancel");
    client.setSecurity({ ...security, generation: "restored-generation" }, "opaque-account-1");
    deliver(phase === "rejection" ? new Response(JSON.stringify({ error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูลเปลี่ยนแล้ว" } }), { status: 409 }) : new Response(JSON.stringify({ data: phase === "command" ? { recorded: true } : { status: phase === "cancel" ? "CANCELLED" : "COMMITTED", generation: security.generation } }), { status: 200 }));
    await expect(result).rejects.toThrow();
    expect(client.pendingCommands()).toMatchObject([{ key: attempt.idempotencyKey, generation: security.generation }]);
  });
  it("permits resolving a source-generation cancellation while the recovered session stays unchanged", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "CANCELLED", generation: security.generation } }), { status: 200 }));
    const client = new ApiClient(fetcher); client.setSecurity(security, "opaque-account-1");
    const attempt = createCommandAttempt({}, {});
    await expect(client.command("/api/inventory/receipts", attempt, schema)).rejects.toThrow();
    client.setSecurity({ ...security, generation: "restored-generation" }, "opaque-account-1");
    expect(await client.resolveCommand(attempt.idempotencyKey, true)).toBe("CANCELLED");
    expect(client.pendingCommands()).toEqual([]);
  });
  it("keeps only an opaque breadcrumb after a lost reply, blocks a new intent and survives reload", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("connection lost"));
    const client = new ApiClient(fetcher);
    client.setSecurity(security, "opaque-account-1");
    const attempt = createCommandAttempt({ visit: 4 }, { privateClinical: "never persist this" });
    await expect(client.command("/api/checkout/opaque-visit/payments/cash", attempt, schema)).rejects.toThrow();
    expect(client.pendingCommands()).toHaveLength(1);
    const stored = JSON.stringify(sessionStorage);
    expect(stored).not.toContain("privateClinical");
    expect(stored).not.toContain("opaque-visit");
    expect(stored).not.toContain(security.csrfToken);
    await expect(client.command("/api/checkout/opaque-visit/payments/cash", createCommandAttempt({ visit: 4 }, {}), schema)).rejects.toMatchObject({ code: "COMMAND_OUTCOME_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const reloaded = new ApiClient(fetcher);
    reloaded.setSecurity(security, "opaque-account-1");
    expect(reloaded.pendingCommands()[0]?.key).toBe(attempt.idempotencyKey);
    expect(reloaded.canRetryCommand(attempt.idempotencyKey)).toBe(false);
  });
  it("explicitly retries the identical payload/key and never rebases an old attempt after restore", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValue(new Response(JSON.stringify({ data: { recorded: true } }), { status: 200 }));
    const client = new ApiClient(fetcher);
    client.setSecurity(security, "opaque-account-1");
    const attempt = createCommandAttempt({ visit: 4 }, { paidBaht: 100 });
    await expect(client.command("/api/checkout/id/payments/cash", attempt, schema)).rejects.toThrow();
    await client.retryCommand(attempt.idempotencyKey);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual(fetcher.mock.calls[1]?.[1]?.headers);
    expect(client.pendingCommands()).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    client.setSecurity({ ...security, generation: "after-restore" }, "opaque-account-1");
    await expect(client.command("/api/checkout/id/payments/cash", attempt, schema)).rejects.toMatchObject({ code: "GENERATION_CHANGED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never reissues the same attempt as another actor after a shared-cookie account switch", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost committed response"))
      .mockResolvedValue(new Response(JSON.stringify({ data: { recorded: true } }), { status: 201 }));
    const client = new ApiClient(fetcher);
    client.setSecurity(security, "assistant-original");
    const attempt = createCommandAttempt({}, { quantity: 10 });
    await expect(client.command("/api/inventory/receipts", attempt, schema)).rejects.toThrow();
    client.setSecurity(security, "doctor-new");
    await expect(client.command("/api/inventory/receipts", attempt, schema)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    client.setSecurity(security, "assistant-original");
    expect(client.pendingCommands()).toHaveLength(1);
  });
  it("retains UNKNOWN until server fencing or commit evidence, with no automatic retry", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "UNKNOWN", generation: security.generation } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { status: "CANCELLED", generation: security.generation } }), { status: 200 }));
    const client = new ApiClient(fetcher);
    client.setSecurity(security, "opaque-account-1");
    const attempt = createCommandAttempt({}, {});
    await expect(client.command("/api/inventory/receipts", attempt, schema)).rejects.toThrow();
    expect(await client.resolveCommand(attempt.idempotencyKey, false)).toBe("UNKNOWN");
    expect(client.pendingCommands()).toHaveLength(1);
    expect(await client.resolveCommand(attempt.idempotencyKey, true)).toBe("CANCELLED");
    expect(client.pendingCommands()).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
