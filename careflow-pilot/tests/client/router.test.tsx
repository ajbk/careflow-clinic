import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

function completeSession(role: "assistant" | "doctor") {
  return {
    data: {
      user: {
        id: `${role}-1`,
        username: role,
        displayName: role === "doctor" ? "พญ. ทดสอบ" : "ผู้ช่วยทดสอบ",
        role,
      },
      clinic: { id: "clinic", name: "คลินิกทดสอบ" },
      permissions: role === "doctor"
        ? ["patient:read", "visit:read-queue", "visit:start-consultation", "inventory:read"]
        : ["patient:read", "visit:read-queue", "visit:submit-intake", "inventory:read", "inventory:receive"],
      pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function renderRoleApp(path: string, role: "assistant" | "doctor") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const requestPath = String(input);
    if (requestPath === "/api/auth/session") return new Response(JSON.stringify(completeSession(role)), { status: 200 });
    if (requestPath === "/api/queue") return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (requestPath === "/api/dashboard/today") {
      return new Response(JSON.stringify({ data: { waiting: 0, consulting: 0, awaitingOrderRevision: 0, awaitingPreparation: 0, awaitingCharge: 0, updatedAt: "2026-08-03T01:00:00.000Z" } }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${requestPath}`);
  }));
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return { router };
}

describe("pilot router", () => {
  it("renders the Thai pilot shell without the prototype role switch", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" },
        clinic: { id: "clinic", name: "คลินิกทดสอบ" },
        permissions: ["patient:read", "visit:read-queue", "visit:start-consultation"],
        pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
        mustChangePassword: false,
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    }), { status: 200 })));
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    return waitFor(() => {
      expect(screen.getByText("CareFlow")).toBeInTheDocument();
      expect(screen.getAllByText(/PILOT — ข้อมูลสังเคราะห์เท่านั้น/).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /เปลี่ยนเป็นแพทย์|เปลี่ยนเป็นผู้ช่วย/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /ห้องตรวจ/ })).not.toBeInTheDocument();
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

  it.each([
    ["assistant", "/intake"],
    ["doctor", "/queue"],
  ] as const)("lands %s on %s", async (role, expectedPath) => {
    const { router } = renderRoleApp("/", role);
    await waitFor(() => expect(router.state.location.pathname).toBe(expectedPath));
  });

  it("shows Assistant operational navigation in job order", async () => {
    renderRoleApp("/queue", "assistant");
    const navigation = await screen.findByRole("navigation", { name: "เมนูหลัก" });
      expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/intake", "/queue", "/inventory", "/overview"]);
  });

  it("shows only Doctor primary jobs in Doctor navigation", async () => {
    renderRoleApp("/queue", "doctor");
    const navigation = await screen.findByRole("navigation", { name: "เมนูหลัก" });
      expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href")))
      .toEqual(["/queue", "/inventory", "/overview"]);
  });

  it.each([
    ["/queue", "assistant", "ASSISTANT WORKSPACE / งานผู้ช่วย", "DOCTOR WORKSPACE / งานแพทย์"],
    ["/overview", "assistant", "ASSISTANT WORKSPACE / งานผู้ช่วย", "DOCTOR WORKSPACE / งานแพทย์"],
    ["/queue", "doctor", "DOCTOR WORKSPACE / งานแพทย์", "ASSISTANT WORKSPACE / งานผู้ช่วย"],
    ["/overview", "doctor", "DOCTOR WORKSPACE / งานแพทย์", "ASSISTANT WORKSPACE / งานผู้ช่วย"],
  ] as const)("exposes the mapped bilingual identity on %s for %s", async (path, role, expectedIdentity, otherIdentity) => {
    renderRoleApp(path, role);
    expect(await screen.findAllByText(expectedIdentity)).toHaveLength(2);
    expect(screen.queryByText(otherIdentity)).not.toBeInTheDocument();
  });

  it.each([
    ["assistant", "รับผู้ป่วย", "/intake"],
    ["doctor", "ไปยังคิวตรวจ", "/queue"],
  ] as const)("shows all five pending-work counts with the %s primary action", async (role, action, path) => {
    renderRoleApp("/overview", role);
    expect(await screen.findByText("รอพบแพทย์")).toBeInTheDocument();
    expect(screen.getByText("กำลังตรวจ")).toBeInTheDocument();
    expect(screen.getByText("รอทบทวนคำสั่งยา")).toBeInTheDocument();
    expect(screen.getByText("รอจัดยา")).toBeInTheDocument();
    expect(screen.getByText("รอคิดเงิน")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: action })).toHaveAttribute("href", path);
    expect(screen.queryByText(/฿|บาท|คงเหลือ|แนวโน้ม|รายเดือน/)).not.toBeInTheDocument();
  });

  it("gives Intake one focused job without global navigation", async () => {
    renderRoleApp("/intake", "assistant");
    expect(await screen.findByRole("heading", { name: "ลงทะเบียนผู้ป่วยและซักประวัติ" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "เมนูหลัก" })).not.toBeInTheDocument();
    expect(screen.getByText("ASSISTANT WORKSPACE / งานผู้ช่วย")).toBeInTheDocument();
  });

  it("normalizes trailing-slash Intake into the focused Assistant workspace", async () => {
    renderRoleApp("/intake/", "assistant");
    expect(await screen.findByRole("heading", { name: "ลงทะเบียนผู้ป่วยและซักประวัติ" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "เมนูหลัก" })).not.toBeInTheDocument();
    expect(screen.getByText("ASSISTANT WORKSPACE / งานผู้ช่วย")).toBeInTheDocument();
  });

  it("denies an Assistant consultation route before requesting clinical workspace or catalog", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input); requests.push(path);
      if (path === "/api/auth/session") return new Response(JSON.stringify(completeSession("assistant")), { status: 200 });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/consultations/visit-42"] });
    render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    expect(await screen.findByText("ไม่มีสิทธิ์ใช้งาน")).toBeInTheDocument();
    expect(requests).toEqual(["/api/auth/session"]);
  });

  it.each([
    ["doctor", "/inventory", "คลังยา"],
    ["assistant", "/inventory", "คลังยา"],
    ["assistant", "/inventory/receive", "รับยาเข้าคลัง"],
  ] as const)("allows %s to enter %s", async (role, path, heading) => {
    renderRoleApp(path, role);
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("denies a doctor the receiving screen before requesting its medication search", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input); requests.push(path);
      if (path === "/api/auth/session") return new Response(JSON.stringify(completeSession("doctor")), { status: 200 });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/inventory/receive"] });
    render(<AppProviders><RouterProvider router={router} /></AppProviders>);
    expect(await screen.findByText("ไม่มีสิทธิ์ใช้งาน")).toBeInTheDocument();
    expect(requests).toEqual(["/api/auth/session"]);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
