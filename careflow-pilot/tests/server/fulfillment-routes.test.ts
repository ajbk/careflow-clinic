import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { medicationDecisions, medicationOrderItems, medications } from "../../src/server/modules/medication/index.js";
import { patients } from "../../src/server/modules/patient/index.js";
import { auditEvents } from "../../src/server/modules/platform/index.js";
import {
  inventoryLots,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryStockMovements,
} from "../../src/server/modules/inventory/index.js";
import { visits } from "../../src/server/modules/visit/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const test = await createTestApp();
  cleanups.push(test.cleanup);
  const assistant = await seedAccount(test.database, {
    id: "assistant-001", username: "assistant", role: "assistant", displayName: "ผู้ช่วยทดสอบ", mustChangePassword: false,
  });
  const doctor = await seedAccount(test.database, {
    id: "doctor-001", username: "doctor", role: "doctor", displayName: "พญ. ทดสอบ", mustChangePassword: false,
  });
  const now = "2026-08-03T00:00:00.000Z";
  test.database.db.insert(patients).values({
    id: "patient-route-001", clinicId: "clinic", hn: "DEMO-000001", displayName: "ผู้ป่วยทดสอบ 000001",
    phone: "0000000001", birthDate: "1990-01-01", sex: "unknown", revision: 1, createdAt: now, updatedAt: now,
  }).run();
  test.database.db.insert(visits).values({
    id: "visit-route-001", clinicId: "clinic", patientId: "patient-route-001", status: "AWAITING_PREPARATION",
    chiefComplaint: "อาการสังเคราะห์", revision: 3, arrivedAt: now, startedAt: now, closedAt: null, createdBy: doctor.actor.id,
  }).run();
  test.database.db.insert(medicationDecisions).values({
    id: "decision-route-001", visitId: "visit-route-001", version: 1, kind: "ORDER", noMedicationReason: null,
    revisionReason: null, supersedesId: null, signedBy: doctor.actor.id, signedByDisplayName: doctor.actor.displayName,
    signedAt: now, contentHash: "a".repeat(64),
  }).run();
  const medication = test.database.db.select().from(medications).where(eq(medications.id, "DEMO-MED-001")).get();
  if (!medication) throw new Error("missing medication fixture");
  test.database.db.insert(medicationOrderItems).values({
    id: "order-route-001", medicationDecisionId: "decision-route-001", position: 0, medicationId: medication.id,
    medicationRevision: medication.revision, displayNameSnapshot: medication.displayName,
    strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText,
    unitSnapshot: medication.canonicalUnit, quantity: 3, directionsTh: "รับประทานตามคำสั่งสังเคราะห์",
  }).run();
  test.database.db.insert(inventoryReceipts).values({
    id: "receipt-route-001", clinicId: "clinic", supplierName: "ผู้จำหน่ายสังเคราะห์", note: "รับเข้าทดสอบ",
    receivedAt: now, receivedBy: doctor.actor.id,
  }).run();
  test.database.db.insert(inventoryLots).values({
    id: "lot-route-001", clinicId: "clinic", medicationId: medication.id, medicationRevision: medication.revision,
    displayNameSnapshot: medication.displayName, strengthSnapshot: medication.strengthText,
    dosageFormSnapshot: medication.dosageFormText, unitSnapshot: medication.canonicalUnit,
    lotNumber: "LOT-ROUTE-001", expiryDate: "2026-08-10", supplierName: "ผู้จำหน่ายสังเคราะห์",
    status: "AVAILABLE", createdAt: now, createdBy: doctor.actor.id,
  }).run();
  test.database.db.insert(inventoryReceiptLines).values({
    id: "line-route-001", receiptId: "receipt-route-001", lotId: "lot-route-001", quantity: 5, unitSnapshot: medication.canonicalUnit,
  }).run();
  test.database.db.insert(inventoryStockMovements).values({
    id: "movement-route-001", clinicId: "clinic", lotId: "lot-route-001", movementType: "RECEIPT", quantityDelta: 5,
    sourceType: "RECEIPT", sourceId: "receipt-route-001", reason: "รับเข้าทดสอบ", occurredAt: now, actorId: doctor.actor.id,
  }).run();
  return {
    ...test,
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
  };
}

describe("authenticated fulfillment reservation routes", () => {
  it("requires authentication and returns a signed Pick List for Assistant and Doctor", async () => {
    const test = await fixture();
    const anonymous = await test.app.inject({ method: "GET", url: "/api/dispensing/visit-route-001" });
    expect(anonymous.statusCode).toBe(401);

    const assistant = await test.app.inject({
      method: "GET", url: "/api/dispensing/visit-route-001", headers: { cookie: test.assistantCookie },
    });
    expect(assistant.statusCode).toBe(200);
    expect(assistant.json().data).toMatchObject({
      visit: { id: "visit-route-001", status: "AWAITING_PREPARATION" },
      medicationDecision: { kind: "ORDER", id: "decision-route-001" },
      reservation: null,
    });

    const doctor = await test.app.inject({
      method: "GET", url: "/api/dispensing/visit-route-001", headers: { cookie: test.doctorCookie },
    });
    expect(doctor.statusCode).toBe(200);
    expect(doctor.json().data).toEqual(assistant.json().data);
  });

  it("reserves with exact envelope replay, audits start, and releases with exact replay", async () => {
    const test = await fixture();
    const body = { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} };
    const first = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-001" }, payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ visit: { status: "PREPARING", revision: 4 }, reservation: { status: "ACTIVE" } });
    const replay = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-001" }, payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual(first.json().data);
    expect(replay.json().replayed).toBe(true);
    expect(test.database.db.select().from(auditEvents).all().map((row) => row.action)).toEqual([
      "inventory.reservation-created", "visit.preparation-started",
    ]);
    const createdAudit = test.database.db.select().from(auditEvents).all()
      .find((event) => event.action === "inventory.reservation-created");
    expect(JSON.parse(createdAudit?.metadataJson ?? "{}")).toMatchObject({
      visitId: "visit-route-001",
      allocations: [{ lotId: "lot-route-001", quantity: 3, unit: "เม็ด" }],
    });

    const releaseBody = {
      expectedRevisions: { visit: 4 },
      payload: { reason: "ทบทวนคำสั่งก่อนจัดยา" },
    };
    const released = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservation-release",
      headers: { cookie: test.assistantCookie, "idempotency-key": "release-route-001" }, payload: releaseBody,
    });
    expect(released.statusCode).toBe(201);
    expect(released.json().data).toMatchObject({ visit: { status: "AWAITING_PREPARATION", revision: 5 }, reservation: { status: "RELEASED" } });
    const releaseReplay = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservation-release",
      headers: { cookie: test.assistantCookie, "idempotency-key": "release-route-001" }, payload: releaseBody,
    });
    expect(releaseReplay.statusCode).toBe(200);
    expect(releaseReplay.json().data).toEqual(released.json().data);
    const releasedAudit = test.database.db.select().from(auditEvents).all()
      .find((event) => event.action === "inventory.reservation-released");
    expect(JSON.parse(releasedAudit?.metadataJson ?? "{}")).toMatchObject({
      visitId: "visit-route-001",
      allocations: [{ lotId: "lot-route-001", quantity: 3, unit: "เม็ด" }],
    });
  });

  it("enforces strict reservation commands and Doctor reserve permission", async () => {
    const test = await fixture();
    const invalid = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "reserve-route-invalid" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {}, extra: true },
    });
    expect(invalid.statusCode).toBe(422);

    const doctor = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "reserve-route-doctor" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} },
    });
    expect(doctor.statusCode).toBe(201);
  });
});
