import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ApiError } from "../../src/server/errors.js";
import {
  createInventoryService,
  inventoryLots,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryStockMovements,
} from "../../src/server/modules/inventory/index.js";
import { medicationDecisions, medicationOrderItems, medications } from "../../src/server/modules/medication/index.js";
import { patients } from "../../src/server/modules/patient/index.js";
import { visits } from "../../src/server/modules/visit/index.js";
import { seedAccount } from "./helpers/auth.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const NOW = "2026-08-03T00:00:00.000Z";
const cleanups: Array<() => void> = [];
let patientSequence = 0;

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

type Readiness = {
  ready: boolean;
  lines: Array<{
    medicationId: string;
    displayNameSnapshot: string;
    required: number;
    available: number;
    shortfall: number;
    unitSnapshot: string;
  }>;
};

type OrderItem = {
  id: string;
  medicationId: string;
  quantity: number;
  position?: number;
  displayNameSnapshot?: string;
  unitSnapshot?: string;
};

async function fixture(initialNow = NOW) {
  const database = createTestDatabase();
  cleanups.push(database.cleanup);
  let currentNow = new Date(initialNow);
  let id = 0;
  const inventory = createInventoryService({
    database,
    clock: () => currentNow,
    idFactory: () => `readiness-${++id}`,
  });
  const doctor = (await seedAccount(database, {
    id: "doctor-001",
    username: "doctor",
    role: "doctor",
    displayName: "พญ. ทดสอบ",
    mustChangePassword: false,
  })).actor;
  return {
    database,
    doctor,
    inventory,
    setNow(value: string) {
      currentNow = new Date(value);
    },
  };
}

function getReadiness(
  inventory: ReturnType<typeof createInventoryService>,
  visitId: string,
): Readiness {
  return (inventory as unknown as {
    getReservationReadiness(id: string): Readiness;
  }).getReservationReadiness(visitId);
}

function addVisitOrder(
  database: TestDatabase,
  input: { visitId: string; decisionId: string; items: OrderItem[]; visitRevision?: number },
) {
  const patientId = `patient-${input.visitId}`;
  const patientNumber = String(++patientSequence).padStart(6, "0");
  database.db.insert(patients).values({
    id: patientId,
    clinicId: "clinic",
    hn: `DEMO-${patientNumber}`,
    displayName: `ผู้ป่วยทดสอบ ${patientNumber}`,
    phone: `000000${patientNumber.slice(-4)}`,
    birthDate: "1990-01-01",
    sex: "unknown",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  database.db.insert(visits).values({
    id: input.visitId,
    clinicId: "clinic",
    patientId,
    status: "AWAITING_PREPARATION",
    chiefComplaint: "อาการสังเคราะห์",
    revision: input.visitRevision ?? 3,
    arrivedAt: NOW,
    startedAt: NOW,
    closedAt: null,
    createdBy: "doctor-001",
  }).run();
  database.db.insert(medicationDecisions).values({
    id: input.decisionId,
    visitId: input.visitId,
    version: 1,
    kind: "ORDER",
    noMedicationReason: null,
    revisionReason: null,
    supersedesId: null,
    signedBy: "doctor-001",
    signedByDisplayName: "พญ. ทดสอบ",
    signedAt: NOW,
    contentHash: "a".repeat(64),
  }).run();
  for (const [index, item] of input.items.entries()) {
    const medication = database.db.select().from(medications).where(eq(medications.id, item.medicationId)).get();
    if (!medication) throw new Error(`Missing medication fixture ${item.medicationId}`);
    database.db.insert(medicationOrderItems).values({
      id: item.id,
      medicationDecisionId: input.decisionId,
      position: item.position ?? index,
      medicationId: medication.id,
      medicationRevision: medication.revision,
      displayNameSnapshot: item.displayNameSnapshot ?? medication.displayName,
      strengthSnapshot: medication.strengthText,
      dosageFormSnapshot: medication.dosageFormText,
      unitSnapshot: item.unitSnapshot ?? medication.canonicalUnit,
      quantity: item.quantity,
      directionsTh: "รับประทานตามคำสั่งสังเคราะห์",
    }).run();
  }
}

function receiveLot(
  database: TestDatabase,
  input: {
    id: string;
    medicationId: string;
    lotNumber: string;
    expiryDate: string;
    quantity: number;
    status?: "AVAILABLE" | "QUARANTINED";
  },
) {
  const medication = database.db.select().from(medications).where(eq(medications.id, input.medicationId)).get();
  if (!medication) throw new Error(`Missing medication fixture ${input.medicationId}`);
  const receiptId = `receipt-${input.id}`;
  database.db.insert(inventoryReceipts).values({
    id: receiptId,
    clinicId: "clinic",
    supplierName: "ผู้จำหน่ายสังเคราะห์",
    note: "รับเข้าทดสอบ",
    receivedAt: NOW,
    receivedBy: "doctor-001",
  }).run();
  database.db.insert(inventoryLots).values({
    id: input.id,
    clinicId: "clinic",
    medicationId: medication.id,
    medicationRevision: medication.revision,
    displayNameSnapshot: medication.displayName,
    strengthSnapshot: medication.strengthText,
    dosageFormSnapshot: medication.dosageFormText,
    unitSnapshot: medication.canonicalUnit,
    lotNumber: input.lotNumber,
    expiryDate: input.expiryDate,
    supplierName: "ผู้จำหน่ายสังเคราะห์",
    status: input.status ?? "AVAILABLE",
    createdAt: NOW,
    createdBy: "doctor-001",
  }).run();
  database.db.insert(inventoryReceiptLines).values({
    id: `receipt-line-${input.id}`,
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
    occurredAt: NOW,
    actorId: "doctor-001",
  }).run();
}

function writeSensitiveSnapshot(database: TestDatabase): string {
  return JSON.stringify({
    reservations: database.sqlite.prepare("SELECT * FROM inventory_reservations ORDER BY id").all(),
    allocations: database.sqlite.prepare("SELECT * FROM inventory_reservation_allocations ORDER BY id").all(),
    movements: database.sqlite.prepare("SELECT * FROM inventory_stock_movements ORDER BY id").all(),
    lotRevisions: database.sqlite.prepare("SELECT id, revision FROM inventory_lots ORDER BY id").all(),
    visitRevisions: database.sqlite.prepare("SELECT id, revision FROM visits ORDER BY id").all(),
    audits: database.sqlite.prepare("SELECT * FROM audit_events ORDER BY id").all(),
    idempotency: database.sqlite.prepare("SELECT * FROM idempotency_records ORDER BY actor_id, key").all(),
  });
}

function expectReservationNotSellable(action: () => unknown) {
  try {
    action();
    throw new Error("Expected reservation command to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("RESERVATION_NOT_SELLABLE");
  }
}

describe("read-only FEFO stock readiness", () => {
  it("reports zero sellable stock with the signed ORDER snapshots", async () => {
    const { database, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-zero",
      decisionId: "decision-zero",
      items: [{
        id: "order-zero",
        medicationId: "DEMO-MED-001",
        quantity: 3,
        displayNameSnapshot: "ชื่อยาที่ลงนามแล้ว",
        unitSnapshot: "หน่วยที่ลงนามแล้ว",
      }],
    });

    expect(getReadiness(inventory, "readiness-zero")).toEqual({
      ready: false,
      lines: [{
        medicationId: "DEMO-MED-001",
        displayNameSnapshot: "ชื่อยาที่ลงนามแล้ว",
        required: 3,
        available: 0,
        shortfall: 3,
        unitSnapshot: "หน่วยที่ลงนามแล้ว",
      }],
    });
  });

  it("groups duplicate medication demand in signed item order and derives availability from receipt movements", async () => {
    const { database, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-duplicate",
      decisionId: "decision-duplicate",
      items: [
        { id: "order-a-first", medicationId: "DEMO-MED-001", quantity: 2, displayNameSnapshot: "ยา A ที่ลงนาม", unitSnapshot: "หน่วย A" },
        { id: "order-a-second", medicationId: "DEMO-MED-001", quantity: 3, displayNameSnapshot: "ยา A เวอร์ชันถัดมา", unitSnapshot: "หน่วยอื่น" },
        { id: "order-b", medicationId: "DEMO-MED-002", quantity: 1, displayNameSnapshot: "ยา B ที่ลงนาม", unitSnapshot: "หน่วย B" },
      ],
    });
    receiveLot(database, { id: "lot-a", medicationId: "DEMO-MED-001", lotNumber: "A-ONE", expiryDate: "2026-08-10", quantity: 6 });
    receiveLot(database, { id: "lot-b", medicationId: "DEMO-MED-002", lotNumber: "B-ONE", expiryDate: "2026-08-10", quantity: 1 });

    expect(getReadiness(inventory, "readiness-duplicate")).toEqual({
      ready: true,
      lines: [
        { medicationId: "DEMO-MED-001", displayNameSnapshot: "ยา A ที่ลงนาม", required: 5, available: 6, shortfall: 0, unitSnapshot: "หน่วย A" },
        { medicationId: "DEMO-MED-002", displayNameSnapshot: "ยา B ที่ลงนาม", required: 1, available: 1, shortfall: 0, unitSnapshot: "หน่วย B" },
      ],
    });
  });

  it("excludes quarantined, expired, and Bangkok-today lots while counting future lots", async () => {
    const { database, inventory } = await fixture("2026-08-03T16:59:59.999Z");
    addVisitOrder(database, {
      visitId: "readiness-expiry",
      decisionId: "decision-expiry",
      items: [{ id: "order-expiry", medicationId: "DEMO-MED-001", quantity: 8 }],
    });
    receiveLot(database, { id: "lot-expired", medicationId: "DEMO-MED-001", lotNumber: "EXPIRED", expiryDate: "2026-08-02", quantity: 9 });
    receiveLot(database, { id: "lot-today", medicationId: "DEMO-MED-001", lotNumber: "TODAY", expiryDate: "2026-08-03", quantity: 9 });
    receiveLot(database, { id: "lot-quarantine", medicationId: "DEMO-MED-001", lotNumber: "QUARANTINE", expiryDate: "2026-08-10", quantity: 9, status: "QUARANTINED" });
    receiveLot(database, { id: "lot-future", medicationId: "DEMO-MED-001", lotNumber: "FUTURE", expiryDate: "2026-08-04", quantity: 7 });

    expect(getReadiness(inventory, "readiness-expiry")).toEqual({
      ready: false,
      lines: [{
        medicationId: "DEMO-MED-001",
        displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A",
        required: 8,
        available: 7,
        shortfall: 1,
        unitSnapshot: "เม็ด",
      }],
    });
  });

  it("subtracts active reservations made for another Visit", async () => {
    const { database, doctor, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-held",
      decisionId: "decision-held",
      items: [{ id: "order-held", medicationId: "DEMO-MED-001", quantity: 5 }],
    });
    addVisitOrder(database, {
      visitId: "readiness-holder",
      decisionId: "decision-holder",
      items: [{ id: "order-holder", medicationId: "DEMO-MED-001", quantity: 4 }],
    });
    receiveLot(database, { id: "lot-held", medicationId: "DEMO-MED-001", lotNumber: "HELD", expiryDate: "2026-08-10", quantity: 8 });
    database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "readiness-holder", 3, 1));

    expect(getReadiness(inventory, "readiness-held")).toMatchObject({
      ready: false,
      lines: [{ medicationId: "DEMO-MED-001", required: 5, available: 4, shortfall: 1 }],
    });
  });

  it("is byte-for-byte read-only across repeated reads and Bangkok midnight", async () => {
    const { database, inventory, setNow } = await fixture("2026-08-03T16:59:59.999Z");
    addVisitOrder(database, {
      visitId: "readiness-no-writes",
      decisionId: "decision-no-writes",
      items: [{ id: "order-no-writes", medicationId: "DEMO-MED-001", quantity: 2 }],
    });
    receiveLot(database, { id: "lot-rollover", medicationId: "DEMO-MED-001", lotNumber: "ROLLOVER", expiryDate: "2026-08-04", quantity: 2 });
    const before = writeSensitiveSnapshot(database);

    expect(getReadiness(inventory, "readiness-no-writes")).toMatchObject({ ready: true, lines: [{ available: 2, shortfall: 0 }] });
    expect(getReadiness(inventory, "readiness-no-writes")).toMatchObject({ ready: true, lines: [{ available: 2, shortfall: 0 }] });
    expect(writeSensitiveSnapshot(database)).toBe(before);

    setNow("2026-08-03T17:00:00.000Z");
    expect(getReadiness(inventory, "readiness-no-writes")).toMatchObject({ ready: false, lines: [{ available: 0, shortfall: 2 }] });
    expect(writeSensitiveSnapshot(database)).toBe(before);
  });

  it("uses the same plan for readiness and exact per-order-item FEFO reservation allocations", async () => {
    const { database, doctor, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-parity",
      decisionId: "decision-parity",
      items: [
        { id: "order-parity-a-first", medicationId: "DEMO-MED-001", quantity: 4 },
        { id: "order-parity-b", medicationId: "DEMO-MED-002", quantity: 2 },
        { id: "order-parity-a-second", medicationId: "DEMO-MED-001", quantity: 3 },
      ],
    });
    receiveLot(database, { id: "lot-a-late", medicationId: "DEMO-MED-001", lotNumber: "A-LATE", expiryDate: "2026-08-09", quantity: 4 });
    receiveLot(database, { id: "lot-a-early", medicationId: "DEMO-MED-001", lotNumber: "A-EARLY", expiryDate: "2026-08-05", quantity: 5 });
    receiveLot(database, { id: "lot-b-early", medicationId: "DEMO-MED-002", lotNumber: "B-EARLY", expiryDate: "2026-08-06", quantity: 2 });

    expect(getReadiness(inventory, "readiness-parity")).toMatchObject({
      ready: true,
      lines: [
        { medicationId: "DEMO-MED-001", required: 7, available: 9, shortfall: 0 },
        { medicationId: "DEMO-MED-002", required: 2, available: 2, shortfall: 0 },
      ],
    });
    const pickList = database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "readiness-parity", 3, 1));

    expect(pickList.reservation?.allocations.map((allocation) => [
      allocation.medicationOrderItemId,
      allocation.lotId,
      allocation.quantity,
    ])).toEqual([
      ["order-parity-a-first", "lot-a-early", 4],
      ["order-parity-b", "lot-b-early", 2],
      ["order-parity-a-second", "lot-a-early", 1],
      ["order-parity-a-second", "lot-a-late", 2],
    ]);
  });

  it("keeps a not-ready reservation command atomic with its stable error code", async () => {
    const { database, doctor, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-atomic",
      decisionId: "decision-atomic",
      items: [{ id: "order-atomic", medicationId: "DEMO-MED-001", quantity: 3 }],
    });
    receiveLot(database, { id: "lot-atomic", medicationId: "DEMO-MED-001", lotNumber: "ATOMIC", expiryDate: "2026-08-10", quantity: 2 });
    expect(getReadiness(inventory, "readiness-atomic")).toMatchObject({ ready: false, lines: [{ shortfall: 1 }] });
    const before = writeSensitiveSnapshot(database);

    expectReservationNotSellable(() => database.db.transaction((tx) => inventory.reserveForVisit(
      tx, doctor, "readiness-atomic", 3, 1,
    )));

    expect(writeSensitiveSnapshot(database)).toBe(before);
  });

  it("rejects stale ready advice after another Visit reserves the final stock without a negative balance", async () => {
    const { database, doctor, inventory } = await fixture();
    addVisitOrder(database, {
      visitId: "readiness-race-original",
      decisionId: "decision-race-original",
      items: [{ id: "order-race-original", medicationId: "DEMO-MED-001", quantity: 5 }],
    });
    addVisitOrder(database, {
      visitId: "readiness-race-winner",
      decisionId: "decision-race-winner",
      items: [{ id: "order-race-winner", medicationId: "DEMO-MED-001", quantity: 5 }],
    });
    receiveLot(database, { id: "lot-race", medicationId: "DEMO-MED-001", lotNumber: "RACE", expiryDate: "2026-08-10", quantity: 5 });

    expect(getReadiness(inventory, "readiness-race-original")).toMatchObject({ ready: true, lines: [{ available: 5, shortfall: 0 }] });
    database.db.transaction((tx) => inventory.reserveForVisit(tx, doctor, "readiness-race-winner", 3, 1));
    const afterWinner = writeSensitiveSnapshot(database);

    expectReservationNotSellable(() => database.db.transaction((tx) => inventory.reserveForVisit(
      tx, doctor, "readiness-race-original", 3, 1,
    )));

    expect(writeSensitiveSnapshot(database)).toBe(afterWinner);
    expect(inventory.getInventory().find((row) => row.medication.id === "DEMO-MED-001"))
      .toMatchObject({ onHand: 5, reserved: 5, available: 0 });
  });
});
