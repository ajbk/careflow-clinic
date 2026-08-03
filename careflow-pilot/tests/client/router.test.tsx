import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

describe("pilot router", () => {
  it("renders the Thai pilot shell without the prototype role switch", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" },
        clinic: { id: "clinic", name: "คลินิกทดสอบ" },
        permissions: ["patient:read", "visit:read-queue", "visit:start-consultation"],
        pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
        mustChangePassword: false,
        idleExpiresAt: "2026-08-03T08:00:00.000Z",
      },
    }), { status: 200 })));
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    return waitFor(() => {
      expect(screen.getByText("CareFlow")).toBeInTheDocument();
      expect(screen.getAllByText(/PILOT — ข้อมูลสังเคราะห์เท่านั้น/).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /เปลี่ยนเป็นแพทย์|เปลี่ยนเป็นผู้ช่วย/ })).not.toBeInTheDocument();
    });
  });

  it("redirects an anonymous queue visit to login with a local return target", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "AUTH_REQUIRED", messageTh: "กรุณาเข้าสู่ระบบ", requestId: "request-1" },
    }), { status: 401 })));
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/queue"] });
    render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    await vi.waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?returnTo=%2Fqueue");
  });
});

afterEach(() => vi.restoreAllMocks());
