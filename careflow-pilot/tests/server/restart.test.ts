import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/client.js";
import { auditEvents } from "../../src/server/modules/platform/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("real-file restart boundary", () => {
  it("preserves sessions, intake evidence, revisions, and audit IDs across a close/reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "careflow-restart-"));
    const databasePath = join(directory, "careflow.sqlite");
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));

    const firstDatabase = openDatabase(databasePath);
    const firstConfig = {
      host: "127.0.0.1",
      port: 3001,
      databasePath,
      cookieSecure: false,
      sessionIdleMinutes: 15,
      sessionAbsoluteHours: 8,
      clientDistPath: "./dist/client",
    } as const;
    const firstApp = await buildApp({
      db: firstDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: (() => {
        let index = 0;
        return () => `restart-${++index}`;
      })(),
    });
    await firstApp.ready();

    const assistant = await seedAccount(firstDatabase as never, {
      id: "assistant-restart-001",
      username: "restart-assistant",
      role: "assistant",
      displayName: "ผู้ช่วยรีสตาร์ต",
      mustChangePassword: false,
    });
    const doctor = await seedAccount(firstDatabase as never, {
      id: "doctor-restart-001",
      username: "restart-doctor",
      role: "doctor",
      displayName: "พญ. รีสตาร์ต",
      mustChangePassword: false,
    });

    const assistantCookie = cookieFrom(await login(firstApp, assistant.username, assistant.password));
    const doctorCookie = cookieFrom(await login(firstApp, doctor.username, doctor.password));
    for (const cookie of [assistantCookie, doctorCookie]) {
      const acknowledged = await firstApp.inject({
        method: "POST",
        url: "/api/auth/acknowledge-pilot",
        headers: { cookie },
        payload: { accepted: true },
      });
      expect(acknowledged.statusCode).toBe(204);
    }

    const patientResponse = await firstApp.inject({
      method: "POST",
      url: "/api/patients/synthetic",
      headers: { cookie: assistantCookie, "idempotency-key": "restart-patient-001" },
      payload: { expectedRevisions: {}, payload: {} },
    });
    expect(patientResponse.statusCode).toBe(201);
    const patient = patientResponse.json().data;
    const intakeResponse = await firstApp.inject({
      method: "POST",
      url: "/api/visits/intake",
      headers: { cookie: assistantCookie, "idempotency-key": "restart-intake-001" },
      payload: {
        expectedRevisions: { patient: patient.revision },
        payload: {
          patientId: patient.id,
          chiefComplaint: "ไอและมีไข้",
          vitals: {
            weightKg: 60,
            heightCm: 165,
            temperatureC: 37.5,
            systolicMmhg: 120,
            diastolicMmhg: 80,
            heartRateBpm: 80,
            spo2Percent: 98,
          },
        },
      },
    });
    expect(intakeResponse.statusCode).toBe(201);
    const intake = intakeResponse.json().data;
    const visitId = intake.visit.id as string;
    const started = await firstApp.inject({
      method: "POST",
      url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: doctorCookie, "idempotency-key": "restart-start-001" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().data.visit).toMatchObject({ id: visitId, status: "CONSULTING", revision: 2 });

    const beforeAuditIds = firstDatabase.sqlite
      .prepare("SELECT id FROM audit_events ORDER BY id")
      .pluck()
      .all() as string[];
    const beforeSessionCount = firstDatabase.sqlite
      .prepare("SELECT count(*) FROM sessions")
      .pluck()
      .get();
    const workspaceBefore = await firstApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: assistantCookie },
    });
    expect(workspaceBefore.statusCode).toBe(200);
    const intakeId = workspaceBefore.json().data.intake.id as string;
    await firstApp.close();
    firstDatabase.close();

    const secondDatabase = openDatabase(databasePath);
    const secondApp = await buildApp({
      db: secondDatabase,
      config: firstConfig,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: () => "restart-after-request",
    });
    await secondApp.ready();
    cleanups.push(async () => {
      await secondApp.close();
      secondDatabase.close();
    });

    const workspaceAfter = await secondApp.inject({
      method: "GET",
      url: `/api/visits/${visitId}/workspace`,
      headers: { cookie: assistantCookie },
    });
    expect(workspaceAfter.statusCode).toBe(200);
    expect(workspaceAfter.json().data).toMatchObject({
      visit: { id: visitId, status: "CONSULTING", revision: 2 },
      patient: { id: patient.id, hn: patient.hn },
      intake: { id: intakeId, chiefComplaint: "ไอและมีไข้" },
    });
    const queueAfter = await secondApp.inject({
      method: "GET",
      url: "/api/queue",
      headers: { cookie: doctorCookie },
    });
    expect(queueAfter.statusCode).toBe(200);
    expect(queueAfter.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ visit: expect.objectContaining({ id: visitId, status: "CONSULTING", revision: 2 }) }),
      ]),
    );
    expect(secondDatabase.sqlite.prepare("SELECT count(*) FROM sessions").pluck().get()).toBe(beforeSessionCount);
    expect(secondDatabase.sqlite.prepare("SELECT id FROM audit_events ORDER BY id").pluck().all()).toEqual(beforeAuditIds);
    expect(secondDatabase.db.select().from(auditEvents).all().map((event) => event.entityId)).toEqual(
      expect.arrayContaining([patient.id, visitId]),
    );
  });
});
