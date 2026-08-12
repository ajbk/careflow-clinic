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

const waitingJourneySummary = {
  steps: [
    { code: "INTAKE" as const, labelTh: "รับผู้ป่วย", state: "COMPLETE" as const },
    { code: "SCREENING" as const, labelTh: "คัดกรอง", state: "COMPLETE" as const },
    { code: "CONSULTATION" as const, labelTh: "ตรวจรักษา", state: "CURRENT" as const },
    { code: "MEDICATION_DECISION" as const, labelTh: "ตัดสินใจเรื่องยา", state: "UPCOMING" as const },
    { code: "PREPARATION" as const, labelTh: "เตรียมยา", state: "UPCOMING" as const },
    { code: "HANDOFF" as const, labelTh: "ส่งมอบยา", state: "UPCOMING" as const },
    { code: "PAYMENT" as const, labelTh: "ชำระเงิน", state: "UPCOMING" as const },
    { code: "CLOSURE" as const, labelTh: "ปิด Visit", state: "UPCOMING" as const },
  ],
  nextTask: {
    action: "START_CONSULTATION" as const,
    labelTh: "เริ่มการตรวจ",
    primaryRole: "doctor" as const,
    permittedRoles: ["doctor" as const],
    availability: "AVAILABLE" as const,
  },
  blockers: [],
  allowedActions: ["START_CONSULTATION" as const, "REVIEW_ALLERGY" as const],
};

const consultingJourneySummary = {
  ...waitingJourneySummary,
  nextTask: {
    action: "OPEN_CONSULTATION" as const,
    labelTh: "เปิดห้องตรวจ",
    primaryRole: "doctor" as const,
    permittedRoles: ["doctor" as const],
    availability: "AVAILABLE" as const,
  },
  allowedActions: ["OPEN_CONSULTATION" as const, "SAVE_CONSULTATION_DRAFT" as const, "FINALIZE_CONSULTATION" as const],
};

function summaryFor(action: string, labelTh: string) {
  return {
    ...consultingJourneySummary,
    nextTask: {
      action,
      labelTh,
      primaryRole: "doctor" as const,
      permittedRoles: ["doctor" as const],
      availability: "AVAILABLE" as const,
    },
    allowedActions: [action],
  };
}

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
    revision: patient.revision,
  },
  allergy: { id: null, revision: 0, state: "UNKNOWN" as const, items: [], sourceText: null, reason: null, reviewedBy: null, reviewedAt: null },
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
  allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"] as const,
  journeySummary: waitingJourneySummary,
};

const consultingItem = {
  ...waitingItem,
  visit: {
    ...waitingItem.visit,
    status: "CONSULTING" as const,
    revision: 8,
    startedAt: "2026-08-03T01:15:00.000Z",
  },
  allowedActions: ["OPEN_CONSULTATION"] as const,
  journeySummary: consultingJourneySummary,
};

const pendingItems = [
  waitingItem,
  { ...consultingItem, visit: { ...consultingItem.visit, id: "visit-consulting" } },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-order", status: "AWAITING_ORDER_REVISION" as const, revision: 9 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("OPEN_CONSULTATION", "เปิดห้องตรวจ"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-preparation", status: "AWAITING_PREPARATION" as const, revision: 10 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("START_PREPARATION", "เริ่มการจัดยา"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-preparing", status: "PREPARING" as const, revision: 11 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("CONFIRM_ALLOCATION", "ยืนยันการจัดยา"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-release", status: "AWAITING_RELEASE" as const, revision: 12 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("RELEASE_MEDICATION", "ปล่อยยา"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-handoff", status: "AWAITING_HANDOFF" as const, revision: 13 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("HANDOFF_MEDICATION", "ส่งมอบยา"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-charge", status: "AWAITING_CHARGE" as const, revision: 14 },
    allowedActions: ["OPEN_CONSULTATION"] as const,
    journeySummary: summaryFor("FINALIZE_CHARGE", "เริ่มคิดเงิน"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-payment", status: "AWAITING_PAYMENT" as const, revision: 15 },
    allowedActions: [] as const,
    journeySummary: summaryFor("RECORD_CASH", "ไปหน้าชำระเงิน"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-ready", status: "READY_TO_CLOSE" as const, revision: 16 },
    allowedActions: [] as const,
    journeySummary: summaryFor("CLOSE_VISIT", "ไปหน้าชำระเงิน"),
  },
  {
    ...consultingItem,
    visit: { ...consultingItem.visit, id: "visit-closed", status: "CLOSED" as const, revision: 17 },
    allowedActions: [] as const,
  },
];

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
  patientSnapshot: {
    allergy: waitingItem.allergy,
    activeProblems: { state: "UNKNOWN" as const, value: null, source: null },
    currentMedicationContext: { state: "UNKNOWN" as const, value: null, source: null },
    latestRelevantPlan: { state: "UNKNOWN" as const, value: null, source: null },
    pendingFollowUp: { state: "UNKNOWN" as const, value: null, source: null },
    recentVisits: [],
  },
  consultationDraft: { note: null, medicationDecision: null },
  signedClinicalNote: null,
  amendments: [],
  medicationDecision: null,
  allowedActions: ["SAVE_DRAFT", "FINALIZE_CONSULTATION", "REVIEW_ALLERGY"] as const,
};

const waitingWorkspace = {
  ...workspace,
  visit: waitingItem.visit,
  allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"] as const,
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
        ? ["patient:read", "visit:read-queue", "visit:start-consultation", "clinical:read", "clinical:save-draft", "clinical:sign", "clinical:amend", "patient:update-allergy", "medication:read-catalog", "medication:sign-decision", "fulfillment:read", "finance:read"]
        : ["patient:read", "visit:read-queue", "fulfillment:read", "finance:read"],
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
    http.get("/api/dashboard/today", () => HttpResponse.json({ data: { waiting: 1, consulting: 0, awaitingOrderRevision: 0, awaitingPreparation: 0, preparing: 0, awaitingRelease: 0, awaitingHandoff: 0, awaitingCharge: 0, awaitingPayment: 0, readyToClose: 0, updatedAt: "2026-08-03T01:00:00.000Z" } })),
    http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: workspace })),
    http.get("/api/visits/:visitId/journey", ({ params }) => HttpResponse.json({
      data: {
        visit: { id: String(params.visitId), status: "CONSULTING", revision: 8 },
        refreshedAt: "2026-08-03T01:20:00.000Z",
        ...consultingJourneySummary,
      },
    })),
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
  it("renders the embedded Journey and never promotes a legacy Queue action omitted by Journey authority", async () => {
    // Break caught: Queue's stale legacy allowedActions can otherwise show a clinical mutation that Journey has withdrawn.
    let journeyRequests = 0;
    const staleAuthorityItem = {
      ...waitingItem,
      allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"] as const,
      journeySummary: {
        ...waitingJourneySummary,
        nextTask: {
          ...waitingJourneySummary.nextTask,
          labelTh: "รอแพทย์ตรวจและสั่งการรักษา",
          availability: "WAITING_FOR_ROLE" as const,
        },
        allowedActions: [] as const,
      },
    };
    server.use(
      http.get("/api/queue", () => HttpResponse.json({ data: [staleAuthorityItem] })),
      http.get("/api/visits/:visitId/journey", () => {
        journeyRequests += 1;
        return HttpResponse.json({ error: { code: "INTERNAL_ERROR", messageTh: "Queue must use its embedded summary", requestId: "queue-journey" } }, { status: 500 });
      }),
    );
    renderRoute("/queue");

    expect(await screen.findByRole("navigation", { name: "เส้นทางผู้ป่วย" })).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("รอแพทย์ตรวจและสั่งการรักษา"))).toBe(true);
    expect(screen.queryByRole("button", { name: "เริ่มการตรวจ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" })).not.toBeInTheDocument();
    expect(journeyRequests).toBe(0);
  });

  it("lets Assistant review WAITING Allergy without a clinical link", async () => {
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))));
    renderRoute("/queue");
    const row = within(await screen.findByRole("article", { name: /DEMO-000042/ }));
    expect(row.getByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" })).toBeInTheDocument();
    expect(row.queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
  });

  it("keeps both Doctor Start Consultation and Allergy recovery reachable for WAITING UNKNOWN", async () => {
    // Break caught: a blocker can describe the Allergy recovery, but it must not
    // suppress the separately authorized Doctor start command.
    const unknownWaiting = {
      ...waitingItem,
      journeySummary: {
        ...waitingJourneySummary,
        blockers: [{
          code: "ALLERGY_UNKNOWN" as const,
          titleTh: "ยังไม่ได้ถามประวัติแพ้ยา",
          detailTh: "ต้องทบทวนก่อนลงนามการตรวจ",
          primaryRole: "assistant" as const,
          recoveryAction: "REVIEW_ALLERGY" as const,
          medication: null,
        }],
        nextTask: {
          ...waitingJourneySummary.nextTask,
          availability: "AVAILABLE" as const,
        },
        allowedActions: ["START_CONSULTATION", "REVIEW_ALLERGY"] as const,
      },
    };
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [unknownWaiting] })));
    renderRoute("/queue");
    const row = within(await screen.findByRole("article", { name: /DEMO-000042/ }));
    expect(row.getByRole("button", { name: "เริ่มการตรวจ" })).toBeEnabled();
    const allergyRecoveries = [
      ...row.queryAllByRole("button", { name: "ยังไม่ได้ถามประวัติแพ้ยา" }),
      ...row.queryAllByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }),
    ];
    expect(allergyRecoveries).toHaveLength(1);
    expect(allergyRecoveries[0]).toBeEnabled();
  });

  it("preserves and submits every item in a PRESENT Allergy assessment", async () => {
    const user = userEvent.setup();
    let body: unknown;
    const presentAllergy = {
      id: "allergy-2", revision: 2, state: "PRESENT" as const,
      items: [
        { substance: "ยา A", reaction: "ผื่น", severity: "MILD" as const, note: "หลีกเลี่ยง" },
        { substance: "ยา B", reaction: "หายใจลำบาก", severity: "MODERATE" as const, note: "เคยรักษาในโรงพยาบาล" },
      ],
      sourceText: "บัตรแพ้ยา", reason: "ทบทวนก่อนพบแพทย์",
      reviewedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" }, reviewedAt: "2026-08-03T01:20:00.000Z",
    };
    const presentItem = { ...waitingItem, allergy: presentAllergy };
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [presentItem] })),
      http.post("/api/patients/patient-42/allergy-revisions", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { patient, allergy: presentAllergy, visit: waitingItem.visit }, replayed: false });
      }),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }));

    expect(screen.getByRole("button", { name: "ยังไม่ทราบ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันว่าไม่แพ้" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "มีประวัติแพ้ยา" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("สารที่แพ้")).toHaveLength(2);
    expect(screen.getAllByLabelText("อาการแพ้")).toHaveLength(2);
    expect(screen.getAllByLabelText("ความรุนแรง")).toHaveLength(2);
    expect(screen.getAllByLabelText("หมายเหตุ")).toHaveLength(2);
    await user.selectOptions(screen.getAllByLabelText("ความรุนแรง")[1], "SEVERE");
    await user.clear(screen.getAllByLabelText("หมายเหตุ")[1]);
    await user.type(screen.getAllByLabelText("หมายเหตุ")[1], "ต้องส่งต่อทันทีหากเกิดซ้ำ");
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));

    await waitFor(() => expect(body).toMatchObject({
      payload: {
        state: "PRESENT",
        items: [
          { substance: "ยา A", reaction: "ผื่น", severity: "MILD", note: "หลีกเลี่ยง" },
          { substance: "ยา B", reaction: "หายใจลำบาก", severity: "SEVERE", note: "ต้องส่งต่อทันทีหากเกิดซ้ำ" },
        ],
      },
    }));
  });

  it("adds and removes Allergy items without changing sibling values", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))));
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }));
    await user.click(screen.getByRole("button", { name: "มีประวัติแพ้ยา" }));
    await user.type(screen.getByLabelText("สารที่แพ้"), "ยา A");
    await user.type(screen.getByLabelText("อาการแพ้"), "ผื่น");
    await user.click(screen.getByRole("button", { name: "เพิ่มรายการแพ้" }));

    const substances = screen.getAllByLabelText("สารที่แพ้");
    const reactions = screen.getAllByLabelText("อาการแพ้");
    expect(substances).toHaveLength(2);
    await user.type(substances[1], "ยา B");
    await user.type(reactions[1], "บวม");
    expect(substances[0]).toHaveValue("ยา A");
    expect(substances[1]).toHaveValue("ยา B");

    await user.click(screen.getByRole("button", { name: "ลบรายการแพ้ 2" }));
    expect(screen.getAllByLabelText("สารที่แพ้")).toHaveLength(1);
    expect(screen.getByLabelText("สารที่แพ้")).toHaveValue("ยา A");
  });

  it("keeps Assistant Queue clinical-link free while preserving finance links from active server states", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: pendingItems.map((item) => ({
        ...item,
        allowedActions: item.visit.status === "WAITING" ? ["REVIEW_ALLERGY"] : [],
        journeySummary: {
          ...item.journeySummary,
          allowedActions: item.visit.status === "WAITING" ? ["REVIEW_ALLERGY"] : [],
        },
      })) })),
    );
    renderRoute("/queue");

    await screen.findByRole("article", { name: /visit-charge/ });
    expect(screen.getByRole("heading", { name: "รอพบแพทย์" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "กำลังตรวจ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "รอทบทวนคำสั่งยา" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "รอจัดยา" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "รอคิดเงิน" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "รอรับชำระ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "พร้อมปิด Visit" })).toBeInTheDocument();
    for (const item of pendingItems.filter((item) => item.visit.status !== "CLOSED")) {
      expect(within(screen.getByRole("article", { name: new RegExp(item.visit.id) })).queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
    }
    expect(within(screen.getByRole("article", { name: /visit-payment/ })).queryByRole("link", { name: "ไปหน้าชำระเงิน" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: /visit-ready/ })).queryByRole("link", { name: "ไปหน้าชำระเงิน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("article", { name: /visit-closed/ })).not.toBeInTheDocument();
  });

  it("uses the Queue revisions and one idempotent attempt for Assistant Allergy review", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const keys: string[] = [];
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.post("/api/patients/patient-42/allergy-revisions", async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return bodies.length === 1 ? HttpResponse.error() : HttpResponse.json({ data: { patient, allergy: waitingItem.allergy, visit: waitingItem.visit }, replayed: true });
      }),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }));
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));
    expect(await screen.findByText("ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({ expectedRevisions: { patient: 3, visit: 7 }, payload: { visitId: "visit-42", state: "UNKNOWN", items: [], sourceText: "ทบทวนข้อมูลแพ้ยา", reason: "ทบทวนก่อนการรักษา" } });
    expect(keys[0]).toMatch(/\S/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("retains Assistant Allergy values but blocks resubmission until a conflict reload", async () => {
    const user = userEvent.setup();
    let queueRequests = 0;
    const refreshed = { ...waitingItem, visit: { ...waitingItem.visit, revision: 8 }, patient: { ...waitingItem.patient, revision: 4 } };
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => {
        queueRequests += 1;
        return HttpResponse.json({ data: [queueRequests === 1 ? waitingItem : refreshed] });
      }),
      http.post("/api/patients/patient-42/allergy-revisions", () => jsonError("REVISION_CONFLICT", "ข้อมูลประวัติแพ้ยาเปลี่ยนแปลงแล้ว", 409)),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }));
    const source = screen.getByLabelText("แหล่งข้อมูล");
    await user.clear(source);
    await user.type(source, "ผู้ช่วยทบทวนจากบัตรแพ้ยา");
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));
    expect((await screen.findAllByText("ข้อมูลประวัติแพ้ยาเปลี่ยนแปลงแล้ว")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "บันทึกการทบทวน" })).toBeDisabled();
    await user.click(within(screen.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" })).getByRole("button", { name: "โหลดข้อมูลล่าสุด" }));
    await waitFor(() => expect(queueRequests).toBeGreaterThanOrEqual(2));
    expect(screen.getByLabelText("แหล่งข้อมูล")).toHaveValue("ผู้ช่วยทบทวนจากบัตรแพ้ยา");
    expect(screen.getByRole("button", { name: "บันทึกการทบทวน" })).toBeEnabled();
  });

  it("invalidates Queue after a successful Assistant Allergy review without fetching Doctor workspace", async () => {
    const user = userEvent.setup();
    let queueRequests = 0;
    let workspaceRequests = 0;
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => { queueRequests += 1; return HttpResponse.json({ data: [waitingItem] }); }),
      http.get("/api/visits/:visitId/workspace", () => { workspaceRequests += 1; return HttpResponse.json({ data: workspace }); }),
      http.post("/api/patients/patient-42/allergy-revisions", () => HttpResponse.json({ data: { patient, allergy: waitingItem.allergy, visit: waitingItem.visit }, replayed: false })),
    );
    renderRoute("/queue");
    await user.click(await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" }));
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));
    await waitFor(() => expect(queueRequests).toBeGreaterThanOrEqual(2));
    expect(workspaceRequests).toBe(0);
  });

  it("routes operational, clinical, and finance states to their truthful workflows", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: pendingItems })));
    renderRoute("/queue");
    for (const item of pendingItems.filter((item) => item.visit.status !== "WAITING" && item.visit.status !== "CLOSED")) {
      const row = within(await screen.findByRole("article", { name: new RegExp(item.visit.id) }));
      if (["AWAITING_PREPARATION", "PREPARING", "AWAITING_RELEASE", "AWAITING_HANDOFF"].includes(item.visit.status)) {
        expect(row.getByRole("link", { name: /การจัดยา|ปล่อยยา|ส่งมอบยา/ })).toHaveAttribute("href", `/dispensing/${item.visit.id}`);
      } else if (["AWAITING_CHARGE", "AWAITING_PAYMENT", "READY_TO_CLOSE"].includes(item.visit.status)) {
        expect(row.getByRole("link", { name: /คิดเงิน|ชำระเงิน/ })).toHaveAttribute("href", `/checkout/${item.visit.id}`);
        expect(row.queryByRole("link", { name: "เปิดห้องตรวจ" })).not.toBeInTheDocument();
      } else {
        expect(row.getByRole("link", { name: "เปิดห้องตรวจ" })).toHaveAttribute("href", `/consultations/${item.visit.id}`);
      }
    }
    expect(screen.queryByRole("article", { name: /visit-closed/ })).not.toBeInTheDocument();
  });

  it("suppresses Assistant Allergy review while cached Queue data is stale", async () => {
    let queueRequests = 0;
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => {
        queueRequests += 1;
        return queueRequests === 1 ? HttpResponse.json({ data: [waitingItem] }) : jsonError("INTERNAL_ERROR", "ระบบคิวไม่พร้อมใช้งาน", 503);
      }),
    );
    renderRoute("/queue");
    await screen.findByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" });
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("กำลังแสดงข้อมูลคิวล่าสุดที่บันทึกไว้", {}, { timeout: 3_000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ทบทวนข้อมูลแพ้ยา" })).not.toBeInTheDocument();
  });

  it("renders the same server row for Assistant and Doctor, but only Doctor gets Start Consultation", async () => {
    const assistantWaitingItem = {
      ...waitingItem,
      journeySummary: { ...waitingJourneySummary, allowedActions: ["REVIEW_ALLERGY"] as const },
    };
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [assistantWaitingItem] })),
    );
    renderRoute("/queue");
    const assistantRow = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(assistantRow).toHaveTextContent("visit-42");
    expect(assistantRow).toHaveTextContent("revision 7");
    expect(assistantRow).toHaveTextContent("รอตรวจ");
    expect(within(assistantRow).queryByRole("button", { name: /เริ่มการตรวจ/ })).not.toBeInTheDocument();
    cleanup();
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("doctor"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [waitingItem] })),
    );
    renderRoute("/queue");
    const doctorRow = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(doctorRow).toHaveTextContent("visit-42");
    expect(doctorRow).toHaveTextContent("revision 7");
    expect(within(doctorRow).getByRole("button", { name: /เริ่มการตรวจ/ })).toBeInTheDocument();
  });

  it("never exposes a consulting-room link to Assistant", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [{ ...consultingItem, journeySummary: { ...consultingJourneySummary, allowedActions: [] } }] })),
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

  it("uses Assistant handoff copy when a cached waiting Queue becomes stale", async () => {
    let queueRequests = 0;
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => {
        queueRequests += 1;
        return queueRequests === 1
          ? HttpResponse.json({ data: [waitingItem] })
          : jsonError("INTERNAL_ERROR", "ระบบคิวไม่พร้อมใช้งาน", 503);
      }),
    );
    renderRoute("/queue");
    await screen.findByRole("article", { name: /DEMO-000042/ });

    window.dispatchEvent(new Event("focus"));

    expect(await screen.findByText("กำลังแสดงข้อมูลคิวล่าสุดที่บันทึกไว้", {}, { timeout: 3_000 })).toBeInTheDocument();
    const row = screen.getByRole("article", { name: /DEMO-000042/ });
    expect(row).toHaveTextContent("กำลังตรวจสอบสิทธิ์ล่าสุดก่อนดำเนินการ");
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

  it("sends the current Queue revision and navigates only after a client-decodable Journey-decorated CONSULTING response", async () => {
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
    await waitFor(() => expect(queueRequests).toBeGreaterThanOrEqual(3), { timeout: 3_000 });
    expect((await screen.findAllByText("ระบบคิวไม่พร้อมใช้งาน")).length).toBeGreaterThan(0);
    expect(screen.getByText("ข้อมูลคิวเปลี่ยนแปลง")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /โหลดข้อมูลล่าสุด/ }));
    await waitFor(() => expect(queueRequests).toBe(4));
    expect(screen.queryByText("ข้อมูลคิวเปลี่ยนแปลงแล้ว")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /เริ่มการตรวจ/ })).toBeEnabled();
  });

  it("renders a Doctor clinical workspace from the committed snapshot with authoring controls", async () => {
    renderRoute("/consultations/visit-42");
    expect(await screen.findByRole("complementary", { name: "บริบทผู้ป่วย" })).toBeInTheDocument();
    expect(screen.getByText("DOCTOR WORKSPACE / งานแพทย์")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ข้อมูล Visit ปัจจุบัน" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Clinical Note" })).toBeInTheDocument();
    expect(screen.getByText(patient.displayName)).toBeInTheDocument();
    expect(screen.getByText(/มีไข้และไอ/)).toBeInTheDocument();
    expect(screen.getAllByText("UNKNOWN").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Subjective (ข้อมูลจากผู้ป่วย)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกร่าง" })).toBeInTheDocument();
  });

  it("directs the Doctor back to Queue when the workspace Visit is still waiting", async () => {
    server.use(
      http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: waitingWorkspace })),
    );
    renderRoute("/consultations/visit-42");

    expect(await screen.findByRole("region", { name: "Clinical Note" })).toBeInTheDocument();
    expect(screen.getAllByText("WAITING").length).toBeGreaterThan(0);
    expect(screen.getByText("ยังไม่เริ่ม")).toBeInTheDocument();
  });

  it("shows arrival and consultation start times for each queue state", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [consultingItem] })));
    renderRoute("/queue");
    const row = await screen.findByRole("article", { name: /DEMO-000042/ });
    expect(within(row).getByText(/มาถึง/)).toBeInTheDocument();
    expect(within(row).getByText(/เริ่มตรวจ/)).toBeInTheDocument();
  });

  it("shows live Overview finance counts alongside the active clinic workflow", async () => {
    renderRoute("/overview");
    expect(await screen.findByRole("heading", { name: "ภาพรวมคลินิก" })).toBeInTheDocument();
    expect((await screen.findAllByText("รอตรวจ")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("กำลังตรวจ")).length).toBeGreaterThan(0);
    expect(screen.getByText("รอรับชำระ")).toBeInTheDocument();
    expect(screen.getByText("พร้อมปิด Visit")).toBeInTheDocument();
    expect(screen.queryByText(/ยังไม่พร้อมใน Pilot/)).not.toBeInTheDocument();
    expect(screen.queryByText(/฿|บาท|คงเหลือ/)).not.toBeInTheDocument();
  });

  it("makes operational Overview rows open the dispensing workflow for either role", async () => {
    const operational = pendingItems.find((item) => item.visit.status === "AWAITING_PREPARATION");
    if (!operational) throw new Error("Missing operational queue fixture");
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [operational] })));
    renderRoute("/overview");
    expect(await screen.findByRole("link", { name: /รอจัดยา/ })).toHaveAttribute("href", `/dispensing/${operational.visit.id}`);

    cleanup();
    server.use(http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))));
    renderRoute("/overview");
    expect(await screen.findByRole("link", { name: /รอจัดยา/ })).toHaveAttribute("href", `/dispensing/${operational.visit.id}`);
  });

  it("keeps Assistant Intake affordances in an empty Overview", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [] })),
    );
    renderRoute("/overview");
    const headerAction = await screen.findByRole("link", { name: "รับผู้ป่วย" });
    expect(headerAction).toHaveAttribute("href", "/intake");
    expect(headerAction.querySelector(".lucide-clipboard-plus")).toBeInTheDocument();

    const overview = screen.getByRole("heading", { name: "ภาพรวมคลินิก" }).closest(".overview-page");
    expect(overview).not.toBeNull();
    const overviewScope = within(overview as HTMLElement);
    expect(overviewScope.getByText("เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว")).toBeInTheDocument();
    const emptyAction = overviewScope.getByRole("link", { name: "รับผู้ป่วยเข้าคิว" });
    expect(emptyAction).toHaveAttribute("href", "/intake");
    expect(emptyAction.querySelector(".lucide-clipboard-plus")).toBeInTheDocument();
  });

  it("uses only Queue affordances in an empty Doctor Overview", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [] })));
    renderRoute("/overview");
    const headerAction = await screen.findByRole("link", { name: "ไปยังคิวตรวจ" });
    expect(headerAction).toHaveAttribute("href", "/queue");
    expect(headerAction.querySelector(".lucide-users-round")).toBeInTheDocument();

    const overview = screen.getByRole("heading", { name: "ภาพรวมคลินิก" }).closest(".overview-page");
    expect(overview).not.toBeNull();
    const overviewScope = within(overview as HTMLElement);
    expect(overviewScope.getByText("เมื่อผู้ช่วยส่งผู้ป่วยเข้าคิว รายการจะแสดงที่นี่")).toBeInTheDocument();
    const emptyAction = overviewScope.getByRole("link", { name: "ดูคิวผู้ป่วย" });
    expect(emptyAction).toHaveAttribute("href", "/queue");
    expect(emptyAction.querySelector(".lucide-users-round")).toBeInTheDocument();
    expect(overviewScope.queryAllByRole("link").some((link) => link.getAttribute("href") === "/intake")).toBe(false);
    expect(overviewScope.queryByText(/รับผู้ป่วย/)).not.toBeInTheDocument();
    expect(overview?.querySelector(".lucide-clipboard-plus")).not.toBeInTheDocument();
  });

  it("keeps Overview intake unavailable while the queue read is pending", async () => {
    let resolveQueue!: (response: Response) => void;
    server.use(http.get("/api/queue", () => new Promise((resolve) => { resolveQueue = resolve; })));
    renderRoute("/overview");
    expect(await screen.findByRole("heading", { name: "ภาพรวมคลินิก" })).toBeInTheDocument();
    expect(await screen.findByText("กำลังโหลดคิวผู้ป่วย")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /รับผู้ป่วย|ไปยังคิวตรวจ/ })).not.toBeInTheDocument();
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

  it("keeps Assistant Intake guidance and CTA in an empty Queue", async () => {
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session("assistant"))),
      http.get("/api/queue", () => HttpResponse.json({ data: [] })),
    );
    renderRoute("/queue");
    const emptyTitle = await screen.findByText("ยังไม่มีผู้ป่วยในคิว");
    const emptyCard = emptyTitle.closest(".queue-empty-card");
    expect(emptyCard).not.toBeNull();
    const emptyScope = within(emptyCard as HTMLElement);
    expect(emptyScope.getByText("เริ่มงานด้วยการรับผู้ป่วยสังเคราะห์เข้าคิว")).toBeInTheDocument();
    expect(emptyScope.getByRole("link", { name: "ไปหน้ารับผู้ป่วย" })).toHaveAttribute("href", "/intake");
  });

  it("renders an explicit unavailable Queue state", async () => {
    server.use(http.get("/api/queue", () => jsonError("INTERNAL_ERROR", "ระบบคิวไม่พร้อมใช้งาน", 503)));
    renderRoute("/queue");
    expect((await screen.findAllByText(/ระบบคิวไม่พร้อมใช้งาน/, {}, { timeout: 3_000 })).length).toBeGreaterThan(0);
  });

  it("omits the Assistant intake CTA from an empty Doctor Queue", async () => {
    server.use(http.get("/api/queue", () => HttpResponse.json({ data: [] })));
    renderRoute("/queue");
    const emptyTitle = await screen.findByText("ยังไม่มีผู้ป่วยในคิว");
    const emptyCard = emptyTitle.closest(".queue-empty-card");
    expect(emptyCard).not.toBeNull();
    const emptyScope = within(emptyCard as HTMLElement);
    expect(emptyScope.getByText("เมื่อผู้ช่วยส่งผู้ป่วยเข้าคิว รายการจะแสดงที่นี่")).toBeInTheDocument();
    expect(emptyScope.queryByRole("link", { name: "ไปหน้ารับผู้ป่วย" })).not.toBeInTheDocument();
    expect(emptyCard as HTMLElement).not.toHaveTextContent("รับผู้ป่วยสังเคราะห์");
  });
});
