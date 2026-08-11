import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProviders } from "../../src/client/app/providers";
import { appRoutes } from "../../src/client/app/router";
import type { AllergyAssessmentDto } from "../../src/shared/contracts";

const session = {
  data: {
    user: { id: "assistant-1", username: "assistant", displayName: "ผู้ช่วยทดสอบ", role: "assistant" as const },
    clinic: { id: "clinic", name: "คลินิกทดสอบ" },
    permissions: ["patient:read", "patient:create-synthetic", "visit:submit-intake", "visit:read-queue"] as const,
    pilotAcknowledgedAt: "2026-08-03T00:00:00.000Z",
    mustChangePassword: false,
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  },
};

const patient = {
  id: "patient-1",
  hn: "DEMO-000123",
  displayName: "ผู้ป่วยทดสอบ 000123",
  phone: "0000000123",
  birthDate: "1990-01-01",
  sex: "unknown" as const,
  revision: 4,
  createdAt: "2026-08-03T00:00:00.000Z",
};

const secondPatient = {
  ...patient,
  id: "patient-2",
  hn: "DEMO-000124",
  displayName: "ผู้ป่วยทดสอบ 000124",
  phone: "0000000124",
};

const unknownAllergy: AllergyAssessmentDto = {
  id: null,
  revision: 0,
  state: "UNKNOWN" as const,
  items: [],
  sourceText: null,
  reason: null,
  reviewedBy: null,
  reviewedAt: null,
};

function allergyContext(value = patient, allergy: AllergyAssessmentDto = unknownAllergy) {
  return { data: { patient: value, allergy } };
}

const intakeResponse = {
  data: {
    visit: {
      id: "visit-1",
      status: "WAITING" as const,
      revision: 1,
      arrivedAt: "2026-08-03T01:00:00.000Z",
      startedAt: null,
    },
    patient: {
      id: patient.id,
      hn: patient.hn,
      displayName: patient.displayName,
      birthDate: patient.birthDate,
      sex: patient.sex,
      revision: patient.revision,
    },
    allergy: { id: null, revision: 0, state: "UNKNOWN" as const, items: [], sourceText: null, reason: null, reviewedBy: null, reviewedAt: null },
    chiefComplaint: "ไอ",
    vitals: {
      weightKg: null,
      heightCm: null,
      temperatureC: 37.5,
      systolicMmhg: null,
      diastolicMmhg: null,
      heartRateBpm: null,
      spo2Percent: null,
    },
    allowedActions: [],
  },
  replayed: false,
};

const server = setupServer();

function jsonError(code: string, messageTh: string, status: number, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ error: { code, messageTh, requestId: "request-1", ...extra } }, { status });
}

function renderIntake() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/intake"] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

function validPatientSearch() {
  return http.get("/api/patients/search", () => HttpResponse.json({ data: [patient] }));
}

async function confirmNoAllergy(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: "ไม่แพ้" }));
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  server.resetHandlers(
    http.get("/api/auth/session", () => HttpResponse.json(session)),
    http.get("/api/patients/search", () => HttpResponse.json({ data: [] })),
    http.get("/api/patients/:patientId/allergy-assessment", ({ params }) => HttpResponse.json(
      allergyContext(params.patientId === secondPatient.id ? secondPatient : patient),
    )),
    http.get("/api/queue", () => HttpResponse.json({ data: [] })),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("connected Intake journey", () => {
  it("requires a loaded, explicitly selected Allergy answer before Intake can be sent", async () => {
    const user = userEvent.setup();
    let resolveContext: ((response: Response) => void) | undefined;
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => new Promise((resolve) => {
        resolveContext = resolve;
      })),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));

    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "ไม่แพ้" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "แพ้" })).not.toBeChecked();
    await waitFor(() => expect(resolveContext).toBeTypeOf("function"));

    resolveContext?.(new Response(JSON.stringify(allergyContext()), { status: 200 }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "ไม่แพ้" })).toBeEnabled());
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "ไม่แพ้" }));
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeEnabled();
    expect(screen.queryByText("ข้อมูลแพ้ยาเปลี่ยนจากข้อมูลเดิม")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /เหตุผลที่ข้อมูลแพ้ยาเปลี่ยน/ })).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("requires a reason before changing a resolved Allergy assessment during Intake", async () => {
    const user = userEvent.setup();
    const presentAllergy = {
      ...unknownAllergy,
      id: "allergy-1",
      revision: 2,
      state: "PRESENT" as const,
      items: [{ substance: "ยา A", reaction: "ผื่น", severity: "MILD" as const, note: "หลีกเลี่ยง" }],
      sourceText: "บัตรแพ้ยา",
      reason: "ทบทวนล่าสุด",
      reviewedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
      reviewedAt: "2026-08-03T01:00:00.000Z",
    };
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => HttpResponse.json(allergyContext(patient, presentAllergy))),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "ไม่แพ้" }));

    expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลแพ้ยาเปลี่ยนจากข้อมูลเดิม");
    expect(screen.getByRole("textbox", { name: /เหตุผลที่ข้อมูลแพ้ยาเปลี่ยน/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /เหตุผลที่ข้อมูลแพ้ยาเปลี่ยน/ }), "ผู้ป่วยยืนยันว่าไม่แพ้");
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeEnabled();
  });

  it("requires a reason before changing a known-no-allergy assessment to reported Allergy", async () => {
    const user = userEvent.setup();
    const noKnownAllergy = { ...unknownAllergy, id: "allergy-none", revision: 2, state: "NONE_KNOWN" as const };
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => HttpResponse.json(allergyContext(patient, noKnownAllergy))),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "แพ้" }));
    await user.type(screen.getByRole("textbox", { name: /สารที่แพ้/ }), "เพนิซิลลิน");
    await user.type(screen.getByRole("textbox", { name: /อาการแพ้/ }), "ผื่น");

    expect(screen.getByRole("alert")).toHaveTextContent("ข้อมูลแพ้ยาเปลี่ยนจากข้อมูลเดิม");
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /เหตุผลที่ข้อมูลแพ้ยาเปลี่ยน/ }), "ผู้ป่วยแจ้งประวัติใหม่");
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeEnabled();
  });

  it("requires substance and reaction before a reported Allergy can be sent", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => HttpResponse.json(allergyContext())),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "แพ้" }));

    expect(screen.getByRole("textbox", { name: /สารที่แพ้/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /อาการแพ้/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "ความรุนแรง" })).toHaveDisplayValue("ยังไม่ทราบ");
    expect(screen.getByRole("textbox", { name: /หมายเหตุ/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: /สารที่แพ้/ }), "เพนิซิลลิน");
    await user.type(screen.getByRole("textbox", { name: /อาการแพ้/ }), "ผื่น");
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeEnabled();
  });

  it("focuses the first Allergy field from a 422 and keeps the Intake draft", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => jsonError("VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูล", 422, {
        fieldErrors: { "payload.allergy.items.0.substance": "กรุณาระบุสารที่แพ้" },
      })),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "แพ้" }));
    const substance = screen.getByRole("textbox", { name: /สารที่แพ้/ });
    const reaction = screen.getByRole("textbox", { name: /อาการแพ้/ });
    await user.type(substance, "ยา A");
    await user.type(reaction, "ผื่น");
    await user.type(screen.getByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    await waitFor(() => expect(substance).toHaveFocus());
    expect(substance).toHaveValue("ยา A");
    expect(reaction).toHaveValue("ผื่น");
    expect(screen.getByRole("textbox", { name: /อาการสำคัญ/ })).toHaveValue("ไอ");
    expect(screen.getByText("กรุณาระบุสารที่แพ้")).toBeInTheDocument();
  });

  it.each([
    {
      changedAuthority: "Patient",
      nextPatient: { ...patient, revision: 5 },
      nextAllergy: {
        ...unknownAllergy,
        id: "allergy-1",
        revision: 2,
        state: "PRESENT" as const,
        items: [{ substance: "ยาเดิม", reaction: "ผื่น", severity: "MILD" as const, note: "บันทึกเดิม" }],
      },
    },
    {
      changedAuthority: "Allergy",
      nextPatient: patient,
      nextAllergy: {
        ...unknownAllergy,
        id: "allergy-1",
        revision: 3,
        state: "PRESENT" as const,
        items: [{ substance: "ยาใหม่จากระบบ", reaction: "ผื่น", severity: "MILD" as const, note: "ข้อมูลใหม่" }],
      },
    },
  ])("clears only the Intake Allergy answer when a same-Patient background refetch changes the $changedAuthority revision", async ({ nextPatient, nextAllergy }) => {
    const user = userEvent.setup();
    const initialAllergy = {
      ...unknownAllergy,
      id: "allergy-1",
      revision: 2,
      state: "PRESENT" as const,
      items: [{ substance: "ยาเดิม", reaction: "ผื่น", severity: "MILD" as const, note: "บันทึกเดิม" }],
    };
    let allergyContextRequests = 0;
    let intakePosts = 0;
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => {
        allergyContextRequests += 1;
        return HttpResponse.json(allergyContext(
          allergyContextRequests === 1 ? patient : nextPatient,
          allergyContextRequests === 1 ? initialAllergy : nextAllergy,
        ));
      }),
      http.post("/api/visits/intake", () => {
        intakePosts += 1;
        return HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    const answerYes = await screen.findByRole("radio", { name: "แพ้" });
    const answerNo = screen.getByRole("radio", { name: "ไม่แพ้" });
    await user.click(answerYes);
    const complaint = screen.getByRole("textbox", { name: /อาการสำคัญ/ });
    const temperature = screen.getByRole("spinbutton", { name: "อุณหภูมิ" });
    const note = screen.getByRole("textbox", { name: /หมายเหตุ/ });
    await user.type(complaint, "ไอ");
    await user.type(temperature, "38.2");
    await user.type(note, " เพิ่มเติม");
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeEnabled();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(allergyContextRequests).toBeGreaterThan(1));
    await waitFor(() => expect(answerYes).not.toBeChecked());
    expect(answerNo).not.toBeChecked();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    expect(complaint).toHaveValue("ไอ");
    expect(temperature).toHaveValue(38.2);
    expect(intakePosts).toBe(0);

    await user.click(answerYes);
    expect(screen.getByRole("textbox", { name: /สารที่แพ้/ })).toHaveValue("ยาเดิม");
    expect(screen.getByRole("textbox", { name: /อาการแพ้/ })).toHaveValue("ผื่น");
    expect(screen.getByRole("textbox", { name: /หมายเหตุ/ })).toHaveValue("บันทึกเดิม เพิ่มเติม");
    expect(intakePosts).toBe(0);
  });

  it("removes a stale Intake retry attempt when a same-Patient background context revision changes", async () => {
    const user = userEvent.setup();
    const updatedPatient = { ...patient, revision: 5 };
    let allergyContextRequests = 0;
    let intakePosts = 0;
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => {
        allergyContextRequests += 1;
        return HttpResponse.json(allergyContext(allergyContextRequests === 1 ? patient : updatedPatient));
      }),
      http.post("/api/visits/intake", () => {
        intakePosts += 1;
        return jsonError("INTERNAL_ERROR", "ระบบไม่พร้อมใช้งาน", 503);
      }),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    await user.type(screen.getByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(await screen.findByRole("button", { name: /ลองบันทึกอีกครั้ง/ })).toBeInTheDocument();
    expect(intakePosts).toBe(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(allergyContextRequests).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByRole("radio", { name: "ไม่แพ้" })).not.toBeChecked());
    expect(screen.queryByRole("button", { name: /ลองบันทึกอีกครั้ง/ })).not.toBeInTheDocument();
    expect(intakePosts).toBe(1);
  });

  it("refetches after an Intake revision conflict and requires Allergy reconfirmation", async () => {
    const user = userEvent.setup();
    const updatedPatient = { ...patient, revision: 5 };
    const bodies: unknown[] = [];
    const keys: string[] = [];
    let allergyContextRequests = 0;
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => {
        allergyContextRequests += 1;
        return HttpResponse.json(allergyContext(allergyContextRequests === 1 ? patient : updatedPatient));
      }),
      http.post("/api/visits/intake", async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return bodies.length === 1
          ? jsonError("REVISION_CONFLICT", "ข้อมูลผู้ป่วยเปลี่ยนแล้ว", 409, { currentRevisions: { patient: 5 } })
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    const complaint = screen.getByRole("textbox", { name: /อาการสำคัญ/ });
    const temperature = screen.getByRole("spinbutton", { name: "อุณหภูมิ" });
    await user.type(complaint, "ไอ");
    await user.type(temperature, "38.2");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    await waitFor(() => expect(allergyContextRequests).toBeGreaterThan(1));
    const conflictAlert = screen.getByRole("alert");
    expect(conflictAlert).toHaveTextContent("โหลดข้อมูลล่าสุดแล้ว กรุณายืนยันคำตอบประวัติแพ้ยาอีกครั้ง");
    expect(conflictAlert).not.toHaveTextContent("กรุณาตรวจสอบข้อมูล");
    await waitFor(() => expect(screen.getByRole("radio", { name: "ไม่แพ้" })).toHaveFocus());
    expect(complaint).toHaveValue("ไอ");
    expect(temperature).toHaveValue(38.2);
    expect(screen.getByRole("radio", { name: "ไม่แพ้" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();

    await confirmNoAllergy(user);
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect((bodies[0] as { expectedRevisions: { patient: number } }).expectedRevisions.patient).toBe(4);
    expect((bodies[1] as { expectedRevisions: { patient: number } }).expectedRevisions.patient).toBe(5);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keeps a failed revision-conflict Allergy reload in a truthful stale state", async () => {
    const user = userEvent.setup();
    let allergyContextRequests = 0;
    let intakePosts = 0;
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => {
        allergyContextRequests += 1;
        return allergyContextRequests === 1
          ? HttpResponse.json(allergyContext())
          : jsonError("ALLERGY_CONTEXT_UNAVAILABLE", "ไม่สามารถโหลดข้อมูลแพ้ยาล่าสุดได้", 404);
      }),
      http.post("/api/visits/intake", () => {
        intakePosts += 1;
        return jsonError("REVISION_CONFLICT", "ข้อมูลผู้ป่วยเปลี่ยนแล้ว", 409, { currentRevisions: { patient: 5 } });
      }),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    const complaint = screen.getByRole("textbox", { name: /อาการสำคัญ/ });
    const temperature = screen.getByRole("spinbutton", { name: "อุณหภูมิ" });
    await user.type(complaint, "ไอ");
    await user.type(temperature, "38.2");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    await waitFor(() => expect(allergyContextRequests).toBeGreaterThan(1));
    const staleCopy = "ยังโหลดข้อมูลแพ้ยาล่าสุดไม่สำเร็จ กรุณาลองโหลดอีกครั้งก่อนยืนยันคำตอบ";
    await waitFor(() => expect(screen.getByText(staleCopy)).toBeInTheDocument());
    const staleAlert = screen.getByText(staleCopy).closest('[role="alert"]');
    expect(staleAlert).toHaveTextContent("ข้อมูลแพ้ยาอาจเปลี่ยนแปลงแล้ว");
    expect(staleAlert).not.toHaveTextContent("กรุณาตรวจสอบข้อมูล");
    const reloadButton = screen.getByRole("button", { name: "โหลดข้อมูลแพ้ยาล่าสุดอีกครั้ง" });
    await waitFor(() => expect(reloadButton).toHaveFocus());
    expect(complaint).toHaveValue("ไอ");
    expect(temperature).toHaveValue(38.2);
    expect(screen.getByRole("radio", { name: "ไม่แพ้" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "ไม่แพ้" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    expect(intakePosts).toBe(1);
  });

  it("ignores a revision-conflict reload superseded by switching Patients", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let firstPatientContextRequests = 0;
    let intakePosts = 0;
    let resolveOldReload: ((response: Response) => void) | undefined;
    server.use(
      http.get("/api/patients/search", () => HttpResponse.json({ data: [patient, secondPatient] })),
      http.get("/api/patients/:patientId/allergy-assessment", ({ params }) => {
        if (params.patientId === secondPatient.id) return HttpResponse.json(allergyContext(secondPatient));
        firstPatientContextRequests += 1;
        if (firstPatientContextRequests === 1) return HttpResponse.json(allergyContext());
        return new Promise<Response>((resolve) => {
          resolveOldReload = resolve;
        });
      }),
      http.post("/api/visits/intake", () => {
        intakePosts += 1;
        return jsonError("REVISION_CONFLICT", "ข้อมูลผู้ป่วยเปลี่ยนแล้ว", 409, { currentRevisions: { patient: 5 } });
      }),
    );
    renderIntake();

    const search = await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ });
    await user.type(search, "000");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `เลือกผู้ป่วย ${patient.displayName}` }));
    await confirmNoAllergy(user);
    const complaint = screen.getByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));

    await waitFor(() => expect(firstPatientContextRequests).toBeGreaterThan(1));
    await waitFor(() => expect(resolveOldReload).toBeTypeOf("function"));
    await user.type(search, "000");
    await waitFor(() => expect(screen.getByText(secondPatient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: `เลือกผู้ป่วย ${secondPatient.displayName}` }));
    const secondPatientAnswer = await screen.findByRole("radio", { name: "ไม่แพ้" });
    await waitFor(() => expect(secondPatientAnswer).toBeEnabled());
    expect(complaint).toHaveValue("ไอ");

    await act(async () => {
      resolveOldReload?.(new Response(JSON.stringify(allergyContext({ ...patient, revision: 5 })), { status: 200 }));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    expect(screen.queryByText("กรุณาตรวจสอบข้อมูล")).not.toBeInTheDocument();
    expect(screen.queryByText("โหลดข้อมูลล่าสุดแล้ว กรุณายืนยันคำตอบประวัติแพ้ยาอีกครั้ง")).not.toBeInTheDocument();
    expect(screen.queryByText("ยังโหลดข้อมูลแพ้ยาล่าสุดไม่สำเร็จ กรุณาลองโหลดอีกครั้งก่อนยืนยันคำตอบ")).not.toBeInTheDocument();
    expect(secondPatientAnswer).not.toHaveFocus();
    expect(secondPatientAnswer).not.toBeChecked();
    expect(screen.getByRole("button", { name: /ส่งพบแพทย์/ })).toBeDisabled();
    expect(intakePosts).toBe(1);
  });

  it("creates a new Intake attempt when an Allergy value changes after a failure", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const keys: string[] = [];
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return bodies.length === 1
          ? jsonError("INTERNAL_ERROR", "ระบบไม่พร้อมใช้งาน", 500)
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "แพ้" }));
    await user.type(screen.getByRole("textbox", { name: /สารที่แพ้/ }), "ยา A");
    await user.type(screen.getByRole("textbox", { name: /อาการแพ้/ }), "ผื่น");
    const note = screen.getByRole("textbox", { name: /หมายเหตุ/ });
    await user.type(note, "สังเกตอาการ");
    await user.type(screen.getByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByText("ยังบันทึกไม่ได้")).toBeInTheDocument());

    await user.type(note, " เพิ่มเติม");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect(keys[1]).not.toBe(keys[0]);
    expect((bodies[1] as { payload: { allergy: { items: Array<{ note: string | null }> } } }).payload.allergy.items[0].note).toBe("สังเกตอาการ เพิ่มเติม");
  });

  it("prefills prior PRESENT Allergy items without choosing an Intake answer", async () => {
    const user = userEvent.setup();
    const presentAllergy = {
      ...unknownAllergy,
      id: "allergy-2",
      revision: 3,
      state: "PRESENT" as const,
      items: [{ substance: "ยา A", reaction: "ผื่น", severity: "MODERATE" as const, note: "หลีกเลี่ยง" }],
      sourceText: "บัตรแพ้ยา",
      reason: "ทบทวนล่าสุด",
      reviewedBy: { id: "assistant-1", displayName: "ผู้ช่วยทดสอบ" },
      reviewedAt: "2026-08-03T01:00:00.000Z",
    };
    server.use(
      validPatientSearch(),
      http.get("/api/patients/patient-1/allergy-assessment", () => HttpResponse.json(allergyContext(patient, presentAllergy))),
    );
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await screen.findByText("มีประวัติแพ้ยา");
    expect(screen.getByRole("radio", { name: "ไม่แพ้" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "แพ้" })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: "แพ้" }));
    expect(screen.getByRole("textbox", { name: /สารที่แพ้/ })).toHaveValue("ยา A");
    expect(screen.getByRole("textbox", { name: /อาการแพ้/ })).toHaveValue("ผื่น");
    expect(screen.getByRole("combobox", { name: "ความรุนแรง" })).toHaveDisplayValue("ปานกลาง");
    expect(screen.getByRole("textbox", { name: /หมายเหตุ/ })).toHaveValue("หลีกเลี่ยง");
  });

  it("limits reported Allergy item editors to twenty", async () => {
    const user = userEvent.setup();
    server.use(validPatientSearch());
    renderIntake();

    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(await screen.findByRole("radio", { name: "แพ้" }));
    const add = screen.getByRole("button", { name: "เพิ่มรายการแพ้" });
    for (let index = 1; index < 20; index += 1) await user.click(add);

    expect(screen.getAllByRole("textbox", { name: /สารที่แพ้/ })).toHaveLength(20);
    expect(add).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "ลบรายการแพ้ 20" }));
    expect(screen.getAllByRole("textbox", { name: /สารที่แพ้/ })).toHaveLength(19);
  });

  it("searches, selects an existing Patient, and navigates only after a committed 201", async () => {
    const user = userEvent.setup();
    let intakeRequests = 0;
    let intakeBody: unknown;
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", async ({ request }) => {
        intakeRequests += 1;
        intakeBody = await request.json();
        return HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();

    const search = await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ });
    await user.type(search, "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    expect(screen.getByText(new RegExp(`HN ${patient.hn}`))).toBeInTheDocument();
    await confirmNoAllergy(user);
    await user.type(screen.getByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");

    expect(router.state.location.pathname).toBe("/intake");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(intakeRequests).toBe(1);
    expect(intakeBody).toEqual({
      expectedRevisions: { patient: patient.revision },
      payload: {
        patientId: patient.id,
        chiefComplaint: "ไอ",
        vitals: {
          weightKg: null,
          heightCm: null,
          temperatureC: null,
          systolicMmhg: null,
          diastolicMmhg: null,
          heartRateBpm: null,
          spo2Percent: null,
        },
        allergy: { answer: "NO", items: [], changeReason: null },
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });

  it("creates a synthetic Patient with an empty payload and exposes no identity inputs", async () => {
    const user = userEvent.setup();
    let generationBody: unknown;
    server.use(
      http.post("/api/patients/synthetic", async ({ request }) => {
        generationBody = await request.json();
        return HttpResponse.json({ data: patient, replayed: false }, { status: 201 });
      }),
    );
    renderIntake();

    expect(screen.queryByLabelText(/ชื่อ|นามสกุล|เบอร์โทร|อายุ|เพศ/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    expect(generationBody).toEqual({ expectedRevisions: {}, payload: {} });
  });

  it("keeps the selected Patient and draft when Intake fails, then retries with one key", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const bodies: unknown[] = [];
    let attempts = 0;
    server.use(
      http.post("/api/patients/synthetic", () => HttpResponse.json({ data: patient, replayed: false }, { status: 201 })),
      http.post("/api/visits/intake", async ({ request }) => {
        attempts += 1;
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return attempts === 1
          ? jsonError("INTERNAL_ERROR", "ระบบไม่พร้อมใช้งาน", 503)
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();
    await user.click(await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await confirmNoAllergy(user);
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอเรื้อรัง");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByText("ยังบันทึกไม่ได้")).toBeInTheDocument());
    expect(complaint).toHaveValue("ไอเรื้อรัง");
    await user.click(screen.getByRole("button", { name: /ลองบันทึกอีกครั้ง|ลองใหม่/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("creates a fresh Intake attempt when the draft is edited, while explicit retry keeps the old attempt", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const keys: string[] = [];
    let attempts = 0;
    server.use(
      http.post("/api/patients/synthetic", () => HttpResponse.json({ data: patient, replayed: false }, { status: 201 })),
      http.post("/api/visits/intake", async ({ request }) => {
        attempts += 1;
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return attempts === 1
          ? jsonError("INTERNAL_ERROR", "ระบบไม่พร้อมใช้งาน", 503)
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();
    await user.click(await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await confirmNoAllergy(user);
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByText("ยังบันทึกไม่ได้")).toBeInTheDocument());

    await user.clear(complaint);
    await user.type(complaint, "ไข้");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect((bodies[0] as { payload: { chiefComplaint: string } }).payload.chiefComplaint).toBe("ไอ");
    expect((bodies[1] as { payload: { chiefComplaint: string } }).payload.chiefComplaint).toBe("ไข้");
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("clears an old Intake attempt and errors when generating another Patient with an empty draft", async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    const keys: string[] = [];
    let generationCount = 0;
    server.use(
      http.post("/api/patients/synthetic", () => {
        generationCount += 1;
        return HttpResponse.json({ data: generationCount === 1 ? patient : secondPatient, replayed: false }, { status: 201 });
      }),
      http.post("/api/visits/intake", async ({ request }) => {
        bodies.push(await request.json());
        keys.push(request.headers.get("Idempotency-Key") ?? "");
        return bodies.length === 1
          ? jsonError("VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูล", 422, {
            fieldErrors: { "payload.chiefComplaint": "กรุณาระบุอาการสำคัญ" },
          })
          : HttpResponse.json(intakeResponse, { status: 201 });
      }),
    );
    const router = renderIntake();
    const generate = await screen.findByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ });
    await user.click(generate);
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await confirmNoAllergy(user);
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByText("กรุณาระบุอาการสำคัญ")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    await waitFor(() => expect(screen.getByText(secondPatient.displayName)).toBeInTheDocument());
    expect(screen.queryByText("กรุณาระบุอาการสำคัญ")).not.toBeInTheDocument();
    await confirmNoAllergy(user);
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไข้");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
    expect((bodies[1] as { payload: { patientId: string; chiefComplaint: string } }).payload).toMatchObject({
      patientId: secondPatient.id,
      chiefComplaint: "ไข้",
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("locks Patient selection while synthetic generation is pending", async () => {
    const user = userEvent.setup();
    let resolveGeneration!: (response: Response) => void;
    server.use(
      validPatientSearch(),
      http.post("/api/patients/synthetic", () => new Promise((resolve) => { resolveGeneration = resolve; })),
    );
    renderIntake();
    const search = await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ });
    await user.type(search, "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await user.click(screen.getByRole("button", { name: /สร้างผู้ป่วยสังเคราะห์/ }));
    expect(search).toBeDisabled();
    resolveGeneration(new Response(JSON.stringify({ data: secondPatient, replayed: false }), { status: 201 }));
    await waitFor(() => expect(screen.getByText(secondPatient.displayName)).toBeInTheDocument());
  });

  it("locks Patient selection while Intake is pending", async () => {
    const user = userEvent.setup();
    let resolveIntake!: (response: Response) => void;
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => new Promise((resolve) => { resolveIntake = resolve; })),
    );
    renderIntake();
    const search = await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ });
    await user.type(search, "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    await user.type(await screen.findByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(search).toBeDisabled();
    resolveIntake(new Response(JSON.stringify(intakeResponse), { status: 201 }));
  });

  it("shows 422 field and summary errors, focuses the first invalid field, and preserves the route", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => jsonError("VALIDATION_FAILED", "กรุณาตรวจสอบข้อมูล", 422, {
        fieldErrors: {
          "payload.chiefComplaint": "กรุณาระบุอาการสำคัญ",
          "payload.vitals.temperatureC": "อุณหภูมิไม่ถูกต้อง",
        },
      })),
    );
    const router = renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("กรุณาตรวจสอบข้อมูล"));
    expect(router.state.location.pathname).toBe("/intake");
    await waitFor(() => expect(screen.getByRole("textbox", { name: /อาการสำคัญ/ })).toHaveFocus());
    expect(screen.getByText("กรุณาระบุอาการสำคัญ")).toBeInTheDocument();
  });

  it("shows a visible Patient search error and offers an explicit retry", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(http.get("/api/patients/search", () => {
      requests += 1;
      return requests < 3
        ? jsonError("INTERNAL_ERROR", "ระบบค้นหาผู้ป่วยไม่พร้อมใช้งาน", 503)
        : HttpResponse.json({ data: [patient] });
    }));

    renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    expect(await screen.findByRole("alert", {}, { timeout: 3_000 })).toHaveTextContent("ระบบค้นหาผู้ป่วยไม่พร้อมใช้งาน");
    const retry = screen.getByRole("button", { name: /ลองค้นหาอีกครั้ง/ });
    await user.click(retry);
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    expect(requests).toBe(3);
  });

  it("keeps the draft and offers a Queue recovery link for an active visit", async () => {
    const user = userEvent.setup();
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => jsonError("ACTIVE_VISIT_EXISTS", "ผู้ป่วยมีคิวที่กำลังดำเนินการ", 409)),
    );
    renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    const complaint = await screen.findByRole("textbox", { name: /อาการสำคัญ/ });
    await user.type(complaint, "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    await waitFor(() => expect(screen.getByRole("link", { name: "โหลดคิวล่าสุด" })).toBeInTheDocument());
    expect(complaint).toHaveValue("ไอ");
    expect(screen.getByRole("link", { name: "โหลดคิวล่าสุด" })).toHaveAttribute("href", "/queue");
  });

  it("does not claim success or write browser storage before the server commits", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    server.use(
      validPatientSearch(),
      http.post("/api/visits/intake", () => new Promise((resolve) => { resolveRequest = resolve; })),
    );
    const router = renderIntake();
    await user.type(await screen.findByRole("textbox", { name: /ค้นหา|ผู้ป่วย/ }), "000123");
    await waitFor(() => expect(screen.getByText(patient.displayName)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /เลือกผู้ป่วย/ }));
    await confirmNoAllergy(user);
    await user.type(await screen.findByRole("textbox", { name: /อาการสำคัญ/ }), "ไอ");
    await user.click(screen.getByRole("button", { name: /ส่งพบแพทย์/ }));
    expect(screen.queryByText(/ส่งเข้าคิวแล้ว|บันทึกสำเร็จ/)).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    resolveRequest(new Response(JSON.stringify(intakeResponse), { status: 201 }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/queue"));
  });
});
