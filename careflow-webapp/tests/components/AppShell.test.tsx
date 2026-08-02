import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/careflow/AppShell";
import { CareFlowProvider } from "@/lib/careflow/context";
import { createSeedState } from "@/lib/careflow/seed";

describe("AppShell", () => {
  it("keeps doctor-only navigation out of the assistant workspace", () => {
    const state = createSeedState();
    state.role = "assistant";

    render(
      <CareFlowProvider initialState={state} persist={false}>
        <AppShell pathname="/">
          <p>หน้าทดสอบ</p>
        </AppShell>
      </CareFlowProvider>,
    );

    expect(screen.getByRole("navigation", { name: "เมนูหลัก" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ภาพรวม/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /ห้องตรวจ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /รายงาน/ })).not.toBeInTheDocument();
  });

  it("reveals the doctor workspace when the role is switched", () => {
    const state = createSeedState();
    state.role = "assistant";

    render(
      <CareFlowProvider initialState={state} persist={false}>
        <AppShell pathname="/">
          <p>หน้าทดสอบ</p>
        </AppShell>
      </CareFlowProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /เปลี่ยนเป็นแพทย์/ })[0]);

    expect(screen.getByRole("link", { name: /ห้องตรวจ/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /รายงาน/ })).toBeInTheDocument();
  });

  it("labels the demo and exposes a reset control", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <AppShell pathname="/">
          <p>หน้าทดสอบ</p>
        </AppShell>
      </CareFlowProvider>,
    );

    expect(screen.getByText("ต้นแบบสำหรับการสาธิต")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "รีเซ็ตข้อมูลตัวอย่าง" })).toBeInTheDocument();
  });

  it("searches patients, medication codes, and appointment reasons with safe result links", () => {
    render(
      <CareFlowProvider initialState={createSeedState()} persist={false}>
        <AppShell pathname="/"><p>หน้าทดสอบ</p></AppShell>
      </CareFlowProvider>,
    );

    const search = screen.getByRole("searchbox", { name: "ค้นหาใน CareFlow" });
    fireEvent.change(search, { target: { value: "DRG-0001" } });
    expect(screen.getByRole("link", { name: /พาราเซตามอล/ })).toHaveAttribute("href", "/inventory");

    fireEvent.change(search, { target: { value: "เบาหวาน" } });
    expect(screen.getByRole("link", { name: /สมชาย ใจดี/ })).toHaveAttribute("href", "/patients/patient-somchai/history");
    expect(screen.getByRole("link", { name: /ตรวจติดตามอาการเบาหวาน/ })).toHaveAttribute("href", "/appointments");
  });
});
