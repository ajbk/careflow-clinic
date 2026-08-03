import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { appRoutes } from "../../src/client/app/router";

describe("pilot router", () => {
  it("renders the Thai pilot shell without the prototype role switch", () => {
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    expect(screen.getByText("CareFlow")).toBeInTheDocument();
    expect(screen.getAllByText(/PILOT — ข้อมูลสังเคราะห์เท่านั้น/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /เปลี่ยนเป็นแพทย์|เปลี่ยนเป็นผู้ช่วย/ })).not.toBeInTheDocument();
  });
});
