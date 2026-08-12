import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { inventoryReservationSchema, type Actor } from "../../src/shared/contracts.js";
import {
  createInventoryService,
  inventoryLots,
  inventoryReservationAllocations,
  inventoryReservations,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryStockMovements,
} from "../../src/server/modules/inventory/index.js";
import { medicationDecisions, medicationOrderItems, medications } from "../../src/server/modules/medication/index.js";
import { patients } from "../../src/server/modules/patient/index.js";
import { visits } from "../../src/server/modules/visit/index.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";
import { seedAccount } from "./helpers/auth.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(now = "2026-08-03T00:00:00.000Z") {
  const database = createTestDatabase();
  cleanups.push(database.cleanup);
  let sequence = 0;
  const inventory = createInventoryService({
    database,
    clock: () => new Date(now),
    idFactory: () => `fulfillment-${++sequence}`,
  });
  return { database, inventory };
}

function addVisitOrder(
  database: TestDatabase,
  input: {
    visitId: string;
    decisionId: string;
    orderItemId: string;
    medicationId?: string;
    quantity?: number;
    visitRevision?: number;
    status?: "AWAITING_PREPARATION" | "PREPARING";
    version?: number;
  },
) {
  const now = "2026-08-03T00:00:00.000Z";
  database.db.insert(patients).values({
    id: `patient-${input.visitId}`,
    clinicId: "clinic",
    hn: "DEMO-000001",
    displayName: "ผู้ป่วยทดสอบ 000001",
    phone: "0000000001",
    birthDate: "1990-01-01",
    sex: "unknown",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  }).run();
  database.db.insert(visits).values({
    id: input.visitId,
    clinicId: "clinic",
    patientId: `patient-${input.visitId}`,
    status: input.status ?? "AWAITING_PREPARATION",
    chiefComplaint: "อาการสังเคราะห์",
    revision: input.visitRevision ?? 3,
    arrivedAt: now,
    startedAt: now,
    closedAt: null,
    createdBy: "doctor-001",
  }).run();
  database.db.insert(medicationDecisions).values({
    id: input.decisionId,
    visitId: input.visitId,
    version: input.version ?? 1,
    kind: "ORDER",
    noMedicationReason: null,
    revisionReason: null,
    supersedesId: null,
    signedBy: "doctor-001",
    signedByDisplayName: "พญ. ทดสอบ",
    signedAt: now,
    contentHash: "a".repeat(64),
  }).run();
  const medication = database.db.select().from(medications)
    .where(eq(medications.id, input.medicationId ?? "DEMO-MED-001")).get();
  if (!medication) throw new Error("missing medication fixture");
  database.db.insert(medicationOrderItems).values({
    id: input.orderItemId,
    medicationDecisionId: input.decisionId,
    position: 0,
    medicationId: medication.id,
    medicationRevision: medication.revision,
    displayNameSnapshot: medication.displayName,
    strengthSnapshot: medication.strengthText,
    dosageFormSnapshot: medication.dosageFormText,
    unitSnapshot: medication.canonicalUnit,
    quantity: input.quantity ?? 15,
    directionsTh: "รับประทานตามคำสั่งสังเคราะห์",
  }).run();
}

async function actor(database: TestDatabase): Promise<Actor> {
  return (await seedAccount(database, {
    id: "doctor-001",
    username: "doctor",
    role: "doctor",
    displayName: "พญ. ทดสอบ",
    mustChangePassword: false,
  })).actor;
}

function receiveLot(
  database: TestDatabase,
  input: {
    id: string;
    medicationId?: string;
    lotNumber: string;
    expiryDate: string;
    quantity: number;
    status?: "AVAILABLE" | "QUARANTINED";
  },
) {
  const now = "2026-08-03T00:00:00.000Z";
  const medicationId = input.medicationId ?? "DEMO-MED-001";
  const medication = database.db.select().from(medications).where(eq(medications.id, medicationId)).get();
  if (!medication) throw new Error("missing medication fixture");
  const receiptId = `receipt-${input.id}`;
  database.db.insert(inventoryReceipts).values({
    id: receiptId,
    clinicId: "clinic",
    supplierName: "ผู้จำหน่ายสังเคราะห์",
    note: "รับเข้าทดสอบ",
    receivedAt: now,
    receivedBy: "doctor-001",
  }).run();
  database.db.insert(inventoryLots).values({
    id: input.id,
    clinicId: "clinic",
    medicationId,
    medicationRevision: medication.revision,
    displayNameSnapshot: medication.displayName,
    strengthSnapshot: medication.strengthText,
    dosageFormSnapshot: medication.dosageFormText,
    unitSnapshot: medication.canonicalUnit,
    lotNumber: input.lotNumber,
    expiryDate: input.expiryDate,
    supplierName: "ผู้จำหน่ายสังเคราะห์",
    status: input.status ?? "AVAILABLE",
    createdAt: now,
    createdBy: "doctor-001",
  }).run();
  database.db.insert(inventoryReceiptLines).values({
    id: `line-${input.id}`,
    receiptId,
    lotId: input.id,
    quantity: input.quantity,
    unitSnapshot: medication.canonicalUnit,
  }).run();
  database.db.insert(inventoryStockMovements).values({
    id: `movement-${input.id}`,
    clinicId: "clinic",
    lotId: input.id,
    movementType: "RECEIPT",
    quantityDelta: input.quantity,
    sourceType: "RECEIPT",
    sourceId: receiptId,
    reason: "รับเข้าทดสอบ",
    occurredAt: now,
    actorId: "doctor-001",
  }).run();
}

describe("fulfillment reservation persistence and FEFO service", () => {
  it("allocates an ORDER across future lots in deterministic FEFO order and subtracts active holds", async () => {
    const { database, inventory } = fixture();
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-fefo", decisionId: "decision-fefo", orderItemId: "order-fefo", quantity: 15 });
    receiveLot(database, { id: "lot-late", lotNumber: "LOT-LATE", expiryDate: "2026-08-30", quantity: 8 });
    receiveLot(database, { id: "lot-early", lotNumber: "LOT-EARLY", expiryDate: "2026-08-10", quantity: 10 });
    receiveLot(database, { id: "lot-expired", lotNumber: "LOT-EXPIRED", expiryDate: "2026-08-03", quantity: 99 });
    receiveLot(database, { id: "lot-quarantine", lotNumber: "LOT-QUARANTINE", expiryDate: "2026-08-04", quantity: 99, status: "QUARANTINED" });

    expect(inventory.getReservationReadiness("visit-fefo")).toEqual({
      ready: true,
      lines: [{
        medicationId: "DEMO-MED-001",
        displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A",
        required: 15,
        available: 18,
        shortfall: 0,
        unitSnapshot: "เม็ด",
      }],
    });

    const pickList = database.db.transaction((tx) => inventory.reserveForVisit(
      tx, doctor, "visit-fefo", 3, 1,
    ));

    expect(pickList.visit).toMatchObject({ id: "visit-fefo", status: "PREPARING", revision: 4 });
    expect(pickList.medicationDecision).toMatchObject({ id: "decision-fefo", version: 1, kind: "ORDER" });
    expect(pickList.medicationDecision.kind === "ORDER" ? pickList.medicationDecision.items : []).toMatchObject([
      { id: "DEMO-MED-001", orderItemId: "order-fefo", quantity: 15 },
    ]);
    expect(pickList.reservation).toMatchObject({
      visitId: "visit-fefo", medicationDecisionId: "decision-fefo", status: "ACTIVE",
    });
    expect(pickList.reservation?.allocations.map((allocation) => [allocation.lotId, allocation.quantity])).toEqual([
      ["lot-early", 10], ["lot-late", 5],
    ]);
    const inventoryRow = pickList.inventory.find((row) => row.medication.id === "DEMO-MED-001");
    expect(inventoryRow).toMatchObject({ onHand: 216, reserved: 15, available: 3 });
  });

  it("proves all items before writing and leaves no partial reservation when stock is insufficient", async () => {
    const { database, inventory } = fixture();
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-insufficient", decisionId: "decision-insufficient", orderItemId: "order-insufficient-1", quantity: 10 });
    const med2 = database.db.select().from(medications).where(eq(medications.id, "DEMO-MED-002")).get();
    if (!med2) throw new Error("missing second medication fixture");
    database.db.insert(medicationOrderItems).values({
      id: "order-insufficient-2", medicationDecisionId: "decision-insufficient", position: 1,
      medicationId: med2.id, medicationRevision: med2.revision, displayNameSnapshot: med2.displayName,
      strengthSnapshot: med2.strengthText, dosageFormSnapshot: med2.dosageFormText,
      unitSnapshot: med2.canonicalUnit, quantity: 20, directionsTh: "รับประทานตามคำสั่งสังเคราะห์",
    }).run();
    receiveLot(database, { id: "lot-enough-first", lotNumber: "LOT-FIRST", expiryDate: "2026-08-10", quantity: 10 });
    expect(() => database.db.transaction((tx) => inventory.reserveForVisit(
      tx, doctor, "visit-insufficient", 3, 1,
    ))).toThrow(/สต็อก|ไม่พอ|เพียงพอ/);
    expect(database.db.select().from(inventoryReservations).all()).toHaveLength(0);
    expect(database.db.select().from(inventoryReservationAllocations).all()).toHaveLength(0);
    expect(database.db.select().from(visits).where(eq(visits.id, "visit-insufficient")).get())
      .toMatchObject({ status: "AWAITING_PREPARATION", revision: 3 });
  });

  it("does not duplicate an active reservation and release restores derived availability without editing allocations", async () => {
    const { database, inventory } = fixture();
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-release", decisionId: "decision-release", orderItemId: "order-release", quantity: 9 });
    receiveLot(database, { id: "lot-release", lotNumber: "LOT-RELEASE", expiryDate: "2026-08-10", quantity: 9 });
    const first = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-release", 3, 1));
    expect(first.inventory.find((row) => row.medication.id === "DEMO-MED-001"))
      .toMatchObject({ onHand: 9, reserved: 9, available: 0, status: "RESERVED" });
    const duplicate = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-release", 4, 1));
    expect(duplicate.reservation?.id).toBe(first.reservation?.id);
    expect(database.db.select().from(inventoryReservations).all()).toHaveLength(1);
    const allocations = database.db.select().from(inventoryReservationAllocations).all();
    expect(allocations).toHaveLength(1);

    const released = database.db.transaction((tx) => inventory.releaseReservation(
      tx, doctor, "visit-release", 4, first.reservation?.id ?? "", "ทบทวนรายการก่อนจัดยา",
    ));
    expect(released.reservation).toMatchObject({ status: "RELEASED", releaseReason: "ทบทวนรายการก่อนจัดยา" });
    expect(released.visit).toMatchObject({ status: "AWAITING_PREPARATION", revision: 5 });
    expect(database.db.select().from(inventoryReservationAllocations).all()).toEqual(allocations);
    expect(database.db.select().from(inventoryReservations).all()).toMatchObject([{ status: "RELEASED" }]);
    expect(released.inventory.find((row) => row.medication.id === "DEMO-MED-001"))
      .toMatchObject({ onHand: 9, reserved: 0, available: 9 });
  });

  it("enforces append-only allocation rows at the database boundary and respects Bangkok expiry dates", async () => {
    const { database, inventory } = fixture("2026-08-03T16:59:59.999Z");
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-boundary", decisionId: "decision-boundary", orderItemId: "order-boundary", quantity: 1 });
    receiveLot(database, { id: "lot-today", lotNumber: "LOT-TODAY", expiryDate: "2026-08-03", quantity: 9 });
    receiveLot(database, { id: "lot-tomorrow", lotNumber: "LOT-TOMORROW", expiryDate: "2026-08-04", quantity: 9 });
    const reserved = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-boundary", 3, 1));
    expect(reserved.reservation?.allocations[0]).toMatchObject({ lotId: "lot-tomorrow", expiryDateSnapshot: "2026-08-04" });
    const allocationId = reserved.reservation?.allocations[0]?.id;
    expect(() => database.sqlite.prepare("UPDATE inventory_reservation_allocations SET quantity=2 WHERE id=?").run(allocationId))
      .toThrow(/append-only/);
    expect(() => database.sqlite.prepare("DELETE FROM inventory_reservation_allocations WHERE id=?").run(allocationId))
      .toThrow(/append-only/);
  });

  it("rejects a released reservation without a non-empty release reason at the shared and database boundaries", async () => {
    const { database, inventory } = fixture();
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-release-reason", decisionId: "decision-release-reason", orderItemId: "order-release-reason", quantity: 1 });
    receiveLot(database, { id: "lot-release-reason", lotNumber: "LOT-REASON", expiryDate: "2026-08-10", quantity: 2 });
    const reserved = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-release-reason", 3, 1));
    const released = { ...reserved.reservation, status: "RELEASED" as const, releasedAt: "2026-08-03T00:00:00.000Z", releasedBy: doctor, releaseReason: null };
    expect(inventoryReservationSchema.safeParse({ ...released, allocations: reserved.reservation?.allocations ?? [] }).success).toBe(false);
    expect(() => database.sqlite.prepare(
      `INSERT INTO inventory_reservations (
        id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status,
        created_at, created_by, released_at, released_by, release_reason
      ) VALUES (?, 'clinic', ?, ?, 1, 'RELEASED', ?, ?, ?, ?, NULL)`,
    ).run("invalid-release-reason", "visit-release-reason", "decision-release-reason", "2026-08-03T00:00:00.000Z", doctor.id, "2026-08-03T00:00:00.000Z", doctor.id)).toThrow(/CHECK|release|reason|ACTIVE/i);
  });

  it("returns the active reservation after release and re-reserve even when timestamps and ids sort backwards", async () => {
    const database = createTestDatabase();
    cleanups.push(database.cleanup);
    const ids = ["z-reservation", "z-allocation", "a-reservation", "a-allocation"];
    const inventory = createInventoryService({
      database,
      clock: () => new Date("2026-08-03T00:00:00.000Z"),
      idFactory: () => ids.shift() ?? "unexpected-id",
    });
    const doctor = await actor(database);
    addVisitOrder(database, { visitId: "visit-rereserve", decisionId: "decision-rereserve", orderItemId: "order-rereserve", quantity: 1 });
    receiveLot(database, { id: "lot-rereserve", lotNumber: "LOT-RERESERVE", expiryDate: "2026-08-10", quantity: 2 });
    const first = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-rereserve", 3, 1));
    database.db.transaction((tx) => inventory.releaseReservation(tx, doctor, "visit-rereserve", 4, first.reservation?.id ?? "", "ทบทวนก่อนจองใหม่"));
    const second = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "visit-rereserve", 5, 1));
    expect(second.reservation).toMatchObject({ id: "a-reservation", status: "ACTIVE" });
    expect(inventory.getPickList("visit-rereserve").reservation).toMatchObject({ id: "a-reservation", status: "ACTIVE" });
  });
});
