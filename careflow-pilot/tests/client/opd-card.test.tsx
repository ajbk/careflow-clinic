import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const NOW = "2026-08-10T00:00:00.000Z";
const HASH = "a".repeat(64);
const server = setupServer();

const card = {
  syntheticOnly: true,
  closure: {
    id: "closure-42",
    visitId: "visit-42",
    visitRevision: 9,
    chargeId: "charge-42",
    resolution: { kind: "PAYMENT", paymentId: "payment-42" },
    clinic: { id: "clinic", name: "คลินิกชนบท CareFlow Pilot" },
    patient: { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยทดสอบ 000042", birthDate: "1990-01-01", sex: "unknown" },
    doctor: { id: "doctor-1", displayName: "พญ. หลักฐาน" },
    closedAt: NOW,
    contentHash: HASH,
    visit: { id: "visit-42", status: "CLOSED", revision: 10, arrivedAt: NOW, startedAt: NOW, closedAt: NOW },
  },
  visit: {
    id: "visit-42", chiefComplaint: "ปวดศีรษะ", arrivedAt: NOW, startedAt: NOW, closedAt: NOW,
    vitals: { weightKg: 60, heightCm: 160, temperatureC: 36.5, systolicMmhg: 120, diastolicMmhg: 80, heartRateBpm: 72, spo2Percent: 99 },
  },
  clinicalNote: {
    id: "note-42", visitId: "visit-42", version: 1, subjective: "S: ปวดศีรษะ", objective: "O: ปกติ",
    assessment: "A: ปวดศีรษะจากความเครียด", plan: "P: พักผ่อน", diagnoses: ["ปวดศีรษะ"], sourceDraftRevision: 1,
    revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. หลักฐาน" }, signedAt: NOW, contentHash: HASH,
  },
  amendments: [{
    id: "amendment-42", clinicalNoteId: "note-42", version: 1, content: "ติดตามอาการ", reason: "เพิ่มคำแนะนำ",
    signedBy: { id: "doctor-1", displayName: "พญ. หลักฐาน" }, signedAt: NOW, contentHash: "b".repeat(64),
  }],
  medication: {
    kind: "NO_MEDICATION", decision: { id: "decision-42", version: 1, signedAt: NOW, contentHash: "c".repeat(64) },
    noMedicationReason: "ไม่มีข้อบ่งใช้ยา", items: [],
  },
  charge: {
    id: "charge-42", sourceKind: "NO_MEDICATION", currency: "THB",
    lines: [{ id: "line-42", position: 0, lineType: "CONSULTATION", descriptionSnapshot: "ค่าตรวจ", quantity: 1, unitPriceBaht: 100, lineTotalBaht: 100, medicationOrderItemId: null, fulfillmentDispenseLineId: null }],
    grossTotalBaht: 100, adjustmentTotalBaht: 0, netDueBaht: 100,
    resolution: { kind: "PAYMENT", paymentId: "payment-42", method: "CASH", amountBaht: 100, manualReference: null, confirmedBy: { id: "assistant-1", displayName: "ผู้ช่วยการเงิน" }, confirmedAt: NOW, contentHash: "d".repeat(64) },
    contentHash: "e".repeat(64),
  },
};

function session(role: "assistant" | "doctor", permissions: string[]) {
  return {
    data: {
      user: { id: `${role}-1`, username: role, displayName: role === "doctor" ? "พญ. หลักฐาน" : "ผู้ช่วยการเงิน", role },
      clinic: { id: "clinic", name: "คลินิกชนบท CareFlow Pilot" },
      permissions,
      pilotAcknowledgedAt: NOW,
      mustChangePassword: false,
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function renderOpd(role: "assistant" | "doctor", permissions: string[]) {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role, permissions))));
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/visits/visit-42/opd-card"] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return router;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  server.resetHandlers(http.get("/api/visits/visit-42/opd-card", () => HttpResponse.json({ data: card })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  server.resetHandlers();
});
afterAll(() => server.close());

describe("Doctor-only A4 OPD Card", () => {
  it("renders a structured Thai synthetic OPD Card and only prints the document area", async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    renderOpd("doctor", ["opd:read", "finance:read", "visit:close"]);

    expect(await screen.findByText("PILOT — ข้อมูลสังเคราะห์เท่านั้น ห้ามใช้รักษาจริง")).toBeInTheDocument();
    expect(screen.getByText("คลินิกชนบท CareFlow Pilot")).toBeInTheDocument();
    expect(screen.getByText("S: ปวดศีรษะ")).toBeInTheDocument();
    expect(screen.getByText("ติดตามอาการ")).toBeInTheDocument();
    expect(screen.getByText("ไม่มีข้อบ่งใช้ยา")).toBeInTheDocument();
    expect(screen.getAllByText("100 บาท").length).toBeGreaterThan(0);
    const document = screen.getByLabelText("บัตร OPD สำหรับพิมพ์");
    expect(document).toHaveClass("opd-card");
    expect(document.closest(".print-area")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "พิมพ์ OPD Card" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("denies an Assistant direct route before requesting Doctor-only OPD evidence", async () => {
    let reads = 0;
    server.use(http.get("/api/visits/visit-42/opd-card", () => {
      reads += 1;
      return HttpResponse.json({ data: card });
    }));
    renderOpd("assistant", ["finance:read", "finance:record-cash"]);

    expect(await screen.findByRole("heading", { name: "ไม่มีสิทธิ์ใช้งาน" })).toBeInTheDocument();
    await waitFor(() => expect(reads).toBe(0));
    expect(screen.queryByText("S: ปวดศีรษะ")).not.toBeInTheDocument();
  });
});
