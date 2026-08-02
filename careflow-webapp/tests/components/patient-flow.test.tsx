import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CareFlowProvider } from "@/lib/careflow/context";
import { createSeedState } from "@/lib/careflow/seed";
import { IntakeScreen } from "@/components/careflow/screens/IntakeScreen";
import { ConsultationScreen } from "@/components/careflow/screens/ConsultationScreen";
import { DispensingScreen } from "@/components/careflow/screens/DispensingScreen";
import { CheckoutScreen } from "@/components/careflow/screens/CheckoutScreen";
import { OpdCardScreen } from "@/components/careflow/screens/OpdCardScreen";
import { PatientHistoryScreen } from "@/components/careflow/screens/PatientHistoryScreen";
import { LabelsScreen } from "@/components/careflow/screens/LabelsScreen";
import { QueueScreen } from "@/components/careflow/screens/QueueScreen";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe("connected patient flow", () => {
  it("shows Thai-first validation when required intake fields are empty", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <IntakeScreen />
      </CareFlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    expect(screen.getByText("กรุณาระบุชื่อผู้ป่วย")).toBeInTheDocument();
    expect(screen.getByText("กรุณาระบุอาการสำคัญ")).toBeInTheDocument();
  });

  it("submits a valid intake and navigates to the live queue", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <IntakeScreen />
      </CareFlowProvider>,
    );

    fireEvent.change(screen.getByLabelText("ชื่อ–นามสกุล *"), { target: { value: "ใหม่ ใจดี" } });
    fireEvent.change(screen.getByLabelText("อุณหภูมิ *"), { target: { value: "37" } });
    fireEvent.change(screen.getByLabelText("ความดันตัวบน *"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("ความดันตัวล่าง *"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("อาการสำคัญ *"), { target: { value: "ปวดศีรษะ" } });
    fireEvent.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    expect(pushMock).toHaveBeenCalledWith("/queue");
  });

  it("keeps dispensing disabled until every medication is checked", () => {
    render(
      <CareFlowProvider
        initialState={createSeedState({ demoVisitStatus: "awaiting-dispensing" })}
        persist={false}
      >
        <DispensingScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    const confirm = screen.getByRole("button", { name: /ยืนยันการจ่ายยา/ });
    expect(confirm).toBeDisabled();

    screen.getAllByRole("checkbox", { name: /จัดเตรียมแล้ว/ }).forEach((checkbox) => {
      fireEvent.click(checkbox);
    });

    expect(confirm).toBeEnabled();
  });

  it("navigates to labels after confirmed dispensing", () => {
    pushMock.mockClear();
    render(
      <CareFlowProvider
        initialState={createSeedState({ demoVisitStatus: "awaiting-dispensing", allPrepared: true })}
        persist={false}
      >
        <DispensingScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /ยืนยันการจ่ายยา/ }));

    expect(pushMock).toHaveBeenCalledWith("/dispensing/demo-visit/labels");
  });

  it("requires a payment method before completing checkout", () => {
    render(
      <CareFlowProvider
        initialState={createSeedState({ demoVisitStatus: "awaiting-payment" })}
        persist={false}
      >
        <CheckoutScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    const confirm = screen.getByRole("button", { name: /ยืนยันการรับเงิน/ });
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /เงินสด/ }));
    expect(confirm).toBeEnabled();
  });

  it("blocks direct label and checkout actions before their workflow stage", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <LabelsScreen visitId="demo-visit" />
        <CheckoutScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    expect(screen.getAllByText("ยังไม่พร้อมใช้งาน")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /พิมพ์ฉลาก/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยันการรับเงิน/ })).not.toBeInTheDocument();
  });

  it("shows a completed checkout receipt without payment controls", () => {
    render(
      <CareFlowProvider initialState={createSeedState({ demoVisitStatus: "complete" })} persist={false}>
        <CheckoutScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    expect(screen.getByText("ชำระเงินเรียบร้อยแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /เงินสด/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยันการรับเงิน/ })).not.toBeInTheDocument();
  });

  it("keeps the assistant queue action waiting instead of exposing consultation start", () => {
    const state = createSeedState();
    state.role = "assistant";
    render(
      <CareFlowProvider initialState={state} persist={false}>
        <QueueScreen />
      </CareFlowProvider>,
    );

    expect(screen.queryByRole("button", { name: "เริ่มการตรวจ" })).not.toBeInTheDocument();
    expect(screen.getAllByText("รอแพทย์เริ่มการตรวจ").length).toBeGreaterThan(0);
  });

  it("makes signed clinical notes read-only", () => {
    render(
      <CareFlowProvider
        initialState={createSeedState({ demoVisitStatus: "awaiting-dispensing" })}
        persist={false}
      >
        <ConsultationScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );

    expect(screen.getByLabelText(/อาการและประวัติปัจจุบัน/)).toBeDisabled();
    expect(screen.getByLabelText(/ผลการตรวจร่างกาย/)).toBeDisabled();
    expect(screen.getByLabelText(/การประเมิน/)).toBeDisabled();
  });

  it("shows a prototype role restriction instead of clinical content for assistants", () => {
    const state = createSeedState({ demoVisitStatus: "awaiting-dispensing" });
    state.role = "assistant";

    const { rerender } = render(
      <CareFlowProvider initialState={state} persist={false}>
        <ConsultationScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );
    expect(screen.getByText("หน้าจอนี้สงวนไว้สำหรับแพทย์")).toBeInTheDocument();
    expect(screen.queryByLabelText(/อาการและประวัติปัจจุบัน/)).not.toBeInTheDocument();

    rerender(
      <CareFlowProvider initialState={state} persist={false}>
        <OpdCardScreen visitId="demo-visit" />
      </CareFlowProvider>,
    );
    expect(screen.getByText("หน้าจอนี้สงวนไว้สำหรับแพทย์")).toBeInTheDocument();
    expect(screen.queryByText("บัตรผู้ป่วยนอก / Outpatient Department Card")).not.toBeInTheDocument();

    rerender(
      <CareFlowProvider initialState={state} persist={false}>
        <PatientHistoryScreen patientId="patient-somchai" />
      </CareFlowProvider>,
    );
    expect(screen.getByText("หน้าจอนี้สงวนไว้สำหรับแพทย์")).toBeInTheDocument();
    expect(screen.queryByText("ข้อมูลผู้ป่วย")).not.toBeInTheDocument();
  });
});
