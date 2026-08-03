import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const patient = { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยสังเคราะห์ 000042", phone: "0000000042", birthDate: "1990-01-01", sex: "unknown" as const, revision: 3, createdAt: "2026-08-03T00:00:00.000Z" };
const visit = { id: "visit-42", status: "CONSULTING" as const, revision: 8, arrivedAt: "2026-08-03T01:00:00.000Z", startedAt: "2026-08-03T01:15:00.000Z" };
const workspace = {
  visit, patient,
  intake: { id: "intake-42", chiefComplaint: "มีไข้และไอ", vitals: { weightKg: null, heightCm: null, temperatureC: 38.2, systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 90, spo2Percent: 98 }, recordedAt: "2026-08-03T01:02:00.000Z", recordedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" } },
  patientSnapshot: { allergy: { id: null, revision: 0, state: "UNKNOWN" as const, items: [], sourceText: null, reason: null, reviewedBy: null, reviewedAt: null }, activeProblems: { state: "UNKNOWN" as const, value: null, source: null }, currentMedicationContext: { state: "UNKNOWN" as const, value: null, source: null }, latestRelevantPlan: { state: "UNKNOWN" as const, value: null, source: null }, pendingFollowUp: { state: "UNKNOWN" as const, value: null, source: null }, recentVisits: [] },
  consultationDraft: { note: null, medicationDecision: null }, signedClinicalNote: null, amendments: [], medicationDecision: null,
  allowedActions: ["SAVE_DRAFT", "FINALIZE_CONSULTATION", "REVIEW_ALLERGY"] as const,
};
const doctorSession = { data: { user: { id: "doctor-1", username: "doctor", displayName: "พญ. ทดสอบ", role: "doctor" }, clinic: { id: "clinic", name: "คลินิกทดสอบ" }, permissions: ["patient:read", "visit:read-queue", "visit:start-consultation", "clinical:read", "clinical:save-draft", "clinical:sign", "clinical:amend", "patient:update-allergy", "medication:read-catalog", "medication:sign-decision"], pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z", mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() } };
const server = setupServer();
function renderRoute(path = "/consultations/visit-42") { const router = createMemoryRouter(appRoutes, { initialEntries: [path] }); render(<AppProviders><RouterProvider router={router} /></AppProviders>); return router; }

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
    expect(await screen.findByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByLabelText("Subjective (ข้อมูลจากผู้ป่วย)")).toBeInTheDocument();
    expect(screen.getByLabelText("Objective (ผลตรวจ)")).toBeInTheDocument();
    expect(screen.getByLabelText("Assessment (การประเมิน)")).toBeInTheDocument();
    expect(screen.getByLabelText("Plan (แผนการดูแล)")).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "แก้ไขการตัดสินใจยา" }));
    expect(screen.getByRole("button", { name: "สั่งยาจากรายการทดสอบ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ไม่สั่งยา" })).toBeInTheDocument();
  });

  it("keeps an incomplete medication decision local and writes no browser storage", async () => {
    const user = userEvent.setup();
    const localWrite = vi.spyOn(Storage.prototype, "setItem");
    renderRoute();
    await user.click(await screen.findByRole("button", { name: "สั่งยาจากรายการทดสอบ" }));
    expect(screen.getByRole("button", { name: "บันทึกร่าง" })).toBeDisabled();
    expect(screen.getByText("กรุณาระบุรายการยาและวิธีใช้ หรือเหตุผลที่ไม่สั่งยา")).toBeInTheDocument();
    expect(localWrite).not.toHaveBeenCalled();
  });
});
