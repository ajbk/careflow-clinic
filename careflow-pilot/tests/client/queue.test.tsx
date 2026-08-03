import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  phone: "0000000042",
  birthDate: "1990-01-01",
  sex: "unknown" as const,
  revision: 3,
  createdAt: "2026-08-03T00:00:00.000Z",
};

const waitingItem = {
  visit: {
    id: "visit-42",
    status: "WAITING" as const,
    revision: 7,
    arrivedAt: "2026-08-03T01:00:00.000Z",
    startedAt: null,
  },
  patient: {
    id: patient.id,
    hn: patient.hn,
    displayName: patient.displayName,
    birthDate: patient.birthDate,
    sex: patient.sex,
  },
  chiefComplaint: "มีไข้และไอ",
  vitals: {
    weightKg: null,
    heightCm: null,
    temperatureC: 38.2,
    systolicMmhg: 120,
    diastolicMmhg: 80,
    heartRateBpm: 90,
    spo2Percent: 98,
  },
  allowedActions: ["START_CONSULTATION"] as const,
};

const consultingItem = {
  ...waitingItem,
  visit: {
    ...waitingItem.visit,
    status: "CONSULTING" as const,
    revision: 8,
    startedAt: "2026-08-03T01:15:00.000Z",
  },
  allowedActions: [] as const,
};

const workspace = {
  visit: consultingItem.visit,
  patient,
  intake: {
    id: "intake-42",
    chiefComplaint: waitingItem.chiefComplaint,
    vitals: waitingItem.vitals,
    recordedAt: "2026-08-03T01:02:00.000Z",
    recordedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
  },
  allowedActions: [] as const,
};

const server = setupServer();

function session(role: "assistant" | "doctor") {
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
        ? ["patient:read", "visit:read-queue", "visit:start-consultation"]
        : ["patient:read", "visit:read-queue"],
      pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function jsonError(code: string, messageTh: string, status: number) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "request-queue" } }, { status });
}

function renderRoute(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  server.resetHandlers(
    http.get("/api/auth/session", () => HttpResponse.json(session("doctor"))),
    http.get("/api/queue", () => HttpResponse.json({ data: [waitingItem] })),
    http.get("/api/dashboard/today", () => HttpResponse.json({ data: { waiting: 1, consulting: 0, updatedAt: "2026-08-03T01:00:00.000Z" } })),
    http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: workspace })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("connected shared queue workflow", () => {
  it("renders the same server row for Assistant and Doctor, but only Doctor gets Start Consultation", async () => {
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))));
    renderRoute("/queue");
    const assistantRow = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(assistantRow).toHaveTextContent("visit-42");
    expect(assistantRow).toHaveTextContent("revision 7");
    expect(assistantRow).toHaveTextContent("รอตรวจ");
    expect(within(assistantRow).queryByRole("button", { name: /เริ่มการตรวจ/ })).not.toBeInTheDocument();
    cleanup();
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("doctor"))));
    renderRoute("/queue");
    const doctorRow = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(doctorRow).toHaveTextContent("visit-42");
    expect(doctorRow).toHaveTextContent("revision 7");
    expect(within(doctorRow).getByRole("button", { name: /เริ่มการตรวจ/ })).toBeInTheDocument();
  });

  it("never exposes a consulting-room link to Assistant", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })),
    );
    renderRoute("/queue");
    const row = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(within(row).queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
    expect(screen.getByText("ติดตามการส่งต่อผู้ป่วยให้แพทย์")).toBeInTheDocument();
  });

  it("offers the clinical room only to Doctor", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })));
    renderRoute("/queue");
    expect(within(await screen.findByRole("article", { name: /DEMO-000042/ }))
      .getByRole("link", { name: "เปิดห้องตรวจ" })).toBeInTheDocument();
    expect(screen.getByText("เลือกผู้ป่วยเพื่อเริ่มหรือกลับเข้าห้องตรวจ")).toBeInTheDocument();
  });

  it("refetches once after five seconds while visible, pauses hidden polling, and refetches on focus", async () => {
    vi.useFakeTimers();
    let queueRequests = 0;
    server.use(http.get("/api/queue", () => {
      queueRequests += 1;
      return HttpResponse.json({ data: [waitingItem] });
    }));
    renderRoute("/queue");
    await vi.waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    expect(queueRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(queueRequests).toBe(2));

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(queueRequests).toBe(2);

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(queueRequests).toBe(3));
  });

  it("sends the current Queue revision and navigates only after a committed CONSULTING response", async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    let requestKey = "";
    let resolveStart!: (response: Response) => void;
    server.use(http.post("/api/visits/visit-42/start-consultation", async ({ request }) => {
      requestBody = await request.json();
      requestKey = request.headers.get("Idempotency-Key") ?? "";
      return new Promise((resolve) => { resolveStart = resolve; });
    }));
    const router = renderRoute("/queue");
    const startButton = await screen.findByRole("button", { name: /เริ่มการตรวจ/ });
    void user.click(startButton);
    await waitFor(() => expect(requestBody).toBeDefined());
    expect(router.state.location.pathname).toBe("/queue");
    expect(requestBody).toEqual({ expectedRevisions: { visit: 7 }, payload: {} });
    expect(requestKey).toMatch(/\S/);
    resolveStart(new Response(JSON.stringify({ data: consultingItem, replayed: false }), { status: 200 }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/consultations/visit-42"));
  });

  it("hard-blocks a stale start response and refetches before re-enabling the action", async () => {
    const user = userEvent.setup();
    let startRequests = 0;
    let queueRequests = 0;
    server.use(
      http.get("/api/queue", () => {
        queueRequests += 1;
        return HttpResponse.json({ data: [waitingItem] });
      }),
      http.post("/api/visits/visit-42/start-consultation", () => {
        startRequests += 1;
        return jsonError("REVISION_CONFLICT", "ข้อมูลคิวเปลี่ยนแปลงแล้ว", 409);
      }),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: /เริ่มการตรวจ/ }));
    await waitFor(() => expect(screen.getByText("ข้อมูลคิวเปลี่ยนแปลงแล้ว")).toBeInTheDocument());
    expect(startRequests).toBe(1);
    expect(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ }));
    await waitFor(() => expect(queueRequests).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole("button", { name: /เริ่มการตรวจ/ })).toBeEnabled();
    expect(startRequests).toBe(1);
  });

  it("keeps the conflict block fail-closed when the latest queue reload fails", async () => {
    const user = userEvent.setup();
    let queueRequests = 0;
    server.use(
      http.get("/api/queue", () => {
        queueRequests += 1;
        if (queueRequests === 1 || queueRequests === 4) return HttpResponse.json({ data: [waitingItem] });
        return jsonError("INTERNAL_ERROR", "ระบบคิวไม่พร้อมใช้งาน", 503);
      }),
      http.post("/api/visits/visit-42/start-consultation", () => jsonError("REVISION_CONFLICT", "ข้อมูลคิวเปลี่ยนแปลงแล้ว", 409)),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: /เริ่มการตรวจ/ }));
    await waitFor(() => expect(screen.getByText("ข้อมูลคิวเปลี่ยนแปลงแล้ว")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ }));
    await waitFor(() => expect(queueRequests).toBeGreaterThanOrEqual(3));
    expect((await screen.findAllByText("ระบบคิวไม่พร้อมใช้งาน")).length).toBeGreaterThan(0);
    expect(screen.getByText("ข้อมูลคิวเปลี่ยนแปลง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ }));
    await waitFor(() => expect(queueRequests).toBe(4));
    expect(screen.queryByText("ข้อมูลคิวเปลี่ยนแปลงแล้ว")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เริ่มการตรวจ/ })).toBeEnabled();
  });

  it("renders a committed Consultation snapshot with milestone copy and no writable clinical controls", async () => {
    renderRoute("/consultations/visit-42");
    expect(await screen.findByText(patient.displayName)).toBeInTheDocument();
    expect(screen.getByText(/มีไข้และไอ/)).toBeInTheDocument();
    expect(screen.getByText(/เริ่มตรวจแล้ว — การบันทึกและลงนาม Clinical Note จะเปิดใน Milestone ถัดไป/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ลงนาม|เพิ่มยา|ส่งห้องยา/ })).not.toBeInTheDocument();
  });

  it("shows arrival and consultation start times for each queue state", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })));
    renderRoute("/queue");
    const row = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(within(row).getByText(/มาถึง/)).toBeInTheDocument();
    expect(within(row).getByText(/เริ่มตรวจ/)).toBeInTheDocument();
  });

  it("shows live Overview counts and marks unsupported medication, payment, and stock cards unavailable", async () => {
    renderRoute("/overview");
    expect(await screen.findByRole("heading", { name: "ภาพรวมคลินิก" })).toBeInTheDocument();
    expect((await screen.findAllByText("รอตรวจ")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("กำลังตรวจ")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ยังไม่พร้อมใน Pilot/).length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/฿|บาท|คงเหลือ/)).not.toBeInTheDocument();
  });

  it("links the Assistant Overview action to Intake", async () => {
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))));
    renderRoute("/overview");
    expect(await screen.findByRole("link", { name: "รับผู้ป่วย" })).toHaveAttribute("href", "/intake");
  });

  it("links the Doctor Overview action to Queue", async () => {
    renderRoute("/overview");
    expect(await screen.findByRole("link", { name: "ไปยังคิวตรวจ" })).toHaveAttribute("href", "/queue");
  });

  it("keeps Overview intake unavailable while the queue read is pending", async () => {
    let resolveQueue!: (response: Response) => void;
    server.use(http.get("/api/queue", () => new Promise((resolve) => { resolveQueue = resolve; })));
    renderRoute("/overview");
    expect(await screen.findByRole("heading", { name: "ภาพรวมคลินิก" })).toBeInTheDocument();
    expect(await screen.findByText("กำลังโหลดคิวผู้ป่วย")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /รับผู้ป่วย/ })).not.toBeInTheDocument();
    resolveQueue(HttpResponse.json({ data: [waitingItem] }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
  });

  it("surfaces a committed start-command 503 instead of swallowing the error", async () => {
    const user = userEvent.setup();
    server.use(http.post("/api/visits/visit-42/start-consultation", () => jsonError("INTERNAL_ERROR", "ระบบเริ่มห้องตรวจไม่พร้อมใช้งาน", 503)));
    renderRoute("/queue");
    const startButton = await screen.findByRole("button", { name: /เริ่มการตรวจ/ });
    await user.click(startButton);
    expect(await screen.findByText("ระบบเริ่มห้องตรวจไม่พร้อมใช้งาน")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เริ่มการตรวจ/ })).toBeEnabled();
  });

  it("surfaces a network start-command error instead of swallowing the error", async () => {
    const user = userEvent.setup();
    server.use(http.post("/api/visits/visit-42/start-consultation", () => HttpResponse.error()));
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: /เริ่มการตรวจ/ }));
    expect(await screen.findByText("ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เริ่มการตรวจ/ })).toBeEnabled();
  });

  it("reuses the same start attempt when a response is lost and the Doctor retries", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const bodies: unknown[] = [];
    let requests = 0;
    server.use(http.post("/api/visits/visit-42/start-consultation", async ({ request }) => {
      requests += 1;
      keys.push(request.headers.get("Idempotency-Key") ?? "");
      bodies.push(await request.json());
      return requests === 1
        ? HttpResponse.error()
        : HttpResponse.json({ data: consultingItem, replayed: true }, { status: 200 });
    }));

    const router = renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: /เริ่มการตรวจ/ }));
    expect(await screen.findByText("ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /เริ่มการตรวจ/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/consultations/visit-42"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/\S/);
    expect(keys[1]).toBe(keys[0]);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("renders an explicit permission-denied state when Overview dashboard access is forbidden", async () => {
    server.use(http.get("/api/dashboard/today", () => jsonError("FORBIDDEN", "ไม่มีสิทธิ์ดูภาพรวม", 403)));
    renderRoute("/overview");
    expect(await screen.findByText("ไม่มีสิทธิ์ดูภาพรวม")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลคิวของคลินิก");
  });

  it("renders explicit empty and unavailable Queue states", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [] })));
    renderRoute("/queue");
    expect(await screen.findByText("ยังไม่มีผู้ป่วยในคิว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ไปหน้ารับผู้ป่วย" })).toBeInTheDocument();

    cleanup();
    server.use(http.get("/api/queue", () => jsonError("INTERNAL_ERROR", "ระบบคิวไม่พร้อมใช้งาน", 503)));
    renderRoute("/queue");
    expect((await screen.findAllByText(/ระบบคิวไม่พร้อมใช้งาน/, {}, { timeout: 3_000 })).length).toBeGreaterThan(0);
  });
});
