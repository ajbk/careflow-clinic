import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CareFlowProvider, useCareFlow } from "@/lib/careflow/context";
import { createSeedState } from "@/lib/careflow/seed";
import { OverviewScreen } from "@/components/careflow/screens/OverviewScreen";
import { InventoryScreen } from "@/components/careflow/screens/InventoryScreen";
import { StockReceptionScreen } from "@/components/careflow/screens/StockReceptionScreen";
import { AppointmentsScreen } from "@/components/careflow/screens/AppointmentsScreen";
import { NewAppointmentScreen } from "@/components/careflow/screens/NewAppointmentScreen";
import { AnalyticsScreen } from "@/components/careflow/screens/AnalyticsScreen";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function StockProbe({ inventoryId }: { inventoryId: string }) {
  const { state } = useCareFlow();
  const stock = state.inventory.find((item) => item.id === inventoryId)?.stock;
  return <output data-testid={`stock-${inventoryId}`}>{stock}</output>;
}

function StartDemoVisit() {
  const { dispatch } = useCareFlow();
  return (
    <button
      type="button"
      onClick={() =>
        dispatch({
          type: "START_CONSULTATION",
          payload: { visitId: "demo-visit", startedAt: "2026-08-02T09:30:00.000Z" },
        })
      }
    >
      เริ่มรายการทดสอบ
    </button>
  );
}

function AdvanceDemoVisit() {
  const { dispatch } = useCareFlow();
  return <button type="button" onClick={() => dispatch({ type: "SIGN_VISIT", payload: { visitId: "demo-visit", signedAt: "2026-08-02T09:45:00.000Z", clinical: { subjective: "ไอ", objective: "ปอดใส", assessment: "ติดเชื้อ", plan: "พัก", diagnosis: { code: "J06.9", labelTh: "การติดเชื้อทางเดินหายใจส่วนบน", labelEn: "URI" } } } })}>ลงนามรายการทดสอบ</button>;
}

describe("connected clinic operations", () => {
  it("updates overview metrics from shared workflow state", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <OverviewScreen />
        <StartDemoVisit />
      </CareFlowProvider>,
    );

    expect(screen.getByLabelText("รอตรวจ")).toHaveTextContent("5");
    fireEvent.click(screen.getByRole("button", { name: "เริ่มรายการทดสอบ" }));
    expect(screen.getByLabelText("รอตรวจ")).toHaveTextContent("4");
    expect(screen.getByLabelText("ผู้ป่วยในระบบวันนี้")).toHaveTextContent("10");
  });

  it("keeps overview active count and analytics data live through sign-off", () => {
    render(<CareFlowProvider initialState={createSeedState()} persist={false}><OverviewScreen /><AnalyticsScreen /><StartDemoVisit /><AdvanceDemoVisit /></CareFlowProvider>);
    fireEvent.click(screen.getByRole("button", { name: "เริ่มรายการทดสอบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ลงนามรายการทดสอบ" }));

    expect(screen.getByLabelText("ผู้ป่วยในระบบวันนี้")).toHaveTextContent("10");
    expect(screen.getByLabelText("จำนวนรายการตรวจ")).toHaveTextContent("313");
    expect(screen.getByText("การติดเชื้อทางเดินหายใจส่วนบน")).toBeInTheDocument();
  });

  it("filters the medication registry by Thai name or drug code", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <InventoryScreen />
      </CareFlowProvider>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /ค้นหายา/ }), {
      target: { value: "DRG-0001" },
    });

    expect(screen.getByText("พาราเซตามอล")).toBeInTheDocument();
    expect(screen.queryByText("อะม็อกซีซิลลิน")).not.toBeInTheDocument();
  });

  it("previews and commits current stock plus the received quantity", () => {
    pushMock.mockClear();
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <StockReceptionScreen />
        <StockProbe inventoryId="med-paracetamol" />
      </CareFlowProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /ค้นหายา/ }), {
      target: { value: "med-paracetamol" },
    });
    fireEvent.change(screen.getByLabelText(/จำนวนที่รับ/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/ผู้ผลิต.*ผู้จัดจำหน่าย/), {
      target: { value: "องค์การเภสัชกรรม" },
    });
    fireEvent.change(screen.getByLabelText(/เลขที่ล็อต/), { target: { value: "PCM-2608" } });
    fireEvent.change(screen.getByLabelText(/วันหมดอายุ/), { target: { value: "2028-08-31" } });

    expect(screen.getByText(/42\s*\+\s*8\s*=\s*50/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันการรับยา/ }));

    expect(screen.getByTestId("stock-med-paracetamol")).toHaveTextContent("50");
    expect(pushMock).toHaveBeenCalledWith("/inventory");
  });

  it("rejects an expired stock batch without changing inventory", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <StockReceptionScreen />
        <StockProbe inventoryId="med-amoxicillin" />
      </CareFlowProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /ค้นหายา/ }), {
      target: { value: "med-amoxicillin" },
    });
    fireEvent.change(screen.getByLabelText(/จำนวนที่รับ/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/เลขที่ล็อต/), { target: { value: "OLD-001" } });
    fireEvent.change(screen.getByLabelText(/วันหมดอายุ/), { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันการรับยา/ }));

    expect(screen.getByText("วันหมดอายุต้องเป็นวันในอนาคต")).toBeInTheDocument();
    expect(screen.getByTestId("stock-med-amoxicillin")).toHaveTextContent("450");
  });

  it("disables occupied slots and renders a new appointment on the week calendar", () => {
    pushMock.mockClear();
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <NewAppointmentScreen />
        <AppointmentsScreen />
      </CareFlowProvider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: /ผู้ป่วย/ }), {
      target: { value: "patient-ariya" },
    });
    fireEvent.change(screen.getByLabelText(/วันที่นัด/), { target: { value: "2026-08-03" } });

    expect(screen.getByRole("button", { name: "09:00 ไม่ว่าง" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "10:00 ว่าง" }));
    fireEvent.change(screen.getByLabelText(/เหตุผลการนัดหมาย/), {
      target: { value: "ตรวจติดตามอาการ" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันนัดหมาย/ }));

    const calendar = screen.getByRole("region", { name: "ปฏิทินนัดหมายประจำสัปดาห์" });
    expect(within(calendar).getByText("อารียา มงคล")).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/appointments");
  });

  it("renders the corrected monthly report from domain data", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <AnalyticsScreen />
      </CareFlowProvider>,
    );

    expect(screen.getByText("ตุลาคม 2566")).toBeInTheDocument();
    expect(screen.getByLabelText("ยาที่ต้องสั่งเพิ่ม")).toHaveTextContent("3");
    expect(
      screen.getByRole("img", { name: "แนวโน้มจำนวนผู้ป่วยรายเดือน" }),
    ).toBeInTheDocument();
  });

  it("keeps direct analytics access in the prototype doctor workspace", () => {
    const state = createSeedState();
    state.role = "assistant";
    render(<CareFlowProvider initialState={state} persist={false}><AnalyticsScreen /></CareFlowProvider>);

    expect(screen.getByText("หน้าจอนี้สงวนไว้สำหรับแพทย์")).toBeInTheDocument();
    expect(screen.queryByText("ตุลาคม 2566")).not.toBeInTheDocument();
  });
});
