import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JourneyBlocker, JourneySummaryDto } from "../../src/shared/contracts";
import { queryKeys } from "../../src/client/app/query-client";
import { journeyDestination, sanitizeJourneyReturnTo } from "../../src/client/app/journey-navigation";
import { JourneyBlockerCard } from "../../src/client/components/careflow/JourneyBlockerCard";
import { JourneyNextTaskCard } from "../../src/client/components/careflow/JourneyNextTaskCard";
import { VisitJourneyRibbon } from "../../src/client/components/careflow/VisitJourneyRibbon";
import { getVisitJourney, invalidateJourney, useVisitJourney } from "../../src/client/features/journey";
import { ApiClient } from "../../src/client/lib/api-client";

const steps: JourneySummaryDto["steps"] = [
  { code: "INTAKE", labelTh: "รับผู้ป่วย", state: "COMPLETE" },
  { code: "SCREENING", labelTh: "คัดกรอง", state: "COMPLETE" },
  { code: "CONSULTATION", labelTh: "ตรวจรักษา", state: "CURRENT" },
  { code: "MEDICATION_DECISION", labelTh: "ตัดสินใจเรื่องยา", state: "UPCOMING" },
  { code: "PREPARATION", labelTh: "เตรียมยา", state: "UPCOMING" },
  { code: "HANDOFF", labelTh: "ส่งมอบยา", state: "UPCOMING" },
  { code: "PAYMENT", labelTh: "ชำระเงิน", state: "UPCOMING" },
  { code: "CLOSURE", labelTh: "ปิด Visit", state: "UPCOMING" },
];

const waitingSummary: JourneySummaryDto = {
  steps,
  nextTask: {
    action: "START_CONSULTATION",
    labelTh: "เริ่มตรวจ",
    primaryRole: "doctor",
    permittedRoles: ["doctor"],
    availability: "AVAILABLE",
  },
  blockers: [],
  allowedActions: ["START_CONSULTATION"],
};

const stockBlocker: JourneyBlocker = {
  code: "STOCK_SHORTAGE",
  titleTh: "จัดยายังไม่ได้",
  detailTh: "จำนวนยาพร้อมใช้ไม่เพียงพอ",
  primaryRole: "assistant",
  recoveryAction: "RECEIVE_STOCK",
  medication: {
    medicationId: "DEMO-MED-001",
    displayNameSnapshot: "พาราเซตามอล",
    required: 3,
    available: 0,
    shortfall: 3,
    unitSnapshot: "เม็ด",
  },
};

afterEach(() => cleanup());

describe("shared Visit Journey UI", () => {
  it("renders the complete accessible eight-step ribbon with icons and explicit state text", () => {
    // Break caught: hiding mobile steps or using colour alone loses the current clinic-path context for keyboard and screen-reader users.
    render(<VisitJourneyRibbon steps={steps} />);

    const navigation = screen.getByRole("navigation", { name: "เส้นทางผู้ป่วย" });
    const items = within(navigation).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items.map((item) => item.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("รับผู้ป่วย"),
      expect.stringContaining("คัดกรอง"),
      expect.stringContaining("ตรวจรักษา"),
      expect.stringContaining("ตัดสินใจเรื่องยา"),
      expect.stringContaining("เตรียมยา"),
      expect.stringContaining("ส่งมอบยา"),
      expect.stringContaining("ชำระเงิน"),
      expect.stringContaining("ปิด Visit"),
    ]));
    expect(within(navigation).getAllByText("เสร็จแล้ว")).toHaveLength(2);
    expect(within(navigation).getByText("กำลังดำเนินการ")).toBeInTheDocument();
    expect(within(navigation).getAllByText("รอขั้นตอน")).toHaveLength(5);
    expect(navigation.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(8);
    expect(within(navigation).getAllByRole("listitem").filter((item) => item.getAttribute("aria-current") === "step")).toHaveLength(1);
  });

  it("keeps the full ribbon list in the accessibility tree at a 375px viewport", () => {
    // Break caught: a mobile-only conditional render removes off-screen Journey steps from assistive technology.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(<VisitJourneyRibbon steps={steps} />);
    expect(within(screen.getByRole("navigation", { name: "เส้นทางผู้ป่วย" })).getAllByRole("listitem")).toHaveLength(8);
  });

  it("uses only the authorized local action for the current role", async () => {
    // Break caught: a stale screen fixture can expose a mutation that the server Journey did not authorize.
    const user = userEvent.setup();
    const onLocalAction = vi.fn();
    render(
      <MemoryRouter>
        <JourneyNextTaskCard summary={waitingSummary} visitId="visit-1" currentRole="doctor" authorityReady onLocalAction={onLocalAction} />
      </MemoryRouter>,
    );

    expect(screen.getByText("บทบาทหลัก: แพทย์")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "เริ่มตรวจ" }));
    expect(onLocalAction).toHaveBeenCalledWith("START_CONSULTATION");
  });

  it("gives a waiting role explanatory text instead of a disabled mutation button", () => {
    // Break caught: a disabled action falsely suggests that an unauthorized role can take ownership of another role's work.
    const waiting: JourneySummaryDto = {
      ...waitingSummary,
      nextTask: {
        ...waitingSummary.nextTask!,
        labelTh: "รอแพทย์ตรวจและสั่งการรักษา",
        availability: "WAITING_FOR_ROLE",
      },
      allowedActions: [],
    };
    render(
      <MemoryRouter>
        <JourneyNextTaskCard summary={waiting} visitId="visit-1" currentRole="assistant" authorityReady />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("รอแพทย์ตรวจและสั่งการรักษา");
    expect(screen.queryByRole("button", { name: /เริ่มตรวจ/ })).not.toBeInTheDocument();
  });

  it("shows server-provided shortage facts, routes an authorized recovery, and focuses a command-failure alert", async () => {
    // Break caught: a stock recovery without the exact shortage facts or focusable failure summary leaves the operator unable to safely recover.
    render(
      <MemoryRouter>
        <JourneyBlockerCard
          blocker={stockBlocker}
          visitId="visit-1"
          currentRole="assistant"
          allowedActions={["RECEIVE_STOCK"]}
          authorityReady
          commandFailure="กันสต็อกไม่สำเร็จ กรุณาตรวจสอบคงคลังล่าสุด"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("พาราเซตามอล")).toBeInTheDocument();
    expect(screen.getByText("ต้องการ 3 เม็ด")).toBeInTheDocument();
    expect(screen.getByText("พร้อมใช้ 0 เม็ด")).toBeInTheDocument();
    expect(screen.getByText("ขาด 3 เม็ด")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "รับยาเข้าคลัง" })).toHaveAttribute(
      "href",
      "/inventory/receive?medicationId=DEMO-MED-001&returnTo=%2Fdispensing%2Fvisit-1",
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("กันสต็อกไม่สำเร็จ");
    await waitFor(() => expect(alert).toHaveFocus());
  });
});

describe("Journey navigation", () => {
  it("maps semantic actions centrally and creates a stock recovery return path", () => {
    // Break caught: screens that derive routes independently can send a recovery to the wrong Visit.
    expect(journeyDestination("OPEN_CONSULTATION", "visit / 1")).toEqual({ kind: "ROUTE", to: "/consultations/visit%20%2F%201" });
    expect(journeyDestination("START_CONSULTATION", "visit-1")).toEqual({ kind: "LOCAL", action: "START_CONSULTATION" });
    expect(journeyDestination("RECEIVE_STOCK", "visit-1", stockBlocker)).toEqual({
      kind: "ROUTE",
      to: "/inventory/receive?medicationId=DEMO-MED-001&returnTo=%2Fdispensing%2Fvisit-1",
    });
    expect(journeyDestination("RECEIVE_STOCK", "visit-1")).toEqual({ kind: "NONE" });
  });

  it("sanitizes stock recovery return paths to an in-app destination", () => {
    // Break caught: an external or malformed return target turns a stock-recovery link into an open redirect.
    expect(sanitizeJourneyReturnTo("/dispensing/visit-1")).toBe("/dispensing/visit-1");
    expect(sanitizeJourneyReturnTo("https://outside.example/steal")).toBe("/inventory");
    expect(sanitizeJourneyReturnTo("//outside.example/steal")).toBe("/inventory");
    expect(sanitizeJourneyReturnTo("/\\outside.example")).toBe("/inventory");
  });
});

describe("Journey authority query", () => {
  const fullJourney = {
    ...waitingSummary,
    visit: { id: "visit-1", status: "WAITING" as const, revision: 2 },
    refreshedAt: "2026-08-12T00:00:00.000Z",
  };

  it("decodes the Journey response from its Visit-specific endpoint", async () => {
    // Break caught: accepting an unvalidated Journey response can turn malformed authority data into enabled clinic mutations.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: fullJourney }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const client = new ApiClient(fetchImpl);

    await expect(getVisitJourney(client, "visit / 1")).resolves.toEqual(fullJourney);
    expect(fetchImpl).toHaveBeenCalledWith("/api/visits/visit%20%2F%201/journey", expect.objectContaining({ method: "GET" }));
  });

  it("does not issue an authority request without a Visit ID", () => {
    // Break caught: an empty route parameter must not fetch a broad or malformed Journey endpoint.
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new ApiClient(fetchImpl);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

    const { result } = renderHook(() => useVisitJourney("", client), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invalidates only the changed Visit's Journey authority", async () => {
    // Break caught: retaining an old Journey after a successful command exposes action authority for a superseded Visit revision.
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.journey("visit-1"), fullJourney);
    queryClient.setQueryData(queryKeys.journey("visit-2"), { ...fullJourney, visit: { ...fullJourney.visit, id: "visit-2" } });

    await invalidateJourney(queryClient, "visit-1");
    expect(queryClient.getQueryState(queryKeys.journey("visit-1"))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.journey("visit-2"))?.isInvalidated).not.toBe(true);
  });
});
