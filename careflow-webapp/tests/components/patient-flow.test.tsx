import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CareFlowProvider } from "@/lib/careflow/context";
import { createSeedState } from "@/lib/careflow/seed";
import { IntakeScreen } from "@/components/careflow/screens/IntakeScreen";
import { ConsultationScreen } from "@/components/careflow/screens/ConsultationScreen";
import { DispensingScreen } from "@/components/careflow/screens/DispensingScreen";
import { CheckoutScreen } from "@/components/careflow/screens/CheckoutScreen";

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
});
