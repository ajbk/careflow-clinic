import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { queryKeys } from "../../src/client/app/query-client";
import { appRoutes } from "../../src/client/app/router";

const medications = {
  paracetamol: { id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "เม็ด", canonicalUnit: "เม็ด", internalBarcode: "PARA-500", revision: 1 },
  amoxicillin: { id: "DEMO-MED-002", displayName: "อะม็อกซีซิลลิน", strengthText: "500 mg", dosageFormText: "แคปซูล", canonicalUnit: "แคปซูล", internalBarcode: "AMOX-500", revision: 2 },
  ors: { id: "DEMO-MED-003", displayName: "ผงเกลือแร่", strengthText: "5.5 g", dosageFormText: "ซอง", canonicalUnit: "ซอง", internalBarcode: "ORS-5500", revision: 1 },
  reserved: { id: "DEMO-MED-004", displayName: "ยาที่ถูกจอง", strengthText: "250 mg", dosageFormText: "เม็ด", canonicalUnit: "เม็ด", internalBarcode: "RESERVED-250", revision: 1 },
};

const inventory = [
  { medication: medications.paracetamol, onHand: 8, reserved: 0, available: 8, lotCount: 1, nearestExpiry: "2026-10-01", status: "LOW" },
  { medication: medications.amoxicillin, onHand: 0, reserved: 0, available: 0, lotCount: 0, nearestExpiry: null, status: "OUT" },
  { medication: medications.ors, onHand: 12, reserved: 0, available: 12, lotCount: 1, nearestExpiry: "2026-08-04", status: "EXPIRED" },
  { medication: medications.reserved, onHand: 12, reserved: 12, available: 0, lotCount: 1, nearestExpiry: "2026-08-20", status: "RESERVED" },
] as const;

function session(role: "assistant" | "doctor", additionalPermissions: readonly string[] = []) {
  const inventoryPermissions = role === "assistant"
    ? ["patient:read", "visit:read-queue", "visit:submit-intake", "inventory:read", "inventory:receive", "inventory:quarantine"]
    : ["patient:read", "visit:read-queue", "visit:start-consultation", "inventory:read", "inventory:receive", "inventory:quarantine", "inventory:release-quarantine", "inventory:adjust"];
  return {
    data: {
      user: { id: `${role}-1`, username: role, displayName: role === "assistant" ? "ผู้ช่วยทดสอบ" : "พญ. ทดสอบ", role },
      clinic: { id: "clinic", name: "คลินิกทดสอบ" },
      permissions: [...inventoryPermissions, ...additionalPermissions],
      pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

const server = setupServer();

function renderInventory(
  path: string,
  role: "assistant" | "doctor" = "assistant",
  additionalPermissions: readonly string[] = [],
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role, additionalPermissions))));
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, queryClient };
}

function errorResponse(code: "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT", messageTh: string) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "request-1" } }, { status: code === "VALIDATION_FAILED" ? 422 : 409 });
}

const receivedInventory = {
  id: "receipt-001",
  supplierName: "องค์การเภสัชกรรม",
  note: "",
  receivedAt: "2026-08-12T00:00:00.000Z",
  receivedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
  medication: medications.paracetamol,
  lot: {
    id: "lot-new", medicationId: "DEMO-MED-001", medicationRevision: 1, revision: 1,
    displayNameSnapshot: "พาราเซตามอล", strengthSnapshot: "500 mg", dosageFormSnapshot: "เม็ด", unitSnapshot: "เม็ด",
    lotNumber: "PCM-2608", expiryDate: "2026-12-31", supplierName: "องค์การเภสัชกรรม", status: "AVAILABLE" as const,
    createdAt: "2026-08-12T00:00:00.000Z", createdBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
  },
  quantity: 25,
  unit: "เม็ด",
  inventory: { ...inventory[0], onHand: 33, available: 33, lotCount: 2 },
};

const recoveredJourney = {
  visit: { id: "visit-1", status: "AWAITING_PREPARATION" as const, revision: 9 },
  refreshedAt: "2026-08-12T00:00:00.000Z",
  steps: [
    { code: "INTAKE", labelTh: "รับผู้ป่วย", state: "COMPLETE" as const },
    { code: "SCREENING", labelTh: "คัดกรอง", state: "COMPLETE" as const },
    { code: "CONSULTATION", labelTh: "ตรวจรักษา", state: "COMPLETE" as const },
    { code: "MEDICATION_DECISION", labelTh: "ตัดสินใจเรื่องยา", state: "COMPLETE" as const },
    { code: "PREPARATION", labelTh: "เตรียมยา", state: "CURRENT" as const },
    { code: "HANDOFF", labelTh: "ส่งมอบยา", state: "UPCOMING" as const },
    { code: "PAYMENT", labelTh: "ชำระเงิน", state: "UPCOMING" as const },
    { code: "CLOSURE", labelTh: "ปิด Visit", state: "UPCOMING" as const },
  ],
  nextTask: null,
  blockers: [],
  allowedActions: [],
};

function tomorrowInBangkok(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(tomorrow);
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => server.resetHandlers(
  http.get("/api/inventory", () => HttpResponse.json({ data: inventory })),
  http.get("/api/inventory/medications", () => HttpResponse.json({ data: [medications.paracetamol] })),
  http.get("/api/inventory/medications/DEMO-MED-001/lots", () => HttpResponse.json({ data: [{
    id: "lot-001", medicationId: "DEMO-MED-001", medicationRevision: 1, revision: 3,
    displayNameSnapshot: "พาราเซตามอล", strengthSnapshot: "500 mg", dosageFormSnapshot: "เม็ด", unitSnapshot: "เม็ด",
    lotNumber: "LOT-001", expiryDate: "2026-10-01", supplierName: "ผู้จำหน่าย", status: "AVAILABLE",
    createdAt: "2026-08-03T00:00:00.000Z", createdBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
    onHand: 8, reserved: 0, available: 8, latestMovementId: "movement-001",
    recentMovements: [{ id: "movement-001", lotId: "lot-001", movementType: "RECEIPT", quantityDelta: 8, sourceType: "RECEIPT", sourceId: "receipt-001", occurredAt: "2026-08-03T00:00:00.000Z" }],
  }] })),
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
    expect(screen.getAllByText("ถูกจอง").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("searchbox", { name: "ค้นหายา" }), "อะม็อก");
    expect(screen.getByText("อะม็อกซีซิลลิน")).toBeInTheDocument();
    expect(screen.queryByText("พาราเซตามอล")).not.toBeInTheDocument();
  });

  it("shows receipt actions to both Assistant and Doctor inventory operators", async () => {
    renderInventory("/inventory", "assistant");
    expect(await screen.findByRole("link", { name: /รับยาเข้าคลัง/ })).toHaveAttribute("href", "/inventory/receive");
    cleanup();
    renderInventory("/inventory", "doctor");
    await screen.findAllByText("พาราเซตามอล");
    expect(await screen.findByRole("link", { name: /รับยาเข้าคลัง/ })).toHaveAttribute("href", "/inventory/receive");
  });

  it("shows role-specific lot safety controls after selecting an inventory row", async () => {
    const user = userEvent.setup();
    renderInventory("/inventory", "assistant");
    await user.click(await screen.findByRole("button", { name: /พาราเซตามอล/ }));
    expect(await screen.findByRole("button", { name: "กักกันล็อต" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกการปรับ" })).not.toBeInTheDocument();
    cleanup();
    renderInventory("/inventory", "doctor");
    await user.click(await screen.findByRole("button", { name: /พาราเซตามอล/ }));
    expect(await screen.findByRole("button", { name: "กักกันล็อต" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกการปรับ" })).toBeInTheDocument();
  });

  it.each([
    ["VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูลรับยา"],
    ["IDEMPOTENCY_CONFLICT", "คำขอรับยานี้ขัดแย้งกับรายการเดิม"],
  ] as const)("preserves the receiving draft after %s", async (code, messageTh) => {
    const user = userEvent.setup();
    const idempotencyKeys: string[] = [];
    server.use(http.post("/api/inventory/receipts", ({ request }) => {
      idempotencyKeys.push(request.headers.get("Idempotency-Key") ?? "");
      return errorResponse(code, messageTh);
    }));
    renderInventory("/inventory/receive");

    const medicationSearch = await screen.findByRole("combobox", { name: "ค้นหายา" });
    await user.type(medicationSearch, "พารา");
    expect(await screen.findByRole("listbox", { name: "ผลการค้นหายา" })).toHaveClass("stock-medication-results");
    await user.click(await screen.findByRole("option", { name: /พาราเซตามอล/ }));
    await user.type(screen.getByRole("spinbutton", { name: "จำนวนที่รับ" }), "25");
    await user.type(screen.getByRole("textbox", { name: "เลขที่ล็อต" }), "PCM-2608");
    await user.type(screen.getByRole("textbox", { name: /ผู้ผลิต|ผู้จัดจำหน่าย/ }), "องค์การเภสัชกรรม");
    const expiry = screen.getByLabelText("วันหมดอายุ");
    const expiryValue = tomorrowInBangkok();
    expect(expiry).toHaveAttribute("min", expiryValue);
    await user.type(expiry, expiryValue);
    await user.click(screen.getByRole("button", { name: "ยืนยันการรับยา" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(messageTh);
    expect(medicationSearch).toHaveValue("พาราเซตามอล");
    expect(screen.getByRole("spinbutton", { name: "จำนวนที่รับ" })).toHaveValue(25);
    expect(screen.getByRole("textbox", { name: "เลขที่ล็อต" })).toHaveValue("PCM-2608");
    expect(screen.getByRole("textbox", { name: /ผู้ผลิต|ผู้จัดจำหน่าย/ })).toHaveValue("องค์การเภสัชกรรม");
    expect(screen.getByLabelText("วันหมดอายุ")).toHaveValue(expiryValue);
    await user.click(screen.getByRole("button", { name: "ยืนยันการรับยา" }));
    await screen.findByRole("alert");
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  it("prefills only the server-known recovery medication", async () => {
    // Break caught: trusting a medication ID from the URL can record stock against a medicine which is not present in the current server Inventory response.
    renderInventory("/inventory/receive?medicationId=DEMO-MED-001&returnTo=%2Fdispensing%2Fvisit-1");

    const medicationSearch = await screen.findByRole("combobox", { name: "ค้นหายา" });
    await waitFor(() => expect(medicationSearch).toHaveValue("พาราเซตามอล"));
  });

  it("invalidates stale Journey authority before returning from a successful stock recovery", async () => {
    // Break caught: returning with a fresh cache entry leaves the Dispensing screen able to act on authority that predates the newly received stock.
    const user = userEvent.setup();
    let journeyReads = 0;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(queryKeys.journey("visit-1"), recoveredJourney);
    server.use(
      http.post("/api/inventory/receipts", () => HttpResponse.json({ data: receivedInventory, replayed: false }, { status: 201 })),
      http.get("/api/dispensing/visit-1", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", messageTh: "ข้อมูลจัดยาไม่พร้อม", requestId: "pick-list" } }, { status: 503 })),
      http.get("/api/visits/visit-1/journey", () => { journeyReads += 1; return HttpResponse.json({ data: recoveredJourney }); }),
    );
    const { router } = renderInventory(
      "/inventory/receive?medicationId=DEMO-MED-001&returnTo=%2Fdispensing%2Fvisit-1",
      "assistant",
      ["fulfillment:read"],
      queryClient,
    );

    await waitFor(() => expect(screen.getByRole("combobox", { name: "ค้นหายา" })).toHaveValue("พาราเซตามอล"));
    await user.type(screen.getByRole("spinbutton", { name: "จำนวนที่รับ" }), "25");
    await user.type(screen.getByRole("textbox", { name: "เลขที่ล็อต" }), "PCM-2608");
    await user.type(screen.getByRole("textbox", { name: /ผู้ผลิต|ผู้จัดจำหน่าย/ }), "องค์การเภสัชกรรม");
    await user.type(screen.getByLabelText("วันหมดอายุ"), "2026-12-31");
    await user.click(screen.getByRole("button", { name: "ยืนยันการรับยา" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/dispensing/visit-1"));
    await waitFor(() => expect(journeyReads).toBe(1));
  });

  it("does not trust an unknown medication or an external stock-recovery return target", async () => {
    // Break caught: accepting URL values as inventory authority selects an unverified medicine or creates an open redirect from the recovery screen.
    renderInventory("/inventory/receive?medicationId=DEMO-MED-999&returnTo=https%3A%2F%2Foutside.example%2Fsteal");

    expect(await screen.findByRole("combobox", { name: "ค้นหายา" })).toHaveValue("");
    expect(screen.getByRole("link", { name: "ยกเลิก" })).toHaveAttribute("href", "/inventory");
  });

  it("preserves the selected movement and adjustment draft after a failed correction", async () => {
    const user = userEvent.setup();
    const idempotencyKeys: string[] = [];
    server.use(http.post("/api/inventory/lots/lot-001/adjustments", ({ request }) => {
      idempotencyKeys.push(request.headers.get("Idempotency-Key") ?? "");
      return errorResponse("VALIDATION_FAILED", "รายการอ้างอิงไม่อยู่ในล็อตยานี้");
    }));
    renderInventory("/inventory", "doctor");
    await user.click(await screen.findByRole("button", { name: /พาราเซตามอล/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "รายการอ้างอิง LOT-001" }), "movement-001");
    await user.type(screen.getByRole("spinbutton", { name: "ปรับจำนวน LOT-001" }), "-2");
    await user.type(screen.getByRole("textbox", { name: "เหตุผลปรับจำนวน LOT-001" }), "ตรวจนับซ้ำ");
    await user.click(screen.getByRole("button", { name: "บันทึกการปรับ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("รายการอ้างอิงไม่อยู่ในล็อตยานี้");
    expect(screen.getByRole("combobox", { name: "รายการอ้างอิง LOT-001" })).toHaveValue("movement-001");
    expect(screen.getByRole("spinbutton", { name: "ปรับจำนวน LOT-001" })).toHaveValue(-2);
    expect(screen.getByRole("textbox", { name: "เหตุผลปรับจำนวน LOT-001" })).toHaveValue("ตรวจนับซ้ำ");
    await user.click(screen.getByRole("button", { name: "บันทึกการปรับ" }));
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });
});
