import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const patient = { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยสังเคราะห์ 000042", phone: "0000000042", birthDate: "1990-01-01", sex: "unknown" as const, revision: 3, createdAt: "2026-08-03T00:00:00.000Z" };
const visit = { id: "visit-42", status: "CONSULTING" as const, revision: 8, arrivedAt: "2026-08-03T01:00:00.000Z", startedAt: "2026-08-03T01:15:00.000Z" };
const workspace = {
  visit, patient,
  intake: { id: "intake-42", chiefComplaint: "มีไข้และไอ", vitals: { weightKg: 64.5, heightCm: 168, temperatureC: 38.2, systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 90, spo2Percent: 98 }, recordedAt: "2026-08-03T01:02:00.000Z", recordedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" } },
  patientSnapshot: { allergy: { id: null, revision: 0, state: "UNKNOWN" as const, items: [], sourceText: null, reason: null, reviewedBy: null, reviewedAt: null }, activeProblems: { state: "UNKNOWN" as const, value: null, source: null }, currentMedicationContext: { state: "UNKNOWN" as const, value: null, source: null }, latestRelevantPlan: { state: "UNKNOWN" as const, value: null, source: null }, pendingFollowUp: { state: "UNKNOWN" as const, value: null, source: null }, recentVisits: [] },
  consultationDraft: { note: null, medicationDecision: null }, signedClinicalNote: null, amendments: [], medicationDecision: null,
  allowedActions: ["SAVE_DRAFT", "FINALIZE_CONSULTATION", "REVIEW_ALLERGY"] as const,
};
const doctorSession = { data: { user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" }, clinic: { id: "clinic", name: "คลินิกทดสอบ" }, permissions: ["patient:read", "visit:read-queue", "visit:start-consultation", "clinical:read", "clinical:save-draft", "clinical:sign", "clinical:amend", "patient:update-allergy", "medication:read-catalog", "medication:sign-decision"], pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z", mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() } };
const server = setupServer();
function QueryClientCapture({ capture }: { capture: (client: QueryClient) => void }) { capture(useQueryClient()); return null; }
function renderRoute(path = "/consultations/visit-42", capture?: (client: QueryClient) => void) { const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); render(<AppProviders>{capture ? <QueryClientCapture capture={capture} /> : null}<RouterProvider router={router} /></AppProviders>); return router; }

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => server.resetHandlers(
  http.get("/api/auth/session", () => HttpResponse.json(doctorSession)),
  http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: workspace })),
  http.get("/api/queue", () => HttpResponse.json({ data: [] })),
  http.get("/api/dashboard/today", () => HttpResponse.json({ data: { waiting: 0, consulting: 1, updatedAt: "2026-08-03T01:00:00.000Z" } })),
));
afterEach(() => { cleanup(); vi.restoreAllMocks(); server.resetHandlers(); });
afterAll(() => server.close());

describe("Doctor consultation authoring", () => {
  it("renders UNKNOWN Allergy and four labeled SOAP fields", async () => {
    renderRoute();
    expect((await screen.findAllByText("UNKNOWN")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Subjective (ข้อมูลจากผู้ป่วย)")).toBeInTheDocument();
    expect(screen.getByLabelText("Objective (ผลตรวจ)")).toBeInTheDocument();
    expect(screen.getByLabelText("Assessment (การประเมิน)")).toBeInTheDocument();
    expect(screen.getByLabelText("Plan (แผนการดูแล)")).toBeInTheDocument();
  });

  it("keeps every recorded intake vital visible to the doctor", async () => {
    renderRoute();
    const visitPanel = await screen.findByRole("region", { name: "ข้อมูล Visit ปัจจุบัน" });
    expect(visitPanel).toHaveTextContent("อุณหภูมิ 38.2 °C");
    expect(visitPanel).toHaveTextContent("ความดัน 120/80");
    expect(visitPanel).toHaveTextContent("ชีพจร 90 ครั้ง/นาที");
    expect(visitPanel).toHaveTextContent("SpO₂ 98%");
    expect(visitPanel).toHaveTextContent("น้ำหนัก 64.5 กก.");
    expect(visitPanel).toHaveTextContent("ส่วนสูง 168 ซม.");
  });

  it("keeps unsaved note text when refreshed patient context changes", async () => {
    const user = userEvent.setup();
    let currentWorkspace = workspace;
    let workspaceRequests = 0;
    server.use(http.get("/api/visits/visit-42/workspace", () => {
      workspaceRequests += 1;
      return HttpResponse.json({ data: currentWorkspace });
    }));
    renderRoute();
    const subjective = await screen.findByLabelText("Subjective (ข้อมูลจากผู้ป่วย)");
    await user.type(subjective, "ข้อความที่ยังไม่บันทึก");

    currentWorkspace = {
      ...workspace,
      patient: { ...patient, displayName: "ผู้ป่วยสังเคราะห์ที่ปรับข้อมูลแล้ว", revision: 4 },
    };
    act(() => window.dispatchEvent(new Event("focus")));

    expect(await screen.findByText("ผู้ป่วยสังเคราะห์ที่ปรับข้อมูลแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(workspaceRequests).toBeGreaterThan(1));
    expect(subjective).toHaveValue("ข้อความที่ยังไม่บันทึก");
  });

  it("retains local note text and reports conflict when a remote draft changes", async () => {
    const user = userEvent.setup();
    let savedBody: unknown;
    const noteDraft = {
      id: "note-draft", visitId: visit.id, revision: 1,
      subjective: "ต้นฉบับ", objective: "", assessment: "", plan: "", diagnoses: [],
      updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:00:00.000Z",
    };
    let currentWorkspace = { ...workspace, consultationDraft: { note: noteDraft, medicationDecision: null } };
    let workspaceRequests = 0;
    server.use(
      http.get("/api/visits/visit-42/workspace", () => {
        workspaceRequests += 1;
        return HttpResponse.json({ data: currentWorkspace });
      }),
      http.post("/api/visits/visit-42/consultation-draft", async ({ request }) => {
        savedBody = await request.json();
        return HttpResponse.json({
          data: {
            note: { ...noteDraft, revision: 3, subjective: "ต้นฉบับที่แก้ในเครื่อง", updatedAt: "2026-08-03T02:10:00.000Z" },
            medicationDecision: {
              id: "med-draft", visitId: visit.id, revision: 1, kind: "UNDECIDED", noMedicationReason: null, items: [],
              updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:10:00.000Z",
            },
          },
          replayed: false,
        });
      }),
    );
    renderRoute();
    const subjective = await screen.findByDisplayValue("ต้นฉบับ");
    await user.type(subjective, "ที่แก้ในเครื่อง");

    currentWorkspace = {
      ...currentWorkspace,
      consultationDraft: {
        ...currentWorkspace.consultationDraft,
        note: { ...noteDraft, revision: 2, subjective: "ร่างจากอีกหน้าจอ", updatedAt: "2026-08-03T02:05:00.000Z" },
      },
    };
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(workspaceRequests).toBeGreaterThan(1));
    expect(subjective).toHaveValue("ต้นฉบับที่แก้ในเครื่อง");
    expect(await screen.findByText(/ข้อมูลเวอร์ชันปัจจุบันเปลี่ยนแปลงแล้ว/)).toBeInTheDocument();

    const requestsBeforeReload = workspaceRequests;
    await user.click(screen.getByRole("button", { name: "โหลดข้อมูลล่าสุด" }));
    await waitFor(() => expect(workspaceRequests).toBeGreaterThan(requestsBeforeReload));
    expect(subjective).toHaveValue("ต้นฉบับที่แก้ในเครื่อง");
    expect(screen.queryByText(/ข้อมูลเวอร์ชันปัจจุบันเปลี่ยนแปลงแล้ว/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    await waitFor(() => expect(savedBody).toMatchObject({
      expectedRevisions: { visit: 8, noteDraft: 2, medicationDraft: 0 },
      payload: { note: { subjective: "ต้นฉบับที่แก้ในเครื่อง" }, medicationDecision: { kind: "UNDECIDED" } },
    }));
  });

  it("warns on a stale workspace, blocks commands, and recovers without losing text", async () => {
    const user = userEvent.setup();
    let workspaceRequests = 0;
    let failRefresh = true;
    let queryClient: QueryClient | null = null;
    server.use(http.get("/api/visits/visit-42/workspace", () => {
      workspaceRequests += 1;
      if (workspaceRequests > 1 && failRefresh) return HttpResponse.error();
      return HttpResponse.json({ data: workspace });
    }));
    renderRoute("/consultations/visit-42", (client) => { queryClient = client; });
    const subjective = await screen.findByLabelText("Subjective (ข้อมูลจากผู้ป่วย)");
    await user.type(subjective, "ข้อความระหว่างสัญญาณขาดหาย");
    if (!queryClient) throw new Error("missing query client");
    await act(async () => { await queryClient!.refetchQueries({ queryKey: ["visit", "visit-42"] }); });

    expect(await screen.findByText(/ข้อมูลห้องตรวจอาจไม่เป็นปัจจุบัน/)).toBeInTheDocument();
    expect(subjective).toHaveValue("ข้อความระหว่างสัญญาณขาดหาย");
    expect(screen.getByRole("button", { name: "บันทึกร่าง" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ทบทวนประวัติแพ้" })).toBeDisabled();

    failRefresh = false;
    await user.click(screen.getByRole("button", { name: "โหลดข้อมูลล่าสุด" }));
    await waitFor(() => expect(workspaceRequests).toBeGreaterThan(2));
    await waitFor(() => expect(screen.queryByText(/ข้อมูลห้องตรวจอาจไม่เป็นปัจจุบัน/)).not.toBeInTheDocument());
    expect(subjective).toHaveValue("ข้อความระหว่างสัญญาณขาดหาย");
    expect(screen.getByRole("button", { name: "บันทึกร่าง" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ทบทวนประวัติแพ้" })).toBeEnabled();
  });

  it("renders the complete source-linked patient snapshot, including UNKNOWN facts", async () => {
    const snapshotWorkspace = {
      ...workspace,
      patientSnapshot: {
        allergy: {
          id: "allergy-1", revision: 2, state: "PRESENT" as const,
          items: [{ substance: "เพนิซิลลิน", reaction: "ผื่น", severity: "MILD" as const, note: "พกบัตรแพ้ยา" }],
          sourceText: "ผู้ป่วยแจ้งประวัติ", reason: "ทบทวนก่อนตรวจ",
          reviewedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, reviewedAt: "2026-08-03T01:30:00.000Z",
        },
        activeProblems: { state: "VALUE" as const, value: ["ไข้หวัด"], source: { type: "CLINICAL_NOTE" as const, id: "note-previous", occurredAt: "2026-08-02T08:00:00.000Z" } },
        currentMedicationContext: { state: "VALUE" as const, value: ["พาราเซตามอล 500 mg"], source: { type: "MEDICATION_DECISION" as const, id: "decision-previous", occurredAt: "2026-08-02T08:05:00.000Z" } },
        latestRelevantPlan: { state: "VALUE" as const, value: "ติดตามอาการใน 7 วัน", source: { type: "CLINICAL_NOTE" as const, id: "note-previous", occurredAt: "2026-08-02T08:00:00.000Z" } },
        pendingFollowUp: { state: "UNKNOWN" as const, value: null, source: null },
        recentVisits: [{ visitId: "visit-previous", noteId: "note-previous", signedAt: "2026-08-02T08:00:00.000Z", diagnoses: ["ไข้หวัด"], plan: "ติดตามอาการใน 7 วัน" }],
      },
    };
    server.use(http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: snapshotWorkspace })));

    renderRoute();

    const snapshot = await screen.findByRole("region", { name: "Patient Snapshot" });
    expect(snapshot).toHaveTextContent("ประวัติแพ้ยา");
    expect(snapshot).toHaveTextContent("เพนิซิลลิน");
    expect(snapshot).toHaveTextContent("ความรุนแรง MILD");
    expect(snapshot).toHaveTextContent("หมายเหตุ พกบัตรแพ้ยา");
    expect(snapshot).toHaveTextContent("ผู้ให้ข้อมูล ผู้ป่วยแจ้งประวัติ");
    expect(snapshot).toHaveTextContent("เหตุผล ทบทวนก่อนตรวจ");
    expect(snapshot).toHaveTextContent("ผู้ทบทวน พญ. ทดสอบ");
    expect(snapshot).toHaveTextContent("ALLERGY_REVIEW · ID allergy-1");
    expect(snapshot).toHaveTextContent("ปัญหาสำคัญ");
    expect(snapshot).toHaveTextContent("ไข้หวัด");
    expect(snapshot).toHaveTextContent("บริบทยาปัจจุบัน");
    expect(snapshot).toHaveTextContent("พาราเซตามอล 500 mg");
    expect(snapshot).toHaveTextContent("แผนล่าสุดที่เกี่ยวข้อง");
    expect(snapshot).toHaveTextContent("ติดตามอาการใน 7 วัน");
    expect(snapshot).toHaveTextContent("ติดตามต่อไป");
    expect(snapshot).toHaveTextContent("UNKNOWN");
    expect(snapshot).toHaveTextContent("CLINICAL_NOTE");
    expect(snapshot).toHaveTextContent("note-previous");
    expect(snapshot).toHaveTextContent("MEDICATION_DECISION");
    expect(snapshot).toHaveTextContent("decision-previous");
    expect(snapshot).toHaveTextContent("2 สิงหาคม 2569 เวลา 15:00");
    expect(snapshot).toHaveTextContent("Visit visit-previous");
    expect(snapshot).toHaveTextContent("Clinical Note source");
  });

  it("shows Allergy conflicts in the Doctor dialog and reloads without losing values", async () => {
    const user = userEvent.setup();
    let workspaceRequests = 0;
    const refreshedWorkspace = { ...workspace, patient: { ...patient, revision: 4 }, visit: { ...visit, revision: 9 } };
    server.use(
      http.get("/api/visits/visit-42/workspace", () => {
        workspaceRequests += 1;
        return HttpResponse.json({ data: workspaceRequests === 1 ? workspace : refreshedWorkspace });
      }),
      http.post("/api/patients/patient-42/allergy-revisions", () => HttpResponse.json({
        error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูลประวัติแพ้ยาเปลี่ยนแปลงแล้ว", requestId: "request-allergy" },
      }, { status: 409 })),
    );
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "ทบทวนประวัติแพ้" }));
    const source = screen.getByLabelText("แหล่งข้อมูล");
    await user.clear(source);
    await user.type(source, "ข้อมูลจากบัตรแพ้ยาฉบับล่าสุด");
    await user.click(screen.getByRole("button", { name: "บันทึกการทบทวน" }));

    expect(await screen.findByText("ข้อมูลประวัติแพ้ยาเปลี่ยนแปลงแล้ว")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "ทบทวนประวัติแพ้ยา" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("แหล่งข้อมูล")).toHaveValue("ข้อมูลจากบัตรแพ้ยาฉบับล่าสุด");
    expect(screen.getByRole("button", { name: "บันทึกการทบทวน" })).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "โหลดข้อมูลล่าสุด" }));
    await waitFor(() => expect(workspaceRequests).toBeGreaterThan(1));
    expect(screen.getByLabelText("แหล่งข้อมูล")).toHaveValue("ข้อมูลจากบัตรแพ้ยาฉบับล่าสุด");
    expect(screen.getByRole("button", { name: "บันทึกการทบทวน" })).toBeEnabled();
  });

  it("requires an explicit medication decision and saves a selected catalog order", async () => {
    const user = userEvent.setup(); let body: unknown;
    server.use(
      http.get("/api/medications", () => HttpResponse.json({ data: [{ id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "tablet", canonicalUnit: "tablet", revision: 2 }] })),
      http.post("/api/visits/visit-42/consultation-draft", async ({ request }) => { body = await request.json(); return HttpResponse.json({ data: { note: { id: "note-draft", visitId: visit.id, revision: 1, subjective: "ไข้", objective: "38.2", assessment: "ไข้หวัด", plan: "พักผ่อน", diagnoses: ["ไข้หวัด"], updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:00:00.000Z" }, medicationDecision: { id: "med-draft", visitId: visit.id, revision: 1, kind: "ORDER", noMedicationReason: null, items: [{ medication: { id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "tablet", canonicalUnit: "tablet", revision: 2 }, quantity: 10, directionsTh: "รับประทานหลังอาหาร" }], updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:00:00.000Z" } }, replayed: false }); }),
    );
    renderRoute();
    await user.type(await screen.findByLabelText("Subjective (ข้อมูลจากผู้ป่วย)"), "ไข้");
    await user.type(screen.getByLabelText("Assessment (การประเมิน)"), "ไข้หวัด");
    await user.type(screen.getByLabelText("Plan (แผนการดูแล)"), "พักผ่อน");
    await user.type(screen.getByLabelText("การวินิจฉัย"), "ไข้หวัด");
    await user.click(screen.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" }));
    await user.type(screen.getByLabelText("ค้นหารายการยา"), "พารา");
    await user.click(await screen.findByRole("button", { name: /เลือก พาราเซตามอล/ }));
    await user.clear(screen.getByLabelText("จำนวน")); await user.type(screen.getByLabelText("จำนวน"), "10");
    await user.type(screen.getByLabelText("วิธีใช้ยา"), "รับประทานหลังอาหาร");
    await user.click(screen.getByRole("button", { name: "บันทึกร่าง" }));
    await waitFor(() => expect(body).toMatchObject({ payload: { medicationDecision: { kind: "ORDER", items: [{ medicationId: "DEMO-MED-001", medicationRevision: 2, quantity: 10 }] } } }));
  });

  it("maps server fieldErrors into the Note and medication editors", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/visits/visit-42/consultation-draft", () => HttpResponse.json({
        error: {
          code: "VALIDATION_FAILED", messageTh: "ข้อมูลไม่ถูกต้อง", requestId: "request-1",
          fieldErrors: {
            "payload.note.subjective": "กรุณาระบุข้อมูลจากผู้ป่วย",
            "payload.medicationDecision.noMedicationReason": "กรุณาระบุเหตุผลที่ไม่สั่งยา",
          },
        },
      }, { status: 422 })),
    );
    renderRoute();
    await user.type(await screen.findByLabelText("Subjective (ข้อมูลจากผู้ป่วย)"), "อาการ");
    await user.type(screen.getByLabelText("Objective (ผลตรวจ)"), "ผลตรวจ");
    await user.type(screen.getByLabelText("Assessment (การประเมิน)"), "ประเมิน");
    await user.type(screen.getByLabelText("Plan (แผนการดูแล)"), "แผน");
    await user.type(screen.getByLabelText("การวินิจฉัย"), "โรคทดสอบ");
    await user.click(screen.getByRole("button", { name: "ไม่สั่งยา" }));
    await user.type(screen.getByLabelText("เหตุผลที่ไม่สั่งยา"), "เหตุผล");
    await user.click(screen.getByRole("button", { name: "บันทึกร่าง" }));

    expect(await screen.findByText("กรุณาระบุข้อมูลจากผู้ป่วย")).toBeInTheDocument();
    expect(screen.getByText("กรุณาระบุเหตุผลที่ไม่สั่งยา")).toBeInTheDocument();
  });

  it("offers an explicit catalog-backed ORDER revision for signed evidence", async () => {
    const user = userEvent.setup();
    const medication = { id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "tablet", canonicalUnit: "tablet", revision: 2 };
    const signedWorkspace = {
      ...workspace,
      visit: { ...visit, status: "AWAITING_ORDER_REVISION" as const, revision: 9 },
      signedClinicalNote: { id: "note-1", visitId: visit.id, version: 1, subjective: "ไข้", objective: "38.2", assessment: "ไข้หวัด", plan: "พักผ่อน", diagnoses: ["ไข้หวัด"], sourceDraftRevision: 1, revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, signedAt: "2026-08-03T02:00:00.000Z", contentHash: "a".repeat(64) },
      medicationDecision: { id: "decision-1", visitId: visit.id, version: 1, kind: "ORDER" as const, noMedicationReason: null, items: [{ ...medication, quantity: 10, directionsTh: "รับประทานหลังอาหาร" }], revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, signedAt: "2026-08-03T02:00:00.000Z", contentHash: "b".repeat(64) },
      allowedActions: ["AMEND_NOTE", "REVISE_MEDICATION_DECISION"] as const,
    };
    server.use(
      http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: signedWorkspace })),
      http.get("/api/medications", () => HttpResponse.json({ data: [medication] })),
    );
    renderRoute();
    const noteEvidence = await screen.findByLabelText("หลักฐาน Clinical Note ที่ลงนาม");
    const decisionEvidence = screen.getByLabelText("หลักฐานการตัดสินใจยา ที่ลงนาม");
    expect(noteEvidence).toHaveTextContent("พญ. ทดสอบ");
    expect(noteEvidence).toHaveTextContent("a".repeat(64));
    expect(decisionEvidence).toHaveTextContent("พญ. ทดสอบ");
    expect(decisionEvidence).toHaveTextContent("b".repeat(64));
    await user.click(await screen.findByRole("button", { name: "แก้ไขการตัดสินใจยา" }));
    expect(screen.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไม่สั่งยา" })).toBeInTheDocument();
  });

  it.each([
    ["AWAITING_PREPARATION", "ไปหน้าจัดยา (ยังไม่พร้อม)", "/dispensing/visit-42", "จัดยา"],
    ["AWAITING_CHARGE", "ไปหน้าชำระเงิน (ยังไม่พร้อม)", "/checkout/visit-42", "ชำระเงิน"],
  ] as const)("offers truthful next-step navigation for %s", async (status, linkName, href, unavailableTitle) => {
    const signedWorkspace = {
      ...workspace,
      visit: { ...visit, status, revision: 9 },
      signedClinicalNote: { id: "note-1", visitId: visit.id, version: 1, subjective: "ไข้", objective: "38.2", assessment: "ไข้หวัด", plan: "พักผ่อน", diagnoses: ["ไข้หวัด"], sourceDraftRevision: 1, revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, signedAt: "2026-08-03T02:00:00.000Z", contentHash: "a".repeat(64) },
      medicationDecision: { id: "decision-1", visitId: visit.id, version: 1, kind: status === "AWAITING_PREPARATION" ? "ORDER" as const : "NO_MEDICATION" as const, noMedicationReason: status === "AWAITING_CHARGE" ? "ไม่จำเป็นต้องใช้ยา" : null, items: status === "AWAITING_PREPARATION" ? [{ id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "tablet", canonicalUnit: "tablet", revision: 1, quantity: 10, directionsTh: "รับประทานหลังอาหาร" }] : [], revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, signedAt: "2026-08-03T02:00:00.000Z", contentHash: "b".repeat(64) },
      allowedActions: ["AMEND_NOTE", "REVISE_MEDICATION_DECISION"] as const,
    };
    server.use(http.get("/api/visits/visit-42/workspace", () => HttpResponse.json({ data: signedWorkspace })));
    const router = renderRoute();
    const link = await screen.findByRole("link", { name: linkName });
    expect(link).toHaveAttribute("href", href);
    await userEvent.setup().click(link);
    expect(await screen.findByRole("heading", { name: unavailableTitle })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(href);
    expect(screen.getByText("ส่วนนี้ยังไม่เปิดใช้ใน Pilot milestone ปัจจุบัน")).toBeInTheDocument();
  });

  it("saves an UNDECIDED consultation draft without writing browser storage", async () => {
    const user = userEvent.setup();
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    let body: unknown;
    server.use(http.post("/api/visits/visit-42/consultation-draft", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({
        data: {
          note: {
            id: "note-draft", visitId: visit.id, revision: 1,
            subjective: "", objective: "", assessment: "", plan: "", diagnoses: [],
            updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:00:00.000Z",
          },
          medicationDecision: {
            id: "med-draft", visitId: visit.id, revision: 1, kind: "UNDECIDED", noMedicationReason: null, items: [],
            updatedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, updatedAt: "2026-08-03T02:00:00.000Z",
          },
        },
        replayed: false,
      });
    }));
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "ลบการวินิจฉัย 1" }));
    const saveDraft = screen.getByRole("button", { name: "บันทึกร่าง" });
    expect(saveDraft).toBeEnabled();
    await user.click(saveDraft);
    await waitFor(() => expect(body).toMatchObject({
      expectedRevisions: { visit: 8, noteDraft: 0, medicationDraft: 0 },
      payload: {
        note: { subjective: "", objective: "", assessment: "", plan: "", diagnoses: [] },
        medicationDecision: { kind: "UNDECIDED" },
      },
    }));
    expect(localWrite).not.toHaveBeenCalled();
  });
});
