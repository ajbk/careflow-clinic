import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const patient = { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยสังเคราะห์ 000042", phone: "0000000042", birthDate: "1990-01-01", sex: "unknown" as const, revision: 3, createdAt: "2026-08-03T00:00:00.000Z" };
const visit = { id: "visit-42", status: "AWAITING_PREPARATION" as const, revision: 9, arrivedAt: "2026-08-03T01:00:00.000Z", startedAt: "2026-08-03T01:15:00.000Z" };
const label = { id: "label-1", medicationDecisionId: "decision-1", medicationDecisionVersion: 1, version: 1, items: [{ orderItemId: "item-1", medicationId: "DEMO-MED-001", internalBarcode: "PARA-500" }] };
const allocation = { id: "allocation-1", orderItemId: "item-1", lotId: "lot-early", quantity: 10 };
const basePickList = { visit, patient, medicationDecision: { id: "decision-1", version: 1, kind: "ORDER" as const }, label, reservation: null, preparation: null, release: null, dispense: null, allowedActions: ["START_PREPARATION", "PRINT_LABEL"] as const };
const preparingPickList = { ...basePickList, visit: { ...visit, status: "PREPARING" as const, revision: 10 }, reservation: { id: "reservation-1", allocations: [allocation] }, preparation: { id: "preparation-1", revision: 1, status: "ACTIVE" as const, confirmations: [] }, allowedActions: ["PRINT_LABEL", "CONFIRM_ALLOCATION", "COMPLETE_PREPARATION", "ABANDON_PREPARATION"] as const };
const confirmedPickList = { ...preparingPickList, preparation: { ...preparingPickList.preparation, confirmations: [{ allocationId: allocation.id, orderItemId: allocation.orderItemId, lotId: allocation.lotId, method: "BARCODE" as const, barcode: "PARA-500" }] } };
let currentPickList: unknown = basePickList;

function session(role: "assistant" | "doctor" = "assistant", permissions = ["fulfillment:read", "fulfillment:prepare", "label:print"]) {
  return { data: { user: { id: `${role}-1`, username: role, displayName: role === "doctor" ? "พญ. ทดสอบ" : "ผู้ช่วยทดสอบ", role }, clinic: { id: "clinic", name: "คลินิกทดสอบ" }, permissions, pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z", mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
}

const server = setupServer();
function renderDispensing(path = "/dispensing/visit-42", role: "assistant" | "doctor" = "assistant") {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role))));
  render(<AppProviders><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} /></AppProviders>);
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => { currentPickList = basePickList; server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: currentPickList })), http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: label }))); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); server.resetHandlers(); });
afterAll(() => server.close());

describe("Preparation and label workflow", () => {
  it("shows the signed current label and only offers Start Preparation when allowed", async () => {
    renderDispensing();
    expect(await screen.findByText("Label v1")).toBeInTheDocument();
    expect(screen.getByText("PARA-500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มเตรียมยา" })).toBeInTheDocument();
  });

  it("submits a barcode confirmation on Enter for its matching allocation and exposes exact allocation data", async () => {
    const user = userEvent.setup();
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: preparingPickList })), http.post("/api/dispensing/visit-42/preparation-confirmations", () => HttpResponse.json({ data: confirmedPickList, replayed: false }, { status: 201 })));
    renderDispensing();
    expect(await screen.findByText("ล็อต lot-early")).toBeInTheDocument();
    expect(screen.getByText("จำนวน 10")).toBeInTheDocument();
    const scanner = screen.getByLabelText("สแกนบาร์โค้ดยา");
    await user.type(scanner, "PARA-500{enter}");
    expect(await screen.findByText("ยืนยันแล้ว")).toBeInTheDocument();
  });

  it("keeps mismatch as a zero-progress local error without sending a command", async () => {
    const user = userEvent.setup(); let requests = 0;
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: preparingPickList })), http.post("/api/dispensing/visit-42/preparation-confirmations", () => { requests += 1; return HttpResponse.json({ data: confirmedPickList, replayed: false }); }));
    renderDispensing();
    await user.type(await screen.findByLabelText("สแกนบาร์โค้ดยา"), "WRONG-CODE{enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("บาร์โค้ดไม่ตรงกับรายการจัดยา");
    expect(requests).toBe(0);
    expect(screen.getByText("รอยืนยัน")).toBeInTheDocument();
  });

  it("preserves a manual confirmation reason after an error", async () => {
    const user = userEvent.setup();
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: preparingPickList })), http.post("/api/dispensing/visit-42/preparation-confirmations", () => HttpResponse.json({ error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูล Visit เปลี่ยนแปลงแล้ว", requestId: "req-1" } }, { status: 409 })));
    renderDispensing();
    await user.type(await screen.findByLabelText("เหตุผลการยืนยันด้วยตนเอง"), "ฉลากชำรุด");
    await user.click(screen.getByRole("button", { name: "ยืนยันด้วยตนเอง" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูล Visit เปลี่ยนแปลงแล้ว");
    expect(screen.getByLabelText("เหตุผลการยืนยันด้วยตนเอง")).toHaveValue("ฉลากชำรุด");
  });

  it("does not complete an incomplete preparation and abandons only with a reason", async () => {
    const user = userEvent.setup(); let abandoned = false;
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: preparingPickList })), http.post("/api/dispensing/visit-42/reservation-release", () => { abandoned = true; return HttpResponse.json({ data: basePickList, replayed: false }, { status: 201 }); }));
    renderDispensing();
    await user.click(await screen.findByRole("button", { name: "เสร็จสิ้นการเตรียมยา" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ยืนยันรายการจัดยาไม่ครบ");
    await user.type(screen.getByLabelText("เหตุผลการยกเลิกการเตรียมยา"), "พบยาไม่ครบ");
    await user.click(screen.getByRole("button", { name: "ยกเลิกการเตรียมยา" }));
    await waitFor(() => expect(abandoned).toBe(true));
  });

  it("records a print request before opening print and calls it a request, not a physical success", async () => {
    const user = userEvent.setup(); const order: string[] = [];
    vi.stubGlobal("print", vi.fn(() => order.push("print")));
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })), http.post("/api/dispensing/visit-42/labels/label-1/print-events", () => { order.push("request"); return HttpResponse.json({ data: basePickList, replayed: false }, { status: 201 }); }));
    renderDispensing("/dispensing/visit-42/labels");
    await user.click(await screen.findByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" }));
    await waitFor(() => expect(order).toEqual(["request", "print"]));
    expect(screen.getAllByText(/คำขอพิมพ์/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/พิมพ์สำเร็จ/)).not.toBeInTheDocument();
  });
});
