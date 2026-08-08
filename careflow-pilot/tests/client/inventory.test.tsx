import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const medications = {
  paracetamol: { id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "เม็ด", canonicalUnit: "เม็ด", revision: 1 },
  amoxicillin: { id: "DEMO-MED-002", displayName: "อะม็อกซีซิลลิน", strengthText: "500 mg", dosageFormText: "แคปซูล", canonicalUnit: "แคปซูล", revision: 2 },
  ors: { id: "DEMO-MED-003", displayName: "ผงเกลือแร่", strengthText: "5.5 g", dosageFormText: "ซอง", canonicalUnit: "ซอง", revision: 1 },
};

const inventory = [
  { medication: medications.paracetamol, onHand: 8, reserved: 0, available: 8, lotCount: 1, nearestExpiry: "2026-10-01", status: "LOW" },
  { medication: medications.amoxicillin, onHand: 0, reserved: 0, available: 0, lotCount: 0, nearestExpiry: null, status: "OUT" },
  { medication: medications.ors, onHand: 12, reserved: 0, available: 12, lotCount: 1, nearestExpiry: "2026-08-04", status: "EXPIRED" },
] as const;

function session(role: "assistant" | "doctor") {
  return {
    data: {
      user: { id: `${role}-1`, username: role, displayName: role === "assistant" ? "ผู้ช่วยทดสอบ" : "พญ. ทดสอบ", role },
      clinic: { id: "clinic", name: "คลินิกทดสอบ" },
      permissions: role === "assistant"
        ? ["patient:read", "visit:read-queue", "visit:submit-intake", "inventory:read", "inventory:receive"]
        : ["patient:read", "visit:read-queue", "visit:start-consultation", "inventory:read"],
      pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

const server = setupServer();

function renderInventory(path: string, role: "assistant" | "doctor" = "assistant") {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role))));
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return router;
}

function errorResponse(code: "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT", messageTh: string) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "request-1" } }, { status: code === "VALIDATION_FAILED" ? 422 : 409 });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => server.resetHandlers(
  http.get("/api/inventory", () => HttpResponse.json({ data: inventory })),
  http.get("/api/inventory/medications", () => HttpResponse.json({ data: [medications.paracetamol] })),
));
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

describe("Inventory screens", () => {
  it("renders API inventory rows, Thai status labels, and a local search result", async () => {
    const user = userEvent.setup();
    renderInventory("/inventory");

    expect((await screen.findAllByText("พาราเซตามอล")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("ใกล้หมด").length).toBeGreaterThan(0);
    expect(screen.getAllByText("หมด").length).toBeGreaterThan(0);
    expect(screen.getAllByText("หมดอายุ").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("searchbox", { name: "ค้นหายา" }), "อะม็อก");
    expect(screen.getByText("อะม็อกซีซิลลิน")).toBeInTheDocument();
    expect(screen.queryByText("พาราเซตามอล")).not.toBeInTheDocument();
  });

  it("shows receipt actions only to an assistant", async () => {
    renderInventory("/inventory", "assistant");
    expect(await screen.findByRole("link", { name: /รับยาเข้าคลัง/ })).toHaveAttribute("href", "/inventory/receive");
    cleanup();
    renderInventory("/inventory", "doctor");
    await screen.findAllByText("พาราเซตามอล");
    expect(screen.queryByRole("link", { name: /รับยาเข้าคลัง|บันทึกรับยาใหม่/ })).not.toBeInTheDocument();
  });

  it.each([
    ["VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูลรับยา"],
    ["IDEMPOTENCY_CONFLICT", "คำขอรับยานี้ขัดแย้งกับรายการเดิม"],
  ] as const)("preserves the receiving draft after %s", async (code, messageTh) => {
    const user = userEvent.setup();
    server.use(http.post("/api/inventory/receipts", () => errorResponse(code, messageTh)));
    renderInventory("/inventory/receive");

    const medicationSearch = await screen.findByRole("combobox", { name: "ค้นหายา" });
    await user.type(medicationSearch, "พารา");
    await user.click(await screen.findByRole("option", { name: /พาราเซตามอล/ }));
    await user.type(screen.getByRole("spinbutton", { name: "จำนวนที่รับ" }), "25");
    await user.type(screen.getByRole("textbox", { name: "เลขที่ล็อต" }), "PCM-2608");
    await user.type(screen.getByRole("textbox", { name: /ผู้ผลิต|ผู้จัดจำหน่าย/ }), "องค์การเภสัชกรรม");
    await user.type(screen.getByLabelText("วันหมดอายุ"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "ยืนยันการรับยา" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messageTh);
    expect(medicationSearch).toHaveValue("พาราเซตามอล");
    expect(screen.getByRole("spinbutton", { name: "จำนวนที่รับ" })).toHaveValue(25);
    expect(screen.getByRole("textbox", { name: "เลขที่ล็อต" })).toHaveValue("PCM-2608");
    expect(screen.getByRole("textbox", { name: /ผู้ผลิต|ผู้จัดจำหน่าย/ })).toHaveValue("องค์การเภสัชกรรม");
    expect(screen.getByLabelText("วันหมดอายุ")).toHaveValue("2026-10-01");
  });
});
