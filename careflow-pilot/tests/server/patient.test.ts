import { afterEach, describe, expect, it } from "vitest";
import { auditEvents, clinicCounters } from "../../src/server/modules/platform/index.js";
import { patients } from "../../src/server/modules/patient/index.js";
import {
  createSyntheticPatientBodySchema,
  patientSearchQuerySchema,
} from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function authenticatedPatientApp(role: "assistant" | "doctor" = "assistant") {
  const fixture = await createTestApp();
  cleanups.push(fixture.cleanup);
  const account = await seedAccount(fixture.database, {
    username: role,
    role,
    displayName: role === "assistant" ? "ผู้ช่วยทดสอบ" : "พญ. ทดสอบ",
    mustChangePassword: false,
  });
  const cookie = cookieFrom(await login(fixture.app, account.username, account.password));
  return { ...fixture, account, cookie };
}

async function createSynthetic(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  cookie: string,
  key = "patient-create-001",
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie, "idempotency-key": key },
    payload: { expectedRevisions: {}, payload },
  });
}

describe("synthetic patient registry", () => {
  it("generates the complete Patient profile on the server", async () => {
    const fixture = await authenticatedPatientApp();

    const response = await createSynthetic(fixture.app, fixture.cookie);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      replayed: false,
      data: {
        hn: "DEMO-000001",
        displayName: "ผู้ป่วยทดสอบ 000001",
        phone: "0000000001",
        birthDate: "1990-01-01",
        sex: "unknown",
        revision: 1,
      },
    });
    expect(response.json().data.id).toEqual(expect.any(String));
    expect(response.json().data.createdAt).toBe("2026-08-03T00:00:00.000Z");
  });

  it("replays the same idempotent request without another Patient or Audit row", async () => {
    const fixture = await authenticatedPatientApp();

    const first = await createSynthetic(fixture.app, fixture.cookie, "patient-replay-001");
    const second = await createSynthetic(fixture.app, fixture.cookie, "patient-replay-001");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual({ data: first.json().data, replayed: true });
    expect(fixture.database.db.select().from(patients).all()).toHaveLength(1);
    expect(
      fixture.database.db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.action === "patient.synthetic-created"),
    ).toHaveLength(1);
  });

  it.each([
    { hn: "DEMO-999999" },
    { displayName: "ผู้ป่วยปลอม" },
    { phone: "0812345678" },
    { arbitrary: "nope" },
  ])("rejects client-supplied Patient fields: %j", async (payload) => {
    const fixture = await authenticatedPatientApp();

    const response = await createSynthetic(fixture.app, fixture.cookie, "patient-extra-001", payload);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(fixture.database.db.select().from(patients).all()).toHaveLength(0);
    expect(
      fixture.database.db
        .select()
        .from(auditEvents)
        .all()
        .filter((event) => event.action === "patient.synthetic-created"),
    ).toHaveLength(0);
  });

  it("rejects own __proto__ keys before strict object parsing", async () => {
    const fixture = await authenticatedPatientApp();
    const body = JSON.parse(
      '{"expectedRevisions":{"__proto__":1},"payload":{"__proto__":1}}',
    ) as Record<string, unknown>;

    expect(createSyntheticPatientBodySchema.safeParse(body).success).toBe(false);
    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/patients/synthetic",
      payload: JSON.stringify(body),
      headers: {
        cookie: fixture.cookie,
        "idempotency-key": "patient-proto-001",
        "content-type": "application/json",
      },
    });

    // Fastify's JSON parser rejects prototype-pollution keys before route parsing;
    // both parser and schema paths remain the stable VALIDATION_FAILED contract.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(fixture.database.db.select().from(patients).all()).toHaveLength(0);
    expect(fixture.database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it("rejects deeply nested JSON without overflowing the validation guard", async () => {
    const fixture = await authenticatedPatientApp();
    let nested = "{}";
    for (let depth = 0; depth < 5_000; depth += 1) nested = `{"nested":${nested}}`;
    const rawBody = `{"expectedRevisions":{},"payload":${nested}}`;

    const response = await fixture.app.inject({
      method: "POST",
      url: "/api/patients/synthetic",
      payload: rawBody,
      headers: {
        cookie: fixture.cookie,
        "idempotency-key": "patient-deep-001",
        "content-type": "application/json",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
    expect(fixture.database.db.select().from(patients).all()).toHaveLength(0);
    expect(fixture.database.db.select().from(auditEvents).all()).toHaveLength(0);
  });

  it("bounds search queries by Unicode code points rather than UTF-16 units", () => {
    expect(patientSearchQuerySchema.safeParse({ q: "😀".repeat(80) }).success).toBe(true);
    expect(patientSearchQuerySchema.safeParse({ q: "😀".repeat(81) }).success).toBe(false);
  });

  it("requires authentication and permits both Assistant and Doctor", async () => {
    const assistant = await authenticatedPatientApp("assistant");
    const doctor = await authenticatedPatientApp("doctor");

    const anonymous = await assistant.app.inject({
      method: "GET",
      url: "/api/patients/search?q=DEMO-000001",
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await createSynthetic(assistant.app, assistant.cookie, "patient-assistant-001")).statusCode).toBe(201);
    expect((await createSynthetic(doctor.app, doctor.cookie, "patient-doctor-001")).statusCode).toBe(201);
  });

  it("returns a strict Patient Allergy context only after the patient:read permission check", async () => {
    const fixture = await authenticatedPatientApp();
    const created = await createSynthetic(fixture.app, fixture.cookie, "patient-allergy-context-001");
    const patientId = created.json().data.id as string;

    const anonymous = await fixture.app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/allergy-assessment`,
    });
    const authorized = await fixture.app.inject({
      method: "GET",
      url: `/api/patients/${patientId}/allergy-assessment`,
      headers: { cookie: fixture.cookie },
    });
    const missing = await fixture.app.inject({
      method: "GET",
      url: "/api/patients/not-a-patient/allergy-assessment",
      headers: { cookie: fixture.cookie },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().data).toMatchObject({
      patient: { id: patientId, revision: 1 },
      allergy: {
        id: null,
        revision: 0,
        state: "UNKNOWN",
        items: [],
        sourceText: null,
        reason: null,
        reviewedBy: null,
        reviewedAt: null,
      },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("searches HN, Thai name, and phone without treating wildcards as SQL wildcards", async () => {
    const fixture = await authenticatedPatientApp();
    const created = await createSynthetic(fixture.app, fixture.cookie);
    const patientId = created.json().data.id;

    for (const q of ["DEMO-000001", "ผู้ป่วยทดสอบ", "0000000001"]) {
      const response = await fixture.app.inject({
        method: "GET",
        url: `/api/patients/search?q=${encodeURIComponent(q)}`,
        headers: { cookie: fixture.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toHaveLength(1);
      expect(response.json().data[0].id).toBe(patientId);
    }

    const wildcard = await fixture.app.inject({
      method: "GET",
      url: "/api/patients/search?q=%25%25",
      headers: { cookie: fixture.cookie },
    });
    expect(wildcard.statusCode).toBe(200);
    expect(wildcard.json().data).toEqual([]);
  });

  it("records a named creation Audit Event and allocates the counter atomically", async () => {
    const fixture = await authenticatedPatientApp();

    await createSynthetic(fixture.app, fixture.cookie);

    expect(fixture.database.db.select().from(clinicCounters).get()).toMatchObject({
      key: "synthetic_patient",
      value: 1,
    });
    expect(fixture.database.db.select().from(auditEvents).all()).toEqual([
      expect.objectContaining({
        actorId: fixture.account.actor.id,
        actorRole: "assistant",
        action: "patient.synthetic-created",
        entityType: "patient",
        entityRevision: 1,
      }),
    ]);
  });

  it("rejects invalid direct SQL identity and demographic values", async () => {
    const fixture = await authenticatedPatientApp();

    expect(() =>
      fixture.database.sqlite
        .prepare(
          `INSERT INTO patients (
            id, clinic_id, hn, display_name, phone, birth_date, sex,
            revision, created_at, updated_at
          ) VALUES (?, 'clinic', ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          "patient-invalid",
          "DEMO-123456",
          "คนไข้จริง",
          "0812345678",
          "2000-01-01",
          "female",
          "2026-08-03T00:00:00.000Z",
          "2026-08-03T00:00:00.000Z",
        ),
    ).toThrow();
    expect(fixture.database.db.select().from(patients).all()).toHaveLength(0);
  });
});
