import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const session = {
  data: {
    user: { id: "assistant-1", username: "assistant", displayName: "ผู้ช่วยทดสอบ", role: "assistant" as const },
    clinic: { id: "clinic", name: "คลินิกทดสอบ" },
    permissions: ["patient:read", "patient:create-synthetic", "visit:submit-intake", "visit:read-queue"] as const,
    pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
    mustChangePassword: false,
    idleExpiresAt: "2026-08-03T08:00:00.000Z",
  },
};

const patient = {
  id: "patient-1",
  hn: "DEMO-000123",
  displayName: "ผู้ป่วยทดสอบ 000123",
  phone: "0000000123",
  birthDate: "1990-01-01",
  sex: "unknown" as const,
  revision: 4,
  createdAt: "2026-08-03T00:00:00.000Z",
};

const intakeResponse = {
  data: {
    visit: {
      id: "visit-1",
      status: "WAITING" as const,
      revision: 1,
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
    chiefComplaint: "ไอ",
    vitals: {
      weightKg: null,
      heightCm: null,
      temperatureC: 37.5,
      systolicMmhg: null,
      diastolicMmhg: null,
      heartRateBpm: null,
      spo2Percent: null,
    },
    allowedActions: [],
  },
  replayed: false,
};

const server = setupServer();

function jsonError(code: string, messageTh: string, status: number, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "request-1", ...extra } }, { status });
}

function renderIntake() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/intake"] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

function validPatientSearch() {
  return http.get("/api/patients/search", () => HttpResponse.json({ data: [patient] }));
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  server.resetHandlers(
    http.get("/api/auth/session", () => HttpResponse.json(session)),
    http.get("/api/patients/search", () => HttpResponse.json({ data: [] })),
    http.get("/api/queue", () => HttpResponse.json({ data: [] })),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("connected Intake journey", () => {
  it("searches, selects an existing Patient, and navigates only after a committed 201", async () => {
    const user = userEvent.setup();
    let intakeRequests = 0;
    let intakeBody: unknown;
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", async ({ request }) => {
        intakeRequests += 1;
        intakeBody = await request.json();
        return HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();

    const search = await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ });
    await user.type(search, "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    expect(screen.getByText(new RegExp(`HN ${patient.hn}`))).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");

    expect(router.state.location.pathname).toBe("/intake");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(intakeRequests).toBe(1);
    expect(intakeBody).toEqual({
      expectedRevisions: { patient: patient.revision },
      payload: {
        patientId: patient.id,
        chiefComplaint: "ไอ",
        vitals: {
          weightKg: null,
          heightCm: null,
          temperatureC: null,
          systolicMmhg: null,
          diastolicMmhg: null,
          heartRateBpm: null,
          spo2Percent: null,
        },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });

  it("creates a synthetic Patient with an empty payload and exposes no identity inputs", async () => {
    const user = userEvent.setup();
    let generationBody: unknown;
    server.use(
      http.post("/api/patients/synthetic", async ({ request }) => {
        generationBody = await request.json();
        return HttpResponse.json({ data: patient, replayed: false }, { status: 201 });
      }),
    );
    renderIntake();

    expect(screen.queryByLabelText(/ชื่อ|นามสกุล|เบอร์โทร|อายุ|เพศ/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    expect(generationBody).toEqual({ expectedRevisions: {}, payload: {} });
  });

  it("keeps the selected Patient and draft when Intake fails, then retries with one key", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let attempts = 0;
    server.use(
      http.post("/api/patients/synthetic", () => HttpResponse.json({ data: patient, replayed: false }, { status: 201 })),
      http.post("/api/visits/intake", ({ request }) => {
        attempts += 1;
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return attempts === 1
          ? jsonError("INTERNAL_ERROR", "ระบบไม่พร้อมใช้งาน", 503)
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();
    await user.click(await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอเรื้อรัง");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByText("ยังบันทึกไม่ได้")).toBeInTheDocument());
    expect(complaint).toHaveValue("ไอเรื้อรัง");
    await user.click(screen.getByRole("button", { name: /ลองบันทึกอีกครั้ง|ลองใหม่/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("shows 422 field and summary errors, focuses the first invalid field, and preserves the route", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => jsonError("VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูล", 422, {
        fieldErrors: {
          "payload.chiefComplaint": "กรุณาระบุอาการสำคัญ",
          "payload.vitals.temperatureC": "อุณหภูมิไม่ถูกต้อง",
        },
      })),
    );
    const router = renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("กรุณาตรวจสอบข้อมูล"));
    expect(router.state.location.pathname).toBe("/intake");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /อาการสำคัญ/ })).toHaveFocus());
    expect(screen.getByText("กรุณาระบุอาการสำคัญ")).toBeInTheDocument();
  });

  it("keeps the draft and offers a Queue recovery link for an active visit", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => jsonError("ACTIVE_VISIT_EXISTS", "ผู้ป่วยมีคิวที่กำลังดำเนินการ", 409)),
    );
    renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByRole("link", { name: "โหลดคิวล่าสุด" })).toBeInTheDocument());
    expect(complaint).toHaveValue("ไอ");
    expect(screen.getByRole("link", { name: "โหลดคิวล่าสุด" })).toHaveAttribute("href", "/queue");
  });

  it("does not claim success or write browser storage before the server commits", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => new Promise((resolve) => { resolveRequest = resolve; })),
    );
    const router = renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.type(await screen.findByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(screen.queryByText(/ส่งเข้าคิวแล้ว|บันทึกสำเร็จ/)).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    resolveRequest(new Response(JSON.stringify(intakeResponse), { status: 201 }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });
});
