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
import { fulfillmentLabelItems, fulfillmentLabelVersions } from "../../src/server/modules/fulfillment/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];
const startPayload = { labelVersionId: "label-route-001" };

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
  test.database.db.insert(fulfillmentLabelVersions).values({
    id: "label-route-001", clinicId: "clinic", visitId: "visit-route-001", medicationDecisionId: "decision-route-001",
    medicationDecisionVersion: 1, version: 1, createdAt: now, createdBy: doctor.actor.id,
    patientHnSnapshot: "DEMO-000001", patientDisplayNameSnapshot: "ผู้ป่วยทดสอบ 000001", clinicNameSnapshot: "คลินิกชนบท CareFlow Pilot",
  }).run();
  test.database.db.insert(fulfillmentLabelItems).values({
    id: "label-item-route-001", labelVersionId: "label-route-001", medicationOrderItemId: "order-route-001", position: 0,
    medicationId: medication.id, medicationRevision: medication.revision, displayNameSnapshot: medication.displayName,
    strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText, quantity: 3,
    unitSnapshot: medication.canonicalUnit, directionsThSnapshot: "รับประทานตามคำสั่งสังเคราะห์", internalBarcodeSnapshot: medication.internalBarcode ?? "CF-DEMO-001",
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
    expect(response.json()).toMatchObject({ data: { id: "label-route-001" } });
  });

  it("reserves with exact envelope replay, audits start, and releases with exact replay", async () => {
    const test = await fixture();
    const body = { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload };
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
      headers: { cookie: test.assistantCookie, "idempotency-key": "reserve-route-different" }, payload: { expectedRevisions: { visit: 4, medicationDecision: 1 }, payload: startPayload },
    });
    expect(differentKey.statusCode).toBe(409);
    expect(differentKey.json().error.code).toBe("ARTIFACT_STALE");
    expect(test.database.db.select().from(auditEvents).all().map((row) => row.action)).toEqual([
      "inventory.reservation-created", "visit.preparation-started",
    ]);
    const createdAudit = test.database.db.select().from(auditEvents).all()
      .find((event) => event.action === "inventory.reservation-created");
    expect(JSON.parse(createdAudit?.metadataJson ?? "{}")).toMatchObject({
      visitId: "visit-route-001",
      allocations: [{ lotId: "lot-route-001", quantity: 3 }],
    });

    const releaseBody = {
      expectedRevisions: { visit: 4, preparation: first.json().data.preparation.revision },
      payload: { preparationId: first.json().data.preparation.id, reservationId: first.json().data.reservation.id, reason: "ทบทวนคำสั่งก่อนจัดยา" },
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
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload, extra: true },
    });
    expect(invalid.statusCode).toBe(422);

    const doctor = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.doctorCookie, "idempotency-key": "reserve-route-doctor" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload },
    });
    expect(doctor.statusCode).toBe(201);
  });

  it("prints, confirms a normalized barcode, and completes every allocated item", async () => {
    const test = await fixture();
    const started = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-start" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload },
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
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: startedData.reservation.id } },
    });
    expect(incomplete.statusCode).toBe(409);
    const printed = await test.app.inject({
      method: "POST", url: `/api/dispensing/visit-route-001/labels/${label.id}/print-events`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "preparation-flow-print" },
      payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test-renderer", decisionVersion: 1 } },
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
      payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: startedData.reservation.id } },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().data).toMatchObject({ visit: { status: "AWAITING_RELEASE", revision: 5 }, preparation: { status: "COMPLETED", revision: 2 } });
    expect(completed.json().data.allowedActions).toEqual(["RELEASE", "REJECT"]);
  });

  it("records manual confirmation identity, lot evidence, and non-null reason in its audit chain", async () => {
    const test = await fixture();
    const started = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "manual-audit-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    expect(started.statusCode).toBe(201);
    const data = started.json().data;
    const allocation = data.reservation.allocations[0];
    const confirmed = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "manual-audit-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: data.preparation.revision }, payload: { method: "MANUAL", preparationId: data.preparation.id, allocationId: allocation.id, reason: "เครื่องสแกนใช้งานไม่ได้" } } });
    expect(confirmed.statusCode).toBe(201);
    const audit = test.database.db.select().from(auditEvents).all().find((event) => event.action === "preparation.allocation-confirmed");
    expect(audit?.reason).toBe("เครื่องสแกนใช้งานไม่ได้");
    expect(JSON.parse(audit?.metadataJson ?? "{}")).toMatchObject({ decisionId: "decision-route-001", decisionVersion: 1, labelVersionId: "label-route-001", preparationId: data.preparation.id, reservationId: data.reservation.id, allocationId: allocation.id, orderItemId: "order-route-001", medicationId: "DEMO-MED-001", method: "MANUAL", manualReason: "เครื่องสแกนใช้งานไม่ได้", lot: { lotId: "lot-route-001", lotNumber: "LOT-ROUTE-001", expiryDate: "2026-08-10", unit: "เม็ด", quantity: 3 } });
  });

  it("rejects every old fulfillment command after clinical invalidation without extra writes", async () => {
    const test = await fixture();
    const started = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservations",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-start" },
      payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload },
    });
    const startedData = started.json().data;
    const allergy = await test.app.inject({
      method: "POST", url: "/api/patients/patient-route-001/allergy-revisions",
      headers: { cookie: test.doctorCookie, "idempotency-key": "invalidation-allergy" },
      payload: { expectedRevisions: { patient: 1, visit: 4 }, payload: { visitId: "visit-route-001", state: "PRESENT", items: [{ substance: "ยาทดสอบ", reaction: "ผื่น", severity: "MILD", note: null }], sourceText: "ประวัติแพ้", reason: "ทบทวนความปลอดภัย" } },
    });
    expect(allergy.statusCode).toBe(201);
    const invalidationAudits = test.database.db.select().from(auditEvents).all().filter((event) => event.action === "fulfillment.artifacts-invalidated");
    expect(invalidationAudits.length).toBeGreaterThan(0);
    for (const event of invalidationAudits) {
      expect(JSON.parse(event.metadataJson)).toMatchObject({
        visitId: "visit-route-001",
        artifactId: expect.any(String),
        decisionId: "decision-route-001",
        decisionVersion: 1,
        previousStatus: "PREPARING",
        nextStatus: "AWAITING_ORDER_REVISION",
        allocations: [{ lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }],
      });
    }
    const counts = () => ({ reservations: countRows(test, "SELECT count(*) AS count FROM inventory_reservations"), invalidations: countRows(test, "SELECT count(*) AS count FROM fulfillment_artifact_invalidations"), visits: countRows(test, "SELECT count(*) AS count FROM visits WHERE status='AWAITING_ORDER_REVISION' AND revision=5") });
    const before = counts();
    const print = await test.app.inject({
      method: "POST", url: `/api/dispensing/visit-route-001/labels/${startedData.label.id}/print-events`,
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-print" },
      payload: { expectedRevisions: { visit: 5 }, payload: { rendererVersion: "test-renderer", decisionVersion: 1 } },
    });
    const complete = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-complete" },
      payload: { expectedRevisions: { visit: 5, preparation: startedData.preparation.revision }, payload: { preparationId: startedData.preparation.id, reservationId: startedData.reservation.id } },
    });
    const abandon = await test.app.inject({
      method: "POST", url: "/api/dispensing/visit-route-001/reservation-release",
      headers: { cookie: test.assistantCookie, "idempotency-key": "invalidation-old-abandon" },
      payload: { expectedRevisions: { visit: 5, preparation: startedData.preparation.revision }, payload: { preparationId: startedData.preparation.id, reservationId: startedData.reservation.id, reason: "คำสั่งเดิมถูกยกเลิก" } },
    });
    expect(print.statusCode).toBe(409);
    expect(complete.statusCode).toBe(409);
    expect(abandon.statusCode).toBe(409);
    expect(counts()).toEqual(before);
  });

  it("allows only a Doctor to release a fully printed and confirmed preparation", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "release-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    const started = start.json().data;
    const preparation = started.preparation;
    const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "release-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "release-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    const complete = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "release-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(complete.statusCode).toBe(201);
    const releaseBody = { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } };
    for (const [field, value] of Object.entries({ decisionId: "wrong-decision", decisionVersion: 2, labelVersionId: "wrong-label", labelPrintEventId: "wrong-print", preparationId: "wrong-preparation", reservationId: "wrong-reservation" })) {
      const mismatch = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": `release-mismatch-${field}` }, payload: { ...releaseBody, payload: { ...releaseBody.payload, [field]: value } } });
      expect(mismatch.statusCode).toBe(409);
    }
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_releases")).toBe(0);
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
    const releaseAuditRows = test.database.db.select().from(auditEvents).all();
    const releaseAudit = releaseAuditRows.find((event) => event.action === "medication.release-created");
    expect(JSON.parse(releaseAudit?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_RELEASE", nextStatus: "AWAITING_HANDOFF", allocations: [{ allocationId: started.reservation.allocations[0].id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    expect(releaseAuditRows.filter((event) => event.action === "fulfillment.released")).toHaveLength(0);
  });

  it("records Doctor rejection, preserves the label, and requires a later print sequence", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    const started = start.json().data; const preparation = started.preparation; const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "reject-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    const rejectBody = { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, reason: "จำนวนยาไม่ตรงตามที่จัด" } };
    for (const [field, value] of Object.entries({ decisionId: "wrong-decision", decisionVersion: 2, labelVersionId: "wrong-label", labelPrintEventId: "wrong-print", preparationId: "wrong-preparation", reservationId: "wrong-reservation" })) {
      const mismatch = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reject", headers: { cookie: test.doctorCookie, "idempotency-key": `reject-mismatch-${field}` }, payload: { ...rejectBody, payload: { ...rejectBody.payload, [field]: value } } });
      expect(mismatch.statusCode).toBe(409);
    }
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_rejections")).toBe(0);
    const rejected = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reject", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-doctor" }, payload: rejectBody });
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json().data).toMatchObject({ visit: { status: "AWAITING_PREPARATION", revision: 6 }, label: { id: started.label.id }, reservation: null, preparation: null });
    const rejectedReplay = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reject", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-doctor" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, reason: "จำนวนยาไม่ตรงตามที่จัด" } } });
    expect(rejectedReplay.statusCode).toBe(200);
    expect(rejectedReplay.json()).toMatchObject({ data: rejected.json().data, replayed: true });
    const rejectionAudits = test.database.db.select().from(auditEvents).all();
    expect(rejectionAudits.filter((event) => event.action === "fulfillment.rejected")).toHaveLength(0);
    for (const action of ["preparation.rejected", "inventory.reservation-released"]) {
      const event = rejectionAudits.find((row) => row.action === action);
      expect(event).toBeDefined();
      expect(JSON.parse(event?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_RELEASE", nextStatus: "AWAITING_PREPARATION", allocations: [{ allocationId: started.reservation.allocations[0].id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    }
    const restarted = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-restart" }, payload: { expectedRevisions: { visit: 6, medicationDecision: 1 }, payload: { labelVersionId: started.label.id } } });
    expect(restarted.statusCode).toBe(201);
    const next = restarted.json().data; const nextPreparation = next.preparation; const nextAllocation = next.reservation.allocations[0];
    expect(nextPreparation).toMatchObject({ status: "ACTIVE" });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-new-confirm" }, payload: { expectedRevisions: { visit: 7, preparation: nextPreparation.revision }, payload: { method: "BARCODE", preparationId: nextPreparation.id, allocationId: nextAllocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "reject-new-complete" }, payload: { expectedRevisions: { visit: 7, preparation: nextPreparation.revision }, payload: { preparationId: nextPreparation.id, reservationId: next.reservation.id } } });
    const oldPrintRelease = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "reject-old-print" }, payload: { expectedRevisions: { visit: 8, preparation: 2 }, payload: { decisionId: next.medicationDecision.id, decisionVersion: next.medicationDecision.version, labelVersionId: next.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: nextPreparation.id, reservationId: next.reservation.id } } });
    expect(oldPrintRelease.statusCode).toBe(409);
  });

  it("hands off a released reservation atomically as one dispense movement per allocation", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    const started = start.json().data; const preparation = started.preparation; const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "handoff-release" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    const releasedData = release.json().data;
    const handoffPayload = { decisionId: started.medicationDecision.id, decisionVersion: started.medicationDecision.version, labelVersionId: started.label.id, releaseId: releasedData.release.id, reservationId: started.reservation.id };
    for (const [field, value] of Object.entries({ decisionId: "wrong-decision", decisionVersion: 2, labelVersionId: "wrong-label", releaseId: "wrong-release", reservationId: "wrong-reservation" })) {
      const mismatch = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": `handoff-mismatch-${field}` }, payload: { expectedRevisions: { visit: 6 }, payload: { ...handoffPayload, [field]: value } } });
      expect(mismatch.statusCode).toBe(409);
    }
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 2 });
    test.database.sqlite.prepare("UPDATE inventory_lots SET expiry_date = '2026-08-02' WHERE id = 'lot-route-001'").run();
    const expired = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "handoff-expired" }, payload: { expectedRevisions: { visit: 6 }, payload: { ...handoffPayload } } });
    expect(expired.statusCode).toBe(409);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_dispenses")).toBe(0);
    expect(countRows(test, "SELECT count(*) AS count FROM inventory_stock_movements")).toBe(1);
    expect(test.database.sqlite.prepare("SELECT status FROM inventory_reservations WHERE id = ?").get(started.reservation.id)).toEqual({ status: "ACTIVE" });
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 2 });
    test.database.sqlite.prepare("UPDATE inventory_lots SET expiry_date = '2026-08-10' WHERE id = 'lot-route-001'").run();
    test.database.sqlite.prepare("UPDATE inventory_lots SET status = 'QUARANTINED' WHERE id = 'lot-route-001'").run();
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
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 3 });
    const handoffAudits = test.database.db.select().from(auditEvents).all();
    expect(handoffAudits.filter((event) => event.action === "fulfillment.handed-off")).toHaveLength(0);
    for (const action of ["inventory.stock-dispensed", "dispense.handoff-confirmed", "visit.handoff-confirmed"]) {
      const event = handoffAudits.find((row) => row.action === action);
      expect(event).toBeDefined();
      expect(JSON.parse(event?.metadataJson ?? "{}")).toMatchObject({ visitId: "visit-route-001", decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: releasedData.release.id, preparationId: preparation.id, reservationId: started.reservation.id, previousStatus: "AWAITING_HANDOFF", nextStatus: "AWAITING_CHARGE", allocations: [{ allocationId: allocation.id, lotId: "lot-route-001", lotNumberSnapshot: "LOT-ROUTE-001", quantity: 3, unit: "เม็ด" }] });
    }
    const beforeRevision = {
      decisions: countRows(test, "SELECT count(*) AS count FROM medication_decisions"),
      invalidations: countRows(test, "SELECT count(*) AS count FROM fulfillment_artifact_invalidations"),
      audits: countRows(test, "SELECT count(*) AS count FROM audit_events"),
      idempotency: countRows(test, "SELECT count(*) AS count FROM idempotency_records"),
      visit: test.database.sqlite.prepare("SELECT status, revision FROM visits WHERE id = 'visit-route-001'").get(),
      dispense: test.database.sqlite.prepare("SELECT id FROM fulfillment_dispenses WHERE visit_id = 'visit-route-001'").get(),
      stock: test.database.sqlite.prepare("SELECT sum(quantity_delta) AS quantity FROM inventory_stock_movements WHERE lot_id = 'lot-route-001'").get(),
    };
    for (const [key, decision] of [["handoff-revision-order", { kind: "ORDER", items: [{ medicationId: "DEMO-MED-001", medicationRevision: 1, quantity: 3, directionsTh: "คำสั่งใหม่ที่ต้องถูกปฏิเสธ" }] }], ["handoff-revision-none", { kind: "NO_MEDICATION", noMedicationReason: "คำสั่งใหม่ที่ต้องถูกปฏิเสธ" }]] as const) {
      const revision = await test.app.inject({ method: "POST", url: "/api/visits/visit-route-001/medication-decision-revisions", headers: { cookie: test.doctorCookie, "idempotency-key": key }, payload: { expectedRevisions: { visit: 7, patient: 1, medicationDecision: 1 }, payload: { revisionReason: "ห้ามแก้หลังส่งมอบ", decision } } });
      expect(revision.statusCode).toBe(409);
      expect(revision.json().error.code).toBe("INVALID_STATE");
      expect({ decisions: countRows(test, "SELECT count(*) AS count FROM medication_decisions"), invalidations: countRows(test, "SELECT count(*) AS count FROM fulfillment_artifact_invalidations"), audits: countRows(test, "SELECT count(*) AS count FROM audit_events"), idempotency: countRows(test, "SELECT count(*) AS count FROM idempotency_records"), visit: test.database.sqlite.prepare("SELECT status, revision FROM visits WHERE id = 'visit-route-001'").get(), dispense: test.database.sqlite.prepare("SELECT id FROM fulfillment_dispenses WHERE visit_id = 'visit-route-001'").get(), stock: test.database.sqlite.prepare("SELECT sum(quantity_delta) AS quantity FROM inventory_stock_movements WHERE lot_id = 'lot-route-001'").get() }).toEqual(beforeRevision);
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
    test.database.db.insert(fulfillmentLabelItems).values({ id: "label-item-route-002", labelVersionId: "label-route-001", medicationOrderItemId: "order-route-002", position: 1, medicationId: medication.id, medicationRevision: medication.revision, displayNameSnapshot: medication.displayName, strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText, quantity: 2, unitSnapshot: medication.canonicalUnit, directionsThSnapshot: "รับประทานยาสังเคราะห์รายการที่สอง", internalBarcodeSnapshot: medication.internalBarcode ?? "CF-DEMO-002" }).run();
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

    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    expect(start.statusCode).toBe(201);
    const started = start.json().data;
    expect(started.reservation.allocations.map((item: { lotId: string }) => item.lotId)).toEqual(["lot-route-001", "lot-route-002"]);
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "multi-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    expect(printed.statusCode).toBe(201);
    let preparation = started.preparation;
    for (const allocation of started.reservation.allocations) {
      const item = started.label.items.find((labelItem: { orderItemId: string }) => labelItem.orderItemId === allocation.orderItemId);
      const confirmed = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": `multi-confirm-${allocation.id}` }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: item.internalBarcode } } });
      expect(confirmed.statusCode).toBe(201);
      preparation = confirmed.json().data.preparation;
    }
    const complete = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(complete.statusCode).toBe(201);
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "multi-release" }, payload: { expectedRevisions: { visit: 5, preparation: complete.json().data.preparation.revision }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: complete.json().data.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(release.statusCode).toBe(201);
    const handoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "multi-handoff" }, payload: { expectedRevisions: { visit: 6 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: release.json().data.release.id, reservationId: started.reservation.id } } });
    expect(handoff.statusCode).toBe(201);
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id IN ('lot-route-001', 'lot-route-002') ORDER BY id").all()).toEqual([{ revision: 3 }, { revision: 3 }]);
    expect(test.database.sqlite.prepare("SELECT lot_id, quantity_delta FROM inventory_stock_movements WHERE movement_type = 'DISPENSE' ORDER BY lot_id").all()).toEqual([{ lot_id: "lot-route-001", quantity_delta: -3 }, { lot_id: "lot-route-002", quantity_delta: -2 }]);
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "inventory.stock-dispensed")).toHaveLength(2);
  });

  it("rolls back every handoff row when stock becomes insufficient after release", async () => {
    const test = await fixture();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "insufficient-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    const started = start.json().data; const preparation = started.preparation; const allocation = started.reservation.allocations[0];
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "insufficient-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    const printedData = printed.json().data;
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": "insufficient-confirm" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: "CF-DEMO-001" } } });
    await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "insufficient-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "insufficient-release" }, payload: { expectedRevisions: { visit: 5, preparation: 2 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: printedData.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(release.statusCode).toBe(201);
    test.database.sqlite.exec(`
      INSERT INTO patients (id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at)
      VALUES ('patient-external-stock', 'clinic', 'DEMO-000099', 'ผู้ป่วยทดสอบ 000099', '0000000099', '1990-01-01', 'unknown', 1, '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z');
      INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, created_by)
      VALUES ('visit-external-stock', 'clinic', 'patient-external-stock', 'AWAITING_CHARGE', 'ตัดสต็อกภายนอก', 1, '2026-08-03T00:00:00.000Z', 'doctor-001');
      INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by)
      VALUES ('reservation-external-stock', 'clinic', 'visit-external-stock', 'decision-route-001', 1, 'ACTIVE', '2026-08-03T00:00:00.000Z', 'doctor-001');
      INSERT INTO inventory_reservation_allocations (id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at)
      VALUES ('allocation-external-stock', 'reservation-external-stock', 'order-route-001', 'lot-route-001', 0, 4, 'DEMO-MED-001', 'LOT-ROUTE-001', '2026-08-10', 'เม็ด', '2026-08-03T00:00:00.000Z');
      INSERT INTO fulfillment_releases (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, label_print_event_id, preparation_id, preparation_revision, reservation_id, released_at, released_by)
      VALUES ('release-external-stock', 'clinic', 'visit-external-stock', 'decision-route-001', 1, '${started.label.id}', '${printedData.preparation.latestPrintEventId}', '${preparation.id}', 2, 'reservation-external-stock', '2026-08-03T00:00:00.000Z', 'doctor-001');
      INSERT INTO fulfillment_dispenses (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, label_version_id, preparation_id, release_id, reservation_id, handed_off_at, handed_off_by)
      VALUES ('dispense-external-stock', 'clinic', 'visit-external-stock', 'decision-route-001', 1, '${started.label.id}', '${preparation.id}', 'release-external-stock', 'reservation-external-stock', '2026-08-03T00:00:00.000Z', 'doctor-001');
      INSERT INTO fulfillment_dispense_lines (id, dispense_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id, quantity, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number_snapshot, expiry_date_snapshot, directions_th_snapshot)
      VALUES ('line-external-stock', 'dispense-external-stock', 'allocation-external-stock', 'order-route-001', 'DEMO-MED-001', 'lot-route-001', 4, '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 'LOT-ROUTE-001', '2026-08-10', 'รับประทานตามคำสั่งสังเคราะห์');
      INSERT INTO inventory_stock_movements (id, clinic_id, lot_id, movement_type, quantity_delta, source_type, source_id, reason, occurred_at, actor_id)
      VALUES ('movement-external-stock', 'clinic', 'lot-route-001', 'DISPENSE', -4, 'DISPENSE', 'line-external-stock', '', '2026-08-03T00:00:00.000Z', 'doctor-001');
    `);
    const handoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "insufficient-handoff" }, payload: { expectedRevisions: { visit: 6 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: release.json().data.release.id, reservationId: started.reservation.id } } });
    expect(handoff.statusCode).toBe(409);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_dispenses WHERE visit_id = 'visit-route-001'")).toBe(0);
    expect(countRows(test, "SELECT count(*) AS count FROM fulfillment_dispense_lines WHERE dispense_id NOT LIKE 'dispense-external-stock'")).toBe(0);
    expect(countRows(test, "SELECT count(*) AS count FROM inventory_stock_movements WHERE lot_id = 'lot-route-001'")).toBe(2);
    expect(test.database.sqlite.prepare("SELECT sum(quantity_delta) AS quantity FROM inventory_stock_movements WHERE lot_id = 'lot-route-001'").get()).toEqual({ quantity: 1 });
    expect(test.database.sqlite.prepare("SELECT status FROM inventory_reservations WHERE id = ?").get(started.reservation.id)).toEqual({ status: "ACTIVE" });
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 2 });
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "inventory.stock-dispensed")).toHaveLength(0);
  });

  it("increments a shared lot once when one reservation has multiple allocations", async () => {
    const test = await fixture();
    const medication = test.database.db.select().from(medications).where(eq(medications.id, "DEMO-MED-001")).get();
    if (!medication) throw new Error("missing shared medication fixture");
    test.database.db.insert(medicationOrderItems).values({
      id: "order-route-shared-002", medicationDecisionId: "decision-route-001", position: 1, medicationId: medication.id,
      medicationRevision: medication.revision, displayNameSnapshot: medication.displayName,
      strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText,
      unitSnapshot: medication.canonicalUnit, quantity: 1, directionsTh: "รับประทานยาสังเคราะห์รายการที่สอง",
    }).run();
    test.database.db.insert(fulfillmentLabelItems).values({ id: "label-item-route-shared-002", labelVersionId: "label-route-001", medicationOrderItemId: "order-route-shared-002", position: 1, medicationId: medication.id, medicationRevision: medication.revision, displayNameSnapshot: medication.displayName, strengthSnapshot: medication.strengthText, dosageFormSnapshot: medication.dosageFormText, quantity: 1, unitSnapshot: medication.canonicalUnit, directionsThSnapshot: "รับประทานยาสังเคราะห์รายการที่สอง", internalBarcodeSnapshot: medication.internalBarcode ?? "CF-DEMO-001" }).run();
    const start = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/reservations", headers: { cookie: test.assistantCookie, "idempotency-key": "shared-start" }, payload: { expectedRevisions: { visit: 3, medicationDecision: 1 }, payload: startPayload } });
    expect(start.statusCode).toBe(201);
    const started = start.json().data;
    expect(started.reservation.allocations).toHaveLength(2);
    expect(started.reservation.allocations.every((allocation: { lotId: string }) => allocation.lotId === "lot-route-001")).toBe(true);
    expect(started.reservation.allocations.map((allocation: { quantity: number }) => allocation.quantity)).toEqual([3, 1]);
    const printed = await test.app.inject({ method: "POST", url: `/api/dispensing/visit-route-001/labels/${started.label.id}/print-events`, headers: { cookie: test.assistantCookie, "idempotency-key": "shared-print" }, payload: { expectedRevisions: { visit: 4 }, payload: { rendererVersion: "test", decisionVersion: 1 } } });
    expect(printed.statusCode).toBe(201);
    let preparation = started.preparation;
    for (const allocation of started.reservation.allocations) {
      const item = started.label.items.find((labelItem: { orderItemId: string }) => labelItem.orderItemId === allocation.orderItemId);
      const confirmed = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/preparation-confirmations", headers: { cookie: test.assistantCookie, "idempotency-key": `shared-confirm-${allocation.id}` }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { method: "BARCODE", preparationId: preparation.id, allocationId: allocation.id, barcode: item.internalBarcode } } });
      expect(confirmed.statusCode).toBe(201);
      preparation = confirmed.json().data.preparation;
    }
    const complete = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/complete-preparation", headers: { cookie: test.assistantCookie, "idempotency-key": "shared-complete" }, payload: { expectedRevisions: { visit: 4, preparation: preparation.revision }, payload: { preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(complete.statusCode).toBe(201);
    const release = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/release", headers: { cookie: test.doctorCookie, "idempotency-key": "shared-release" }, payload: { expectedRevisions: { visit: 5, preparation: complete.json().data.preparation.revision }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, labelPrintEventId: complete.json().data.preparation.latestPrintEventId, preparationId: preparation.id, reservationId: started.reservation.id } } });
    expect(release.statusCode).toBe(201);
    const handoff = await test.app.inject({ method: "POST", url: "/api/dispensing/visit-route-001/handoff", headers: { cookie: test.assistantCookie, "idempotency-key": "shared-handoff" }, payload: { expectedRevisions: { visit: 6 }, payload: { decisionId: started.medicationDecision.id, decisionVersion: 1, labelVersionId: started.label.id, releaseId: release.json().data.release.id, reservationId: started.reservation.id } } });
    expect(handoff.statusCode).toBe(201);
    expect(test.database.sqlite.prepare("SELECT revision FROM inventory_lots WHERE id = 'lot-route-001'").get()).toEqual({ revision: 3 });
    expect(test.database.sqlite.prepare("SELECT count(*) AS count, sum(quantity_delta) AS total FROM inventory_stock_movements WHERE lot_id = 'lot-route-001' AND movement_type = 'DISPENSE'").get()).toEqual({ count: 2, total: -4 });
    expect(test.database.db.select().from(auditEvents).all().filter((event) => event.action === "inventory.stock-dispensed")).toHaveLength(2);
  });
});
