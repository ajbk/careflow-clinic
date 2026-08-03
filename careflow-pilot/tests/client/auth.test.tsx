import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  return router;
}

const session = {
  data: {
    user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" as const },
    clinic: { id: "clinic", name: "คลินิกทดสอบ" },
    permissions: ["patient:read", "visit:read-queue", "visit:start-consultation" as const],
    pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
    mustChangePassword: false,
    idleExpiresAt: "2026-08-03T08:00:00.000Z",
  },
};

afterEach(() => vi.restoreAllMocks());

describe("auth boundary", () => {
  it("redirects an anonymous protected route to login with a safe return target", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ", requestId: "r" } }), {
        status: 401,
      }),
    );
    const router = renderApp("/queue", fetchImpl);
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
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const router = renderApp("/pilot-rules?returnTo=%2Fqueue", fetchImpl);
    await waitFor(() => expect(screen.getByRole("heading", { name: /กติกา/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /ยืนยัน/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect(fetchImpl).toHaveBeenLastCalledWith("/api/auth/acknowledge-pilot", expect.objectContaining({ credentials: "include" }));
  });
});
