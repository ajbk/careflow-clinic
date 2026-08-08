import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";

const medication = { id: "DEMO-MED-001", displayName: "พาราเซตามอล", strengthText: "500 mg", dosageFormText: "เม็ด", canonicalUnit: "เม็ด", revision: 1 };
const visit = { id: "visit-42", status: "AWAITING_PREPARATION" as const, revision: 9, arrivedAt: "2026-08-03T01:00:00.000Z", startedAt: "2026-08-03T01:15:00.000Z" };
const patient = { id: "patient-42", hn: "DEMO-000042", displayName: "ผู้ป่วยสังเคราะห์ 000042", phone: "0000000042", birthDate: "1990-01-01", sex: "unknown" as const, revision: 3, createdAt: "2026-08-03T00:00:00.000Z" };
const decision = { id: "decision-1", visitId: visit.id, version: 1, kind: "ORDER" as const, noMedicationReason: null, items: [{ ...medication, quantity: 10, directionsTh: "รับประทานหลังอาหาร" }], revisionReason: null, supersedesId: null, signedBy: { id: "doctor-1", displayName: "พญ. ทดสอบ" }, signedAt: "2026-08-03T02:00:00.000Z", contentHash: "b".repeat(64) };
const inventory = [{ medication, onHand: 20, reserved: 0, available: 20, lotCount: 2, nearestExpiry: "2026-08-20", status: "OK" as const }];
const reservation = {
  id: "reservation-1", clinicId: "clinic", visitId: visit.id, medicationDecisionId: decision.id, medicationDecisionVersion: 1,
  status: "ACTIVE" as const, createdAt: "2026-08-03T02:05:00.000Z", createdBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
  releasedAt: null, releasedBy: null, releaseReason: null,
  allocations: [{ id: "allocation-1", reservationId: "reservation-1", medicationOrderItemId: "decision-1-item-1", medicationId: medication.id, lotId: "lot-early", position: 0, quantity: 10, lotNumberSnapshot: "PCM-EARLY", expiryDateSnapshot: "2026-08-20", unitSnapshot: "เม็ด", allocatedAt: "2026-08-03T02:05:00.000Z" }],
};
const pickList = { visit, patient, medicationDecision: decision, reservation: null, inventory };
const reservedPickList = { ...pickList, visit: { ...visit, status: "PREPARING" as const, revision: 10 }, reservation };
const releasedPickList = {
  ...pickList,
  reservation: {
    ...reservation,
    status: "RELEASED" as const,
    releasedAt: "2026-08-03T02:10:00.000Z",
    releasedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
    releaseReason: "ทบทวนรายการก่อนจัดยา",
  },
};

function session(role: "assistant" | "doctor", reserve = true) {
  return { data: {
    user: { id: `${role}-1`, username: role, displayName: role === "assistant" ? "ผู้ช่วยทดสอบ" : "พญ. ทดสอบ", role },
    clinic: { id: "clinic", name: "คลินิกทดสอบ" },
    permissions: reserve ? ["patient:read", "visit:read-queue", "inventory:read", "inventory:reserve"] : ["patient:read", "visit:read-queue", "inventory:read"],
    pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z", mustChangePassword: false, idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } };
}

const server = setupServer();
function renderDispensing(role: "assistant" | "doctor" = "assistant", reserve = true) {
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session(role, reserve))));
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/dispensing/visit-42"] });
  render(<AppProviders><RouterProvider router={router} /></AppProviders>);
  return router;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => server.resetHandlers(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: pickList }))));
afterEach(() => { cleanup(); server.resetHandlers(); });
afterAll(() => server.close());

describe("Dispensing Pick List", () => {
  it("renders the signed order and exact FEFO allocation rows", async () => {
    renderDispensing();
    expect(await screen.findByRole("heading", { name: "จัดยา" })).toBeInTheDocument();
    expect(await screen.findByText("พาราเซตามอล")).toBeInTheDocument();
    expect(screen.getByText(/วิธีใช้: รับประทานหลังอาหาร/)).toBeInTheDocument();
    expect(await screen.findByText(/ยังไม่มีการจองล็อต/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มจองล็อตตาม FEFO" })).toBeInTheDocument();
  });

  it("shows hard-reserved state and allows the permitted staff member to release with a preserved reason after an API error", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: reservedPickList })),
      http.post("/api/dispensing/visit-42/reservation-release", () => HttpResponse.json({ error: { code: "REVISION_CONFLICT", messageTh: "ข้อมูล Visit เปลี่ยนแปลงแล้ว", requestId: "request-1" } }, { status: 409 })),
    );
    renderDispensing();
    expect((await screen.findAllByText(/Hard Reservation/)).length).toBeGreaterThan(0);
    expect(screen.getByText("PCM-EARLY")).toBeInTheDocument();
    expect(screen.getByText(/หมดอายุ 20 สิงหาคม 2569/)).toBeInTheDocument();
    expect(screen.getByText(/ระบบตรวจสอบวันหมดอายุเมื่อเริ่มจอง/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("เหตุผลการยกเลิกการจอง"), "ทบทวนรายการก่อนจัดยา");
    await user.click(screen.getByRole("button", { name: "ยกเลิกการจอง" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ข้อมูล Visit เปลี่ยนแปลงแล้ว");
    expect(screen.getByLabelText("เหตุผลการยกเลิกการจอง")).toHaveValue("ทบทวนรายการก่อนจัดยา");
  });

  it("hides reserve and release commands without inventory:reserve while retaining read-only Pick List access", async () => {
    renderDispensing("doctor", false);
    expect(await screen.findByRole("heading", { name: "จัดยา" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เริ่มจองล็อตตาม FEFO" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ยกเลิกการจอง" })).not.toBeInTheDocument();
    expect(await screen.findByText(/อ่านข้อมูลได้อย่างเดียว/)).toBeInTheDocument();
  });

  it("posts a strict reserve command and renders the returned PREPARING Pick List", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(http.post("/api/dispensing/visit-42/reservations", async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: reservedPickList, replayed: false }, { status: 201 });
    }));
    renderDispensing();
    await user.click(await screen.findByRole("button", { name: "เริ่มจองล็อตตาม FEFO" }));
    await waitFor(() => expect(body).toMatchObject({ expectedRevisions: { visit: 9, medicationDecision: 1 }, payload: {} }));
    expect((await screen.findAllByText(/Hard Reservation/)).length).toBeGreaterThan(0);
    expect(screen.getByText("PCM-EARLY")).toBeInTheDocument();
  });

  it("hides released historical allocations and returns to a clean reserve state", async () => {
    server.use(http.get("/api/dispensing/visit-42", () => HttpResponse.json({ data: releasedPickList })));
    renderDispensing();
    expect(await screen.findByRole("heading", { name: "จัดยา" })).toBeInTheDocument();
    expect(screen.queryByText("PCM-EARLY")).not.toBeInTheDocument();
    expect(await screen.findByText(/ยังไม่มีการจองล็อต/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มจองล็อตตาม FEFO" })).toBeInTheDocument();
  });
});
