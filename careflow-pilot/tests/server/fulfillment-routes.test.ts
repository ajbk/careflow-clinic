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

function countRows(test: Awaited<ReturnType<typeof fixture>>, sql: string): number {
  return Number((test.database.sqlite.prepare(sql).get() as { count: number }).count);
}

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

  it("reads the current label only for an authenticated fulfillment actor", async () => {
    const test = await fixture();
    const anonymous = await test.app.inject({ method: "GET", url: "/api/dispensing/visit-route-001/labels" });
    expect(anonymous.statusCode).toBe(401);
    const response = await test.app.inject({
      method: "GET", url: "/api/dispensing/visit-route-001/labels", headers: { cookie: test.assistantCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: null });
  });

  it("reserves with exact envelope replay, audits start, and releases with exact replay", async () => {
    const test = await fixture();
    const body = { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} };
    const first = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-001" }, payload: body,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({ visit: { status: "PREPARING", revision: 4 }, reservation: { allocations: [{ lotId: "lot-route-001", quantity: 3 }] }, preparation: { status: "ACTIVE" } });
    const replay = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-001" }, payload: body,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual(first.json().data);
    expect(replay.json().replayed).toBe(true);
    const differentKey = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-different" }, payload: { expectedRevisions: { visit: 4, medicationDecision: 1 }, payload: {} },
    });
    expect(differentKey.statusCode).toBe(200);
    expect(differentKey.json().data).toEqual(first.json().data);
    expect(differentKey.json().replayed).toBe(false);
    expect(test.database.db.select().from(auditEvents).all().map((row) => row.action)).toEqual([
      "label.version-created", "inventory.reservation-created", "visit.preparation-started",
    ]);
    const createdAudit = test.database.db.select().from(auditEvents).all()
      .find((event) => event.action === "inventory.reservation-created");
    expect(JSON.parse(createdAudit?.metadataJson ?? "{}")).toMatchObject({
      visitId: "visit-route-001",
      allocations: [{ lotId: "lot-route-001", quantity: 3 }],
    });

    const releaseBody = {
      expectedRevisions: { visit: 4, preparation: first.json().data.preparation.revision },
      payload: { preparationId: first.json().data.preparation.id, reason: "ทบทวนคำสั่งก่อนจัดยา" },
    };
    const released = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservation-release",
      headers: { cookie: test.assistantCookie, "idempotency-key": "release-route-001" }, payload: releaseBody,
    });
    expect(released.statusCode).toBe(201);
    expect(released.json().data).toMatchObject({ visit: { status: "AWAITING_PREPARATION", revision: 5 }, reservation: null, preparation: null });
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

  it("prints, confirms a normalized barcode, and completes every allocated item", async () => {
    const test = await fixture();
    const started = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-start" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} },
    });
    const startedData = started.json().data;
    expect(startedData.allowedActions).not.toContain("RELEASE");
    const label = startedData.label;
    expect(label).toMatchObject({
      clinicNameSnapshot: "คลินิกชนบท CareFlow Pilot",
      patientHnSnapshot: "DEMO-000001",
      patientDisplayNameSnapshot: "ผู้ป่วยทดสอบ 000001",
      items: [{
        orderItemId: "order-route-001",
        medicationId: "DEMO-MED-001",
        medicationRevision: 1,
        displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A",
        strengthSnapshot: "500 หน่วยทดสอบ",
        dosageFormSnapshot: "เม็ดทดสอบ",
        quantity: 3,
        unitSnapshot: "เม็ด",
        directionsThSnapshot: "รับประทานตามคำสั่งสังเคราะห์",
        internalBarcode: "CF-DEMO-001",
      }],
    });
    const currentLabel = await test.app.inject({
      method: "GET", url: "/api/dispensing/visit-route-001/labels", headers: { cookie: test.assistantCookie },
    });
    expect(currentLabel.statusCode).toBe(200);
    expect(currentLabel.json().data).toEqual(label);
    const preparation = startedData.preparation;
    const allocation = startedData.reservation.allocations[0];
    const incomplete = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-incomplete" },
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } },
    });
    expect(incomplete.statusCode).toBe(409);
    const printed = await test.app.inject({
      method: "POST", url: `/api/dispensing/visit-route-001/labels/${label.id}/print-events`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-print" },
      payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test-renderer" } },
    });
    expect(printed.statusCode).toBe(201);
    const mismatchBefore = countRows(test, "SELECT count(*) AS count FROM fulfillment_preparation_confirmations");
    const mismatch = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-mismatch" },
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "WRONG-CODE" } },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_preparation_confirmations")).toBe(mismatchBefore);
    const confirmed = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-confirm" },
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: " cf-demo-001 " } },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().data.preparation.confirmations[0]).toMatchObject({ method: "BARCODE", barcode: "CF-DEMO-001", lotId: "lot-route-001" });
    const duplicateConfirmation = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-confirm-different" },
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } },
    });
    expect(duplicateConfirmation.statusCode).toBe(409);
    expect(duplicateConfirmation.json().error.code).toBe("ALLOCATION_ALREADY_CONFIRMED");
    const completed = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-complete" },
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().data).toMatchObject({ visit: { status: "AWAITING_RELEASE", revision: 5 }, preparation: { status: "COMPLETED", revision: 2 } });
    expect(completed.json().data.allowedActions).toEqual(["RELEASE", "REJECT"]);
  });

  it("rejects every old fulfillment command after clinical invalidation without extra writes", async () => {
    const test = await fixture();
    const started = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-start" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} },
    });
    const startedData = started.json().data;
    const allergy = await test.app.inject({
      method: "POST", url: "/api/patients/patient-route-001/allergy-revisions",
      headers: { cookie: test.doctorCookie, "idempotency-key": "invalidation-allergy" },
      payload: { expectedRevisions: { patient: 1, visit: 4 }, payload: { visitId: "visit-route-001", state: "PRESENT", items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }], sourceText: "ประวัติแพ้", reason: "ทบทวนความปลอดภัย" } },
    });
    expect(allergy.statusCode).toBe(201);
    const counts = () => ({ reservations: countRows(test, "SELECT count(*) AS count FROM inventory_reservations"), invalidations: countRows(test, "SELECT count(*) AS count FROM fulfillment_artifact_invalidations"), visits: countRows(test, "SELECT count(*) AS count FROM visits WHERE status='AWAITING_ORDER_REVISION' AND revision=5") });
    const before = counts();
    const print = await test.app.inject({
      method: "POST", url: `/api/dispensing/visit-route-001/labels/${startedData.label.id}/print-events`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-print" },
      payload: { expectedRevisions: { visit: 5 }, payload: { rendererVersion: "test-renderer" } },
    });
    const complete = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-complete" },
      payload: { expectedRevisions: { visit: 5, preparation: startedData.preparation.revision }, payload: { preparationId: startedData.preparation.id } },
    });
    const abandon = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservation-release",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-abandon" },
      payload: { expectedRevisions: { visit: 5, preparation: startedData.preparation.revision }, payload: { preparationId: startedData.preparation.id, reason: "คำสั่งเดิมถูกยกเลิก" } },
    });
    expect(print.statusCode).toBe(409);
    expect(complete.statusCode).toBe(409);
    expect(abandon.statusCode).toBe(409);
    expect(counts()).toEqual(before);
  });

  it("allows only a Doctor to release a fully printed and confirmed preparation", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "release-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} } });
    const started = start.json().data;
    const preparation = started.preparation;
    const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "release-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test" } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "release-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    const complete = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "release-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } } });
    expect(complete.statusCode).toBe(201);
    const releaseBody = { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } };
    const assistant = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.assistantCookie, "idempotency-key": "release-assistant" }, payload: releaseBody });
    expect(assistant.statusCode).toBe(403);
    const doctor = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "release-doctor" }, payload: releaseBody });
    expect(doctor.statusCode).toBe(201);
    expect(doctor.json().data).toMatchObject({ visit: { status: "AWAITING_HANDOFF", revision: 6 }, release: { reservationId: started.reservation.id }, allowedActions: ["HANDOFF"] });
    const doctorReplay = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "release-doctor" }, payload: releaseBody });
    expect(doctorReplay.statusCode).toBe(200);
    expect(doctorReplay.json()).toMatchObject({ data: doctor.json().data, replayed: true });
    const doctorCollision = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "release-doctor" }, payload: { ...releaseBody, payload: { ...releaseBody.payload, decisionVersion: 2 } } });
    expect(doctorCollision.statusCode).toBe(409);
    expect(doctorCollision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    const audit = test.database.db.select().from(auditEvents).all().find((event) => event.action === "fulfillment.released");
    expect(JSON.parse(audit?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_RELEASE", nextStatus: "AWAITING_HANDOFF", allocations: [{ allocationId: started.reservation.allocations[0].id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    const releaseActions = test.database.db.select({ action: auditEvents.action }).from(auditEvents).all().map((row) => row.action);
    expect(releaseActions).toContain("medication.release-created");
  });

  it("records Doctor rejection, preserves the label, and requires a later print sequence", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} } });
    const started = start.json().data; const preparation = started.preparation; const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "reject-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test" } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } } });
    const rejected = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reject", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-doctor" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, reason: "จำนวนยาไม่ตรงตามที่จัด" } } });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json().data).toMatchObject({ visit: { status: "AWAITING_PREPARATION", revision: 6 }, label: { id: started.label.id }, reservation: null, preparation: null });
    const rejectedReplay = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reject", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-doctor" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, reason: "จำนวนยาไม่ตรงตามที่จัด" } } });
    expect(rejectedReplay.statusCode).toBe(200);
    expect(rejectedReplay.json()).toMatchObject({ data: rejected.json().data, replayed: true });
    const rejectionAudits = test.database.db.select().from(auditEvents).all();
    for (const action of ["preparation.rejected", "inventory.reservation-released"]) {
      const event = rejectionAudits.find((row) => row.action === action);
      expect(event).toBeDefined();
      expect(JSON.parse(event?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_RELEASE", nextStatus: "AWAITING_PREPARATION", allocations: [{ allocationId: started.reservation.allocations[0].id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    }
    const restarted = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-restart" }, payload: { expectedRevisions: { visit: 6, medicationDecision: 1 }, payload: {} } });
    expect(restarted.statusCode).toBe(201);
    const next = restarted.json().data; const nextPreparation = next.preparation; const nextAllocation = next.reservation.allocations[0];
    expect(nextPreparation).toMatchObject({ status: "ACTIVE" });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-new-confirm" }, payload: { expectedRevisions: { visit: 7, preparation: nextPreparation.revision }, payload: { method: "BARCODE", preparationId: nextPreparation.id, allocationId: nextAllocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-new-complete" }, payload: { expectedRevisions: { visit: 7, preparation: nextPreparation.revision }, payload: { preparationId: nextPreparation.id } } });
    const oldPrintRelease = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-old-print" }, payload: { expectedRevisions: { visit: 8, preparation: 2 }, payload: { decisionId: next.medicationDecision.id, decisionVersion: next.medicationDecision.version, labelVersionId: next.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: nextPreparation.id, reservationId: next.reservation.id } } });
    expect(oldPrintRelease.statusCode).toBe(409);
  });

  it("hands off a released reservation atomically as one dispense movement per allocation", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} } });
    const started = start.json().data; const preparation = started.preparation; const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test" } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } } });
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "handoff-release" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    const releasedData = release.json().data;
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 1 });
    test.database.sqlite.prepare("UPDATE inventory_lots SET status = 'QUARANTINED' WHERE id = 'lot-route-001'").run();
    const handoffPayload = { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, releaseId: releasedData.release.id, reservationId: started.reservation.id };
    const staleHandoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-stale" }, payload: { expectedRevisions: { visit: 6 }, payload: { ...handoffPayload, decisionVersion: 2 } } });
    expect(staleHandoff.statusCode).toBe(409);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_dispenses")).toBe(0);
    const blocked = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-quarantined" }, payload: { expectedRevisions: { visit: 6 }, payload: handoffPayload } });
    expect(blocked.statusCode).toBe(409);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_dispenses")).toBe(0);
    expect(countRows(test, "SELECT count(*) AS count FROM inventory_stock_movements")).toBe(1);
    expect(test.database.sqlite.prepare("SELECT status FROM inventory_reservations WHERE id = ?").get(started.reservation.id)).toEqual({ status: "ACTIVE" });
    test.database.sqlite.prepare("UPDATE inventory_lots SET status = 'AVAILABLE' WHERE id = 'lot-route-001'").run();
    const handoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-ok" }, payload: { expectedRevisions: { visit: 6 }, payload: handoffPayload } });
    expect(handoff.statusCode).toBe(201);
    expect(handoff.json().data).toMatchObject({ visit: { status: "AWAITING_CHARGE", revision: 7 }, dispense: { reservationId: started.reservation.id, lines: [{ allocationId: allocation.id, lotId: "lot-route-001", quantity: 3 }] } });
    expect(test.database.sqlite.prepare("SELECT status FROM inventory_reservations WHERE id = ?").get(started.reservation.id)).toEqual({ status: "CONSUMED" });
    expect(test.database.sqlite.prepare("SELECT sum(quantity_delta) AS quantity FROM inventory_stock_movements WHERE lot_id = 'lot-route-001'").get()).toEqual({ quantity: 2 });
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 2 });
    const handoffAudits = test.database.db.select().from(auditEvents).all();
    for (const action of ["inventory.stock-dispensed", "dispense.handoff-confirmed", "visit.handoff-confirmed"]) {
      const event = handoffAudits.find((row) => row.action === action);
      expect(event).toBeDefined();
      expect(JSON.parse(event?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: releasedData.release.id, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_HANDOFF", nextStatus: "AWAITING_CHARGE", allocations: [{ allocationId: allocation.id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    }
    const handoffReplay = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-ok" }, payload: { expectedRevisions: { visit: 6 }, payload: handoffPayload } });
    expect(handoffReplay.statusCode).toBe(200);
    expect(handoffReplay.json()).toMatchObject({ data: handoff.json().data, replayed: true });
    const duplicate = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-new-key" }, payload: { expectedRevisions: { visit: 7 }, payload: handoffPayload } });
    expect(duplicate.statusCode).toBe(409);
  });

  it("consumes multiple allocated lots atomically and increments each touched lot exactly once", async () => {
    const test = await fixture();
    const now = "2026-08-03T00:00:00.000Z";
    const medication = test.database.db.select().from(medications).where(eq(medications.id, "DEMO-MED-002")).get();
    if (!medication) throw new Error("missing second medication fixture");
    test.database.db.insert(medicationOrderItems).values({
      id: "order-route-002", medicationDecisionId: "decision-route-001", position: 1, medicationId: medication.id,
      medicationRevision: medication.revision, displayNameSnapshot: medication.displayName,
      strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText,
      unitSnapshot: medication.canonicalUnit, quantity: 2, directionsTh: "รับประทานยาสังเคราะห์รายการที่สอง",
    }).run();
    test.database.db.insert(inventoryReceipts).values({
      id: "receipt-route-002", clinicId: "clinic", supplierName: "ผู้จำหน่ายสังเคราะห์", note: "รับเข้าทดสอบล็อตที่สอง",
      receivedAt: now, receivedBy: "doctor-001",
    }).run();
    test.database.db.insert(inventoryLots).values({
      id: "lot-route-002", clinicId: "clinic", medicationId: medication.id, medicationRevision: medication.revision,
      displayNameSnapshot: medication.displayName, strengthSnapshot: medication.strengthText,
      dosageFormSnapshot: medication.dosageFormText, unitSnapshot: medication.canonicalUnit,
      lotNumber: "LOT-ROUTE-002", expiryDate: "2026-08-10", supplierName: "ผู้จำหน่ายสังเคราะห์",
      status: "AVAILABLE", createdAt: now, createdBy: "doctor-001",
    }).run();
    test.database.db.insert(inventoryReceiptLines).values({ id: "line-route-002", receiptId: "receipt-route-002", lotId: "lot-route-002", quantity: 4, unitSnapshot: medication.canonicalUnit }).run();
    test.database.db.insert(inventoryStockMovements).values({ id: "movement-route-002", clinicId: "clinic", lotId: "lot-route-002", movementType: "RECEIPT", quantityDelta: 4, sourceType: "RECEIPT", sourceId: "receipt-route-002", reason: "รับเข้าทดสอบ", occurredAt: now, actorId: "doctor-001" }).run();

    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: {} } });
    expect(start.statusCode).toBe(201);
    const started = start.json().data;
    expect(started.reservation.allocations.map((item: { lotId: string }) => item.lotId)).toEqual(["lot-route-001", "lot-route-002"]);
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "multi-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test" } } });
    expect(printed.statusCode).toBe(201);
    let preparation = started.preparation;
    for (const allocation of started.reservation.allocations) {
      const item = started.label.items.find((labelItem: { orderItemId: string }) => labelItem.orderItemId === allocation.orderItemId);
      const confirmed = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": `multi-confirm-${allocation.id}` }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: item.internalBarcode } } });
      expect(confirmed.statusCode).toBe(201);
      preparation = confirmed.json().data.preparation;
    }
    const complete = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id } } });
    expect(complete.statusCode).toBe(201);
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "multi-release" }, payload: { expectedRevisions: { visit: 5, preparation: complete.json().data.preparation.revision }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: complete.json().data.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(release.statusCode).toBe(201);
    const handoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-handoff" }, payload: { expectedRevisions: { visit: 6 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: release.json().data.release.id, reservationId: started.reservation.id } } });
    expect(handoff.statusCode).toBe(201);
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id IN ('lot-route-001', 'lot-route-002') ORDER BY id").all()).toEqual([{ revision: 2 }, { revision: 2 }]);
    expect(test.database.sqlite.prepare("SELECT lot_id, quantity_delta FROM inventory_stock_movements WHERE movement_type = 'DISPENSE' ORDER BY lot_id").all()).toEqual([{ lot_id: "lot-route-001", quantity_delta: -3 }, { lot_id: "lot-route-002", quantity_delta: -2 }]);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "inventory.stock-dispensed")).toHaveLength(2);
  });
});
