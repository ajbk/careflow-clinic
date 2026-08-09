import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const patient = { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยสังเคราะห์ 000042", phone: "0000000042", birthDate: "1990-01-01", sex: "unknown" as const, revision: 3, createdAt: "2026-08-03T00:00:00.000Z" };
const visit = { id: "visit-42", status: "AWAITING_PREPARATION" as const, revision: 9, arrivedAt: "2026-08-03T01:00:00.000Z", startedAt: "2026-08-03T01:15:00.000Z" };
const label = {
  id: "label-1", medicationDecisionId: "decision-1", medicationDecisionVersion: 1, version: 1,
  clinicNameSnapshot: "คลินิกฉลากสแนปช็อต", patientHnSnapshot: "HN-LABEL-000042", patientDisplayNameSnapshot: "ผู้ป่วยบนฉลาก 000042",
  items: [{ orderItemId: "item-1", medicationId: "DEMO-MED-001", medicationRevision: 1, internalBarcode: "PARA-500", displayNameSnapshot: "พาราเซตามอล", strengthSnapshot: "500 mg", dosageFormSnapshot: "เม็ด", quantity: 10, unitSnapshot: "เม็ด", directionsThSnapshot: "รับประทานหลังอาหาร" }],
};
const allocation = { id: "allocation-1", orderItemId: "item-1", medicationId: "DEMO-MED-001", displayNameSnapshot: "ยาทดสอบ", strengthSnapshot: "500 มก.", dosageFormSnapshot: "เม็ด", internalBarcode: "PARA-500", lotId: "lot-early", lotNumberSnapshot: "LOT-EARLY", expiryDateSnapshot: "2026-12-31", unitSnapshot: "เม็ด", quantity: 10 };
const basePickList = { visit, patient, medicationDecision: { id: "decision-1", version: 1, kind: "ORDER" as const }, label, reservation: null, preparation: null, release: null, dispense: null, allowedActions: ["START_PREPARATION", "PRINT_LABEL"] as const };
const preparingPickList = { ...basePickList, visit: { ...visit, status: "PREPARING" as const, revision: 10 }, reservation: { id: "reservation-1", allocations: [allocation] }, preparation: { id: "preparation-1", revision: 1, status: "ACTIVE" as const, confirmations: [] }, allowedActions: ["PRINT_LABEL", "CONFIRM_ALLOCATION", "COMPLETE_PREPARATION", "ABANDON_PREPARATION"] as const };
const confirmedPickList = { ...preparingPickList, preparation: { ...preparingPickList.preparation, confirmations: [{ allocationId: allocation.id, orderItemId: allocation.orderItemId, lotId: allocation.lotId, method: "BARCODE" as const, barcode: "PARA-500" }] } };
const completedPreparation = { ...preparingPickList.preparation, revision: 2, status: "COMPLETED" as const, minimumPrintSequence: 1, latestPrintEventId: "print-1", latestPrintSequence: 1, confirmations: confirmedPickList.preparation.confirmations };
const releasePickList = { ...basePickList, visit: { ...visit, status: "AWAITING_RELEASE" as const, revision: 11 }, reservation: { id: "reservation-1", allocations: [allocation] }, preparation: completedPreparation, allowedActions: ["RELEASE", "REJECT"] as const };
const handoffPickList = { ...basePickList, visit: { ...visit, status: "AWAITING_HANDOFF" as const, revision: 12 }, reservation: { id: "reservation-1", allocations: [allocation] }, preparation: completedPreparation, release: { id: "release-1", reservationId: "reservation-1" }, allowedActions: ["HANDOFF"] as const };
let currentPickList: unknown = basePickList;

function session(role: "assistant" | "doctor" = "assistant", permissions = ["fulfillment:read", "fulfillment:prepare", "label:print"]) {
  return { data: { user: { id: `${role}-1`, username: role, displayName: role === "doctor" ? "พญ. ทดสอบ" : "ผู้ช่วยทดสอบ", role }, clinic: { id: "clinic", name: "คลินิกทดสอบ" }, permissions, pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z", mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
}

const server = setupServer();
function renderDispensing(path = "/dispensing/visit-42", role: "assistant" | "doctor" = "assistant", permissions = ["fulfillment:read", "fulfillment:prepare", "label:print"]) {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role, permissions))));
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return router;
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

  it("renders immutable snapshot fields from the current-label endpoint and one medicine per print page", async () => {
    let labelRequests = 0;
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: { ...basePickList, patient: { ...patient, displayName: "LIVE PATIENT MUST NOT PRINT" } } })),
      http.get("/api/dispensing/visit-42/labels", () => { labelRequests += 1; return HttpResponse.json({ data: label }); }),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByText("คลินิกฉลากสแนปช็อต")).toBeInTheDocument();
    expect(screen.getByText("ผู้ป่วยบนฉลาก 000042")).toBeInTheDocument();
    expect(screen.getByText("HN HN-LABEL-000042")).toBeInTheDocument();
    expect(screen.getByText("พาราเซตามอล")).toBeInTheDocument();
    expect(screen.getByText("Medication DEMO-MED-001 · revision 1")).toBeInTheDocument();
    const printedLabel = screen.getByRole("article");
    expect(printedLabel).toHaveTextContent("500 mg");
    expect(printedLabel).toHaveTextContent("เม็ด");
    expect(printedLabel).toHaveTextContent("จำนวน 10 เม็ด");
    expect(printedLabel).toHaveTextContent("รับประทานหลังอาหาร");
    expect(screen.queryByText("LIVE PATIENT MUST NOT PRINT")).not.toBeInTheDocument();
    expect(labelRequests).toBe(1);
    expect(document.querySelectorAll(".medicine-label")).toHaveLength(1);
    expect(document.querySelector(".label-controls")).toHaveClass("non-printable");
  });

  it("shows a loading state while the current-label request is pending", async () => {
    let resolveLabel!: (response: Response) => void;
    const pendingLabel = new Promise<Response>((resolve) => { resolveLabel = resolve; });
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => pendingLabel),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByText("กำลังโหลด Label…")).toBeInTheDocument();
    resolveLabel(new Response(JSON.stringify({ data: label }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("คลินิกฉลากสแนปช็อต")).toBeInTheDocument();
  });

  it("disables print while cached label and Pick List data are being refetched", async () => {
    let labelRequests = 0;
    let pickListRequests = 0;
    let resolveLabel!: (response: Response) => void;
    let resolvePickList!: (response: Response) => void;
    const pendingLabel = new Promise<Response>((resolve) => { resolveLabel = resolve; });
    const pendingPickList = new Promise<Response>((resolve) => { resolvePickList = resolve; });
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => {
        pickListRequests += 1;
        return pickListRequests === 1 ? HttpResponse.json({ data: basePickList }) : pendingPickList;
      }),
      http.get("/api/dispensing/visit-42/labels", () => {
        labelRequests += 1;
        return labelRequests === 1 ? HttpResponse.json({ data: label }) : pendingLabel;
      }),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).toBeInTheDocument();

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => {
      expect(labelRequests).toBe(2);
      expect(pickListRequests).toBe(2);
    });
    expect(screen.queryByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByText("CHECKING")).toBeInTheDocument();
    expect(screen.getAllByText("กำลังตรวจสอบข้อมูลปัจจุบัน…").length).toBeGreaterThan(0);
    expect(document.querySelector(".print-area")).toHaveClass("non-printable");

    resolveLabel(new Response(JSON.stringify({ data: label }), { status: 200, headers: { "Content-Type": "application/json" } }));
    resolvePickList(new Response(JSON.stringify({ data: basePickList }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).toBeInTheDocument();
  });

  it("blocks print when the current label is null or stale", async () => {
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: null })),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByRole("alert")).toHaveTextContent("ฉลากปัจจุบันไม่พร้อมใช้งาน");
    expect(screen.queryByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).not.toBeInTheDocument();
    expect(document.querySelector(".medicine-label")).not.toBeInTheDocument();
  });

  it("shows current-label errors without falling back to a Pick List label", async () => {
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ error: { code: "INVALID_STATE", messageTh: "ฉลากเดิมไม่เป็นปัจจุบัน", requestId: "label-err" } }, { status: 409 })),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByRole("alert")).toHaveTextContent("ฉลากเดิมไม่เป็นปัจจุบัน");
    expect(screen.queryByText("PARA-500")).not.toBeInTheDocument();
  });

  it("keeps print unavailable when the Pick List request fails", async () => {
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", messageTh: "ระบบรายการจัดยาไม่พร้อมใช้งาน", requestId: "picklist-err" } }, { status: 503 })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: label })),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByText("UNAVAILABLE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByText("ข้อมูลรายการจัดยายังไม่พร้อมสำหรับการพิมพ์")).toBeInTheDocument();
  });

  it("blocks a stale current label when the Pick List has a newer version", async () => {
    const newerLabel = { ...label, id: "label-2", version: 2 };
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: newerLabel })),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByText("STALE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByText(/ฉลากเดิมไม่พร้อมใช้งานสำหรับการพิมพ์/)).toBeInTheDocument();
    expect(document.querySelector(".medicine-label")).not.toBeInTheDocument();
  });

  it("rejects an invalid current-label response without rendering a print source", async () => {
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: { ...label, patientDisplayNameSnapshot: undefined } })),
    );
    renderDispensing("/dispensing/visit-42/labels");
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูลตอบกลับจากระบบไม่ถูกต้อง");
    expect(document.querySelector(".medicine-label")).not.toBeInTheDocument();
  });

  it("hides print commands without the label:print permission while retaining snapshot-only preview", async () => {
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })),
      http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: label })),
    );
    renderDispensing("/dispensing/visit-42/labels", "assistant", ["fulfillment:read"]);
    expect(await screen.findByText("คลินิกฉลากสแนปช็อต")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" })).not.toBeInTheDocument();
    expect(screen.getByText("รอผู้มีสิทธิ์ขอพิมพ์ฉลาก")).toBeInTheDocument();
    expect(document.querySelector(".print-area")).toHaveClass("non-printable");
  });

  it("keeps an Assistant read-only while a Doctor can release", async () => {
    const releasePickList = { ...basePickList, visit: { ...visit, status: "AWAITING_RELEASE" as const }, allowedActions: ["RELEASE", "REJECT"] as const };
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: releasePickList })));
    renderDispensing("/dispensing/visit-42", "assistant");
    expect(await screen.findByText("รอแพทย์ตรวจปล่อยยา")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ปล่อยยา" })).not.toBeInTheDocument();

    cleanup();
    renderDispensing("/dispensing/visit-42", "doctor", ["fulfillment:read", "fulfillment:release"]);
    expect(await screen.findByRole("button", { name: "ปล่อยยา" })).toBeEnabled();
  });

  it("pins every reviewed artifact and preserves a Doctor rejection reason in the client command", async () => {
    const user = userEvent.setup();
    let body: { payload?: Record<string, unknown> } | undefined;
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: releasePickList })),
      http.post("/api/dispensing/visit-42/reject", async ({ request }) => {
        body = await request.json() as { payload?: Record<string, unknown> };
        return HttpResponse.json({ data: { ...basePickList, visit: { ...visit, status: "AWAITING_PREPARATION" as const, revision: 12 }, allowedActions: ["START_PREPARATION"] }, replayed: false }, { status: 201 });
      }),
    );
    renderDispensing("/dispensing/visit-42", "doctor", ["fulfillment:read", "fulfillment:release"]);
    await user.type(await screen.findByLabelText("เหตุผลการปฏิเสธ"), "  ฉลากไม่ตรง  ");
    await user.click(screen.getByRole("button", { name: "ปฏิเสธการจัดยา" }));
    await waitFor(() => expect(body).toEqual(expect.objectContaining({ payload: {
      decisionId: "decision-1", decisionVersion: 1, labelVersionId: "label-1", labelPrintEventId: "print-1", preparationId: "preparation-1", reservationId: "reservation-1", reason: "ฉลากไม่ตรง",
    } })));
  });

  it("allows Assistant and Doctor handoff but sends one exact command while the first submit is pending", async () => {
    const user = userEvent.setup();
    let requests = 0;
    let resolveRequest!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    let body: { payload?: Record<string, unknown> } | undefined;
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: handoffPickList })),
      http.post("/api/dispensing/visit-42/handoff", async ({ request }) => {
        requests += 1;
        body = await request.json() as { payload?: Record<string, unknown> };
        return pending;
      }),
    );
    renderDispensing("/dispensing/visit-42", "assistant", ["fulfillment:read", "fulfillment:handoff"]);
    const button = await screen.findByRole("button", { name: "ยืนยันส่งมอบยา" });
    await user.click(button);
    await user.click(button);
    expect(requests).toBe(1);
    expect(button).toBeDisabled();
    expect(body).toEqual(expect.objectContaining({ payload: {
      decisionId: "decision-1", decisionVersion: 1, labelVersionId: "label-1", releaseId: "release-1", reservationId: "reservation-1",
    } }));
    resolveRequest(new Response(JSON.stringify({ data: { ...handoffPickList, visit: { ...handoffPickList.visit, status: "AWAITING_CHARGE" as const, revision: 13 }, release: handoffPickList.release, dispense: { id: "dispense-1", reservationId: "reservation-1", lines: [{ allocationId: "allocation-1", orderItemId: "item-1", lotId: "lot-early", quantity: 10 }] }, allowedActions: [] }, replayed: false }), { status: 201, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(screen.getByText("จัดยาและส่งมอบแล้ว")).toBeInTheDocument());
  });

  it("hides preparation commands when the Assistant has only read permission", async () => {
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })));
    renderDispensing("/dispensing/visit-42", "assistant", ["fulfillment:read"]);
    expect(await screen.findByText("รอผู้มีสิทธิ์เริ่มการเตรียมยา")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เริ่มเตรียมยา" })).not.toBeInTheDocument();
  });

  it("submits a barcode confirmation on Enter for its matching allocation and exposes exact allocation data", async () => {
    const user = userEvent.setup();
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: preparingPickList })), http.post("/api/dispensing/visit-42/preparation-confirmations", () => HttpResponse.json({ data: confirmedPickList, replayed: false }, { status: 201 })));
    renderDispensing();
    expect(await screen.findByText(/ล็อต LOT-EARLY/)).toBeInTheDocument();
    expect(screen.getByText("ยาทดสอบ · 500 มก.")).toBeInTheDocument();
    const scanner = screen.getByLabelText("สแกนบาร์โค้ดยา");
    await user.type(scanner, "PARA-500{enter}");
    expect(await screen.findByText("ยืนยันแล้ว")).toBeInTheDocument();
  });

  it("restores scanner focus after a successful confirmation when another allocation remains", async () => {
    const user = userEvent.setup();
    const secondAllocation = { ...allocation, id: "allocation-2", orderItemId: "item-2", lotId: "lot-late", lotNumberSnapshot: "LOT-LATE", quantity: 5 };
    const twoAllocationPickList = { ...preparingPickList, reservation: { id: "reservation-1", allocations: [allocation, secondAllocation] } };
    const firstConfirmed = { ...twoAllocationPickList, preparation: { ...twoAllocationPickList.preparation, confirmations: [{ allocationId: allocation.id, orderItemId: allocation.orderItemId, lotId: allocation.lotId, method: "BARCODE" as const, barcode: "PARA-500" }] } };
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: twoAllocationPickList })),
      http.post("/api/dispensing/visit-42/preparation-confirmations", () => HttpResponse.json({ data: firstConfirmed, replayed: false }, { status: 201 })),
    );
    renderDispensing();
    const scanner = await screen.findByLabelText("สแกนบาร์โค้ดยา");
    await user.type(scanner, "PARA-500{enter}");
    await waitFor(() => expect(scanner).toHaveFocus());
    expect(screen.getByText(/ล็อต LOT-LATE/)).toBeInTheDocument();
  });

  it("restores scanner focus after a confirmation error while another allocation remains", async () => {
    const user = userEvent.setup();
    const secondAllocation = { ...allocation, id: "allocation-2", orderItemId: "item-2", lotId: "lot-late", lotNumberSnapshot: "LOT-LATE", quantity: 5 };
    const twoAllocationPickList = { ...preparingPickList, reservation: { id: "reservation-1", allocations: [allocation, secondAllocation] } };
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: twoAllocationPickList })),
      http.post("/api/dispensing/visit-42/preparation-confirmations", () => HttpResponse.json({ error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูล Visit เปลี่ยนแปลงแล้ว", requestId: "confirm-err" } }, { status: 409 })),
    );
    renderDispensing();
    const scanner = await screen.findByLabelText("สแกนบาร์โค้ดยา");
    await user.type(scanner, "PARA-500{enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูล Visit เปลี่ยนแปลงแล้ว");
    expect(scanner).toHaveFocus();
    expect(screen.getByText(/ล็อต LOT-LATE/)).toBeInTheDocument();
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

  it("uses a fresh idempotency key for each deliberate failed confirmation without retrying or replacing cached state", async () => {
    const user = userEvent.setup(); const keys: string[] = []; let commandRequests = 0; let pickListRequests = 0;
    server.resetHandlers(
      http.get("/api/dispensing/visit-42", () => { pickListRequests += 1; return HttpResponse.json({ data: preparingPickList }); }),
      http.post("/api/dispensing/visit-42/preparation-confirmations", ({ request }) => {
        commandRequests += 1;
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูล Visit เปลี่ยนแปลงแล้ว", requestId: `confirm-${commandRequests}` } }, { status: 409 });
      }),
    );
    renderDispensing();
    const reason = await screen.findByLabelText("เหตุผลการยืนยันด้วยตนเอง");
    await user.type(reason, "ฉลากชำรุด");
    const submit = screen.getByRole("button", { name: "ยืนยันด้วยตนเอง" });
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูล Visit เปลี่ยนแปลงแล้ว");
    await user.click(submit);
    await waitFor(() => expect(commandRequests).toBe(2));
    expect(new Set(keys).size).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(commandRequests).toBe(2);
    expect(pickListRequests).toBe(1);
    expect(screen.getByText("รอยืนยัน")).toBeInTheDocument();
    expect(reason).toHaveValue("ฉลากชำรุด");
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
    server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: basePickList })), http.get("/api/dispensing/visit-42/labels", () => HttpResponse.json({ data: label })), http.post("/api/dispensing/visit-42/labels/label-1/print-events", () => { order.push("request"); return HttpResponse.json({ data: basePickList, replayed: false }, { status: 201 }); }));
    renderDispensing("/dispensing/visit-42/labels");
    await user.click(await screen.findByRole("button", { name: "บันทึกคำขอพิมพ์และเปิดหน้าต่างพิมพ์" }));
    await waitFor(() => expect(order).toEqual(["request", "print"]));
    expect(screen.getAllByText(/คำขอพิมพ์/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/พิมพ์สำเร็จ/)).not.toBeInTheDocument();
  });
});
