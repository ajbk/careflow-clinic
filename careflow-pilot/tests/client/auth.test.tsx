import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserActivityAdapter } from "../../src/client/auth/AuthProvider";
import { appRoutes } from "../../src/client/app/router";

function renderApp(path: string, fetchImpl: typeof fetch) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", fetchImpl);
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

const session = {
  data: {
    user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" as const },
    clinic: { id: "clinic", name: "คลินิกทดสอบ" },
    permissions: ["patient:read", "visit:read-queue", "visit:start-consultation" as const],
    pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
    mustChangePassword: false,
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  },
};

const assistantSession = {
  ...session,
  data: {
    ...session.data,
    user: { ...session.data.user, id: "assistant-1", username: "assistant", displayName: "ผู้ช่วยทดสอบ", role: "assistant" as const },
    permissions: ["patient:read", "visit:read-queue", "visit:submit-intake" as const],
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("auth boundary", () => {
  it("redirects an anonymous protected route to login with a safe return target", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ", requestId: "r" } }), {
        status: 401,
      }),
    );
    const { router } = renderApp("/queue", fetchImpl);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?returnTo=%2Fqueue");
    await waitFor(() => expect(screen.getByRole("heading", { name: /เข้าสู่ระบบ/ })).toBeInTheDocument());
  });

  it("shows the named account and permanent banner for an acknowledged session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    renderApp("/queue", fetchImpl);
    await waitFor(() => expect(screen.getByText("พญ. ทดสอบ")).toBeInTheDocument());
    expect(screen.getByText("แพทย์")).toBeInTheDocument();
    expect(screen.getAllByText(/PILOT — ข้อมูลสังเคราะห์เท่านั้น/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /เปลี่ยนเป็น/ })).not.toBeInTheDocument();
  });

  it("records pilot acknowledgement through the typed client before navigating onward", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...session, data: { ...session.data, pilotAcknowledgedAt: null } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }));
    const { router } = renderApp("/pilot-rules?returnTo=%2Fqueue", fetchImpl);
    await waitFor(() => expect(screen.getByRole("heading", { name: /กติกา/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /ยืนยัน/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect(fetchImpl.mock.calls.some(([path]) => path === "/api/auth/acknowledge-pilot")).toBe(true);
  });

  it("keeps Pilot Rules as the only prerequisite screen for unacknowledged sessions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...session,
      data: { ...session.data, pilotAcknowledgedAt: null, mustChangePassword: true },
    }), { status: 200 }));
    renderApp("/change-password?returnTo=%2Fqueue", fetchImpl);
    await waitFor(() => expect(screen.getByRole("heading", { name: /กติกา/ })).toBeInTheDocument());
  });

  it("redirects direct Pilot Rules visits for an already acknowledged account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
    const { router } = renderApp("/pilot-rules?returnTo=%2Fqueue", fetchImpl);
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });

  it("forces an acknowledged temporary-password account to Change Password", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...session,
      data: { ...session.data, mustChangePassword: true },
    }), { status: 200 }));
    const { router } = renderApp("/queue", fetchImpl);
    await waitFor(() => expect(router.state.location.pathname).toBe("/change-password"));
    expect(screen.getByRole("heading", { name: /เปลี่ยนรหัสผ่าน/ })).toBeInTheDocument();
  });

  it("denies Assistant Consultation before requesting clinical data", async () => {
    let workspaceRequests = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/auth/session") return new Response(JSON.stringify(assistantSession), { status: 200 });
      if (path === "/api/visits/visit-1/workspace") {
        workspaceRequests += 1;
        return new Response(JSON.stringify({ error: { code: "FORBIDDEN", messageTh: "ไม่มีสิทธิ์", requestId: "r" } }), { status: 403 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    renderApp("/consultations/visit-1", fetchImpl);
    expect(await screen.findByRole("heading", { name: /ไม่มีสิทธิ์/ })).toBeInTheDocument();
    expect(workspaceRequests).toBe(0);
  });

  it("clears protected cache when the session query itself returns 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ", requestId: "expired" } }), { status: 401 }));
    const { router, client } = renderApp("/queue", fetchImpl);
    await waitFor(() => expect(screen.getByText("พญ. ทดสอบ")).toBeInTheDocument());
    client.setQueryData(["queue"], { data: [{ id: "protected" }] });
    await client.invalidateQueries({ queryKey: ["session"] });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(client.getQueryData(["queue"])).toBeUndefined();
  });

  it("ignores untrusted browser activity events", () => {
    const listener = vi.fn();
    const adapter = createBrowserActivityAdapter(document);
    const unsubscribe = adapter.subscribe(listener);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    document.dispatchEvent(new PointerEvent("pointerdown"));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
