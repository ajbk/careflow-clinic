import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const patient = {
  id: "patient-42",
  hn: "DEMO-000042",
  displayName: "ผู้ป่วยสังเคราะห์ 000042",
  birthDate: "1990-01-01",
  sex: "unknown",
};

const lines = [
  {
    id: null,
    position: 0,
    lineType: "CONSULTATION",
    descriptionSnapshot: "ค่าตรวจ",
    quantity: 1,
    unitPriceBaht: 100,
    lineTotalBaht: 100,
    medicationOrderItemId: null,
    fulfillmentDispenseLineId: null,
  },
  {
    id: null,
    position: 1,
    lineType: "MEDICATION",
    descriptionSnapshot: "พาราเซตามอล 500 มก.",
    quantity: 5,
    unitPriceBaht: 5,
    lineTotalBaht: 25,
    medicationOrderItemId: "order-item-1",
    fulfillmentDispenseLineId: "dispense-line-1",
  },
];

const charge = {
  id: "charge-42",
  sourceKind: "ORDER",
  medicationDecisionId: "decision-42",
  medicationDecisionVersion: 2,
  fulfillmentDispenseId: "dispense-42",
  clinicPricingRevision: 3,
  consultationFeeBahtSnapshot: 100,
  currency: "THB",
  lineCount: 2,
  finalizedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" },
  finalizedAt: "2026-08-09T03:00:00.000Z",
  contentHash: "a".repeat(64),
};

const previewCheckout = {
  patient,
  visit: { id: "visit-42", status: "AWAITING_CHARGE", revision: 7, arrivedAt: "2026-08-09T01:00:00.000Z", startedAt: "2026-08-09T01:15:00.000Z", closedAt: null },
  clinicPricingRevision: 3,
  sourceKind: "ORDER",
  charge: null,
  lines,
  grossTotalBaht: 125,
  adjustmentTotalBaht: 0,
  netDueBaht: 125,
  collectionState: "PENDING_CHARGE",
  allowedActions: ["FINALIZE_CHARGE"],
  closeBlockers: ["charge"],
};

const awaitingPaymentCheckout = {
  ...previewCheckout,
  visit: { ...previewCheckout.visit, status: "AWAITING_PAYMENT", revision: 8 },
  charge: { ...charge },
  lines: lines.map((line, index) => ({ ...line, id: `line-${index + 1}` })),
  collectionState: "AWAITING_COLLECTION",
  allowedActions: ["RECORD_CASH", "CONFIRM_PROMPTPAY", "APPROVE_FULL_WAIVER"],
  closeBlockers: ["collection"],
};

const paidCheckout = {
  ...awaitingPaymentCheckout,
  visit: { ...awaitingPaymentCheckout.visit, status: "READY_TO_CLOSE", revision: 9 },
  collectionState: "PAID_CASH",
  allowedActions: [],
  closeBlockers: [],
};

const waivedCheckout = {
  ...paidCheckout,
  adjustmentTotalBaht: -125,
  netDueBaht: 0,
  collectionState: "COLLECTION_NOT_REQUIRED",
};

const closedCheckout = {
  ...paidCheckout,
  visit: { ...paidCheckout.visit, status: "CLOSED", revision: 10, closedAt: "2026-08-09T04:00:00.000Z" },
  collectionState: "CLOSED",
};

function session(role: "assistant" | "doctor", permissions: string[]) {
  return {
    data: {
      user: {
        id: `${role}-1`,
        username: role,
        displayName: role === "doctor" ? "พญ. ทดสอบ" : "ผู้ช่วยทดสอบ",
        role,
      },
      clinic: { id: "clinic", name: "คลินิกทดสอบ" },
      permissions,
      pilotAcknowledgedAt: "2026-08-09T00:00:00.000Z",
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

const doctorPermissions = ["finance:read", "finance:finalize-charge", "finance:record-cash", "finance:confirm-promptpay", "finance:waive", "visit:read-queue"];
const assistantPermissions = ["finance:read", "finance:record-cash", "visit:read-queue"];
const server = setupServer();

function renderCheckout(
  checkout: unknown = previewCheckout,
  role: "assistant" | "doctor" = "doctor",
  permissions = role === "doctor" ? doctorPermissions : assistantPermissions,
) {
  server.use(
    http.get("/api/auth/session", () => HttpResponse.json(session(role, permissions))),
    http.get("/api/checkout/visit-42", () => HttpResponse.json({ data: checkout })),
  );
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/checkout/visit-42"] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return router;
}

function apiError(code: string, messageTh: string, status: number, fieldErrors?: Record<string, string>) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "checkout-test", ...(fieldErrors ? { fieldErrors } : {}) } }, { status });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  server.resetHandlers(
    http.get("/api/auth/session", () => HttpResponse.json(session("doctor", doctorPermissions))),
    http.get("/api/checkout/visit-42", () => HttpResponse.json({ data: previewCheckout })),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("Thai checkout workflow", () => {
  it("renders immutable server line evidence and exact whole-Baht values without clinical content", async () => {
    renderCheckout();
    expect(await screen.findByRole("heading", { name: "ชำระเงิน" })).toBeInTheDocument();
    expect(await screen.findByText("ค่าตรวจ")).toBeInTheDocument();
    expect(screen.getByText("พาราเซตามอล 500 มก.")).toBeInTheDocument();
    expect(screen.getAllByText("100 บาท").length).toBeGreaterThan(0);
    expect(screen.getAllByText("25 บาท").length).toBeGreaterThan(0);
    expect(screen.getAllByText("125 บาท").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\.00 บาท/)).not.toBeInTheDocument();
    expect(screen.queryByText(/subjective|diagnosis|SOAP/i)).not.toBeInTheDocument();
  });

  it("uses the server-provided pricing revision and sends no actor or client-computed total when Doctor finalizes", async () => {
    const user = userEvent.setup();
    let command: unknown;
    let key = "";
    server.use(http.post("/api/checkout/visit-42/charge-finalizations", async ({ request }) => {
      command = await request.json();
      key = request.headers.get("Idempotency-Key") ?? "";
      return HttpResponse.json({ data: awaitingPaymentCheckout, replayed: false }, { status: 201 });
    }));
    renderCheckout();
    await user.click(await screen.findByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" }));
    await waitFor(() => expect(command).toEqual({
      expectedRevisions: { visit: 7, clinicPricing: 3 },
      payload: { settlementIntent: "COLLECT" },
    }));
    expect(key).toMatch(/\S/);
  });

  it("uses a single explicit finalization attempt across a transport retry and blocks duplicate submit while pending", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let requests = 0;
    let resolveCommand!: (response: Response) => void;
    server.use(http.post("/api/checkout/visit-42/charge-finalizations", ({ request }) => {
      requests += 1;
      keys.push(request.headers.get("Idempotency-Key") ?? "");
      if (requests === 1) return HttpResponse.error();
      return new Promise((resolve) => { resolveCommand = resolve; });
    }));
    renderCheckout();
    const submit = await screen.findByRole("button", { name: "ยืนยันยอดเพื่อรับชำระ" });
    await user.click(submit);
    expect(await screen.findByText("ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่")).toBeInTheDocument();
    await user.click(submit);
    await user.click(submit);
    await waitFor(() => expect(requests).toBe(2));
    expect(keys[1]).toBe(keys[0]);
    expect(submit).toBeDisabled();
    resolveCommand(new Response(JSON.stringify({ data: awaitingPaymentCheckout, replayed: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });

  it("keeps the full-waiver reason after a validation failure and finalizes atomically with that reason", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.post("/api/checkout/visit-42/charge-finalizations", async ({ request }) => {
      bodies.push(await request.json());
      return bodies.length === 1
        ? apiError("VALIDATION_FAILED", "เหตุผลไม่ถูกต้อง", 422, { "payload.waiverReason": "กรุณาระบุเหตุผล" })
        : HttpResponse.json({ data: waivedCheckout, replayed: false }, { status: 201 });
    }));
    renderCheckout();
    await user.click(await screen.findByRole("button", { name: "ยกเว้นเต็มจำนวน" }));
    const reason = screen.getByLabelText("เหตุผลการยกเว้น");
    await user.type(reason, "  เกณฑ์ช่วยเหลือผู้ป่วย  ");
    await user.click(screen.getByRole("button", { name: "ยืนยันยกเว้นเต็มจำนวน" }));
    expect(await screen.findByText("เหตุผลไม่ถูกต้อง")).toBeInTheDocument();
    expect(reason).toHaveValue("  เกณฑ์ช่วยเหลือผู้ป่วย  ");
    await user.click(screen.getByRole("button", { name: "ยืนยันยกเว้นเต็มจำนวน" }));
    await waitFor(() => expect(bodies).toEqual([
      { expectedRevisions: { visit: 7, clinicPricing: 3 }, payload: { settlementIntent: "FULL_WAIVER", waiverReason: "เกณฑ์ช่วยเหลือผู้ป่วย" } },
      { expectedRevisions: { visit: 7, clinicPricing: 3 }, payload: { settlementIntent: "FULL_WAIVER", waiverReason: "เกณฑ์ช่วยเหลือผู้ป่วย" } },
    ]));
  });

  it("allows an Assistant only the server-authorized exact Cash action", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(http.post("/api/checkout/visit-42/payments/cash", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: paidCheckout, replayed: false }, { status: 201 });
    }));
    renderCheckout({ ...awaitingPaymentCheckout, allowedActions: ["RECORD_CASH"] }, "assistant");
    expect(await screen.findByRole("button", { name: "ยืนยันรับเงินสด 125 บาท" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยืนยัน PromptPay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเว้นเต็มจำนวน" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ยืนยันรับเงินสด 125 บาท" }));
    await waitFor(() => expect(body).toEqual({
      expectedRevisions: { visit: 8 },
      payload: { chargeId: "charge-42", amountBaht: 125 },
    }));
  });

  it("keeps a Doctor PromptPay reference after a conflict and sends only the exact server due", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(http.post("/api/checkout/visit-42/payments/promptpay", async ({ request }) => {
      bodies.push(await request.json());
      return apiError("REVISION_CONFLICT", "ข้อมูลการชำระเงินเปลี่ยนแปลงแล้ว", 409);
    }));
    renderCheckout(awaitingPaymentCheckout);
    const reference = await screen.findByLabelText("เลขอ้างอิง PromptPay");
    await user.type(reference, "  PP-20260809-42  ");
    await user.click(screen.getByRole("button", { name: "ยืนยัน PromptPay" }));
    expect(await screen.findByText("ข้อมูลการชำระเงินเปลี่ยนแปลงแล้ว")).toBeInTheDocument();
    expect(reference).toHaveValue("  PP-20260809-42  ");
    expect(screen.getByRole("button", { name: "ยืนยัน PromptPay" })).toBeDisabled();
    expect(bodies).toEqual([{ expectedRevisions: { visit: 8 }, payload: { chargeId: "charge-42", amountBaht: 125, manualReference: "PP-20260809-42" } }]);
  });

  it("renders paid, waived, and closed checkout evidence as read-only summaries", async () => {
    renderCheckout(paidCheckout);
    expect(await screen.findByText("รับชำระแล้ว รอแพทย์ปิด Visit")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยันรับเงินสด|ยืนยัน PromptPay|ยืนยันยอดเพื่อรับชำระ/ })).not.toBeInTheDocument();
    cleanup();
    renderCheckout(waivedCheckout);
    expect(await screen.findByText("-125 บาท")).toBeInTheDocument();
    expect(screen.getAllByText("0 บาท").length).toBeGreaterThan(0);
    cleanup();
    renderCheckout(closedCheckout);
    expect(await screen.findByText("ปิด Visit แล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /บัตร OPD/ })).not.toBeInTheDocument();
  });

  it("shows denied and unavailable Checkout states without exposing commands", async () => {
    renderCheckout();
    server.use(http.get("/api/checkout/visit-42", () => apiError("FORBIDDEN", "ไม่มีสิทธิ์ดูข้อมูลชำระเงิน", 403)));
    expect(await screen.findByText("ไม่มีสิทธิ์ดูข้อมูลชำระเงิน")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยัน|ยกเว้น/ })).not.toBeInTheDocument();
    cleanup();
    renderCheckout();
    server.use(http.get("/api/checkout/visit-42", () => apiError("INTERNAL_ERROR", "ระบบชำระเงินไม่พร้อมใช้งาน", 503)));
    expect(await screen.findByText("ระบบชำระเงินไม่พร้อมใช้งาน")).toBeInTheDocument();
  });

  it("renders a loading state and fails closed with preserved drafts while cached Checkout is stale", async () => {
    let resolveCheckout!: (response: Response) => void;
    renderCheckout();
    server.use(http.get("/api/checkout/visit-42", () => new Promise((resolve) => { resolveCheckout = resolve; })));
    expect(await screen.findByText("กำลังโหลดข้อมูลชำระเงิน…")).toBeInTheDocument();
    await waitFor(() => expect(resolveCheckout).toBeTypeOf("function"));
    resolveCheckout(new Response(JSON.stringify({ data: awaitingPaymentCheckout }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const reference = await screen.findByLabelText("เลขอ้างอิง PromptPay");
    await userEvent.setup().type(reference, "PP-CACHED-42");

    server.use(http.get("/api/checkout/visit-42", () => apiError("INTERNAL_ERROR", "ระบบชำระเงินไม่พร้อมใช้งาน", 503)));
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("ข้อมูลการชำระเงินอาจไม่เป็นปัจจุบัน")).toBeInTheDocument();
    expect(reference).toHaveValue("PP-CACHED-42");
    expect(screen.getByRole("button", { name: "ยืนยัน PromptPay" })).toBeDisabled();
  });
});
