import { afterEach, describe, expect, it } from "vitest";
import type { Actor, InventorySummaryDto, ReceiveInventoryPayload } from "../../src/shared/contracts.js";
import { createInventoryService } from "../../src/server/modules/inventory/index.js";
import { medicationDecisions, medicationOrderItems } from "../../src/server/modules/medication/index.js";
import { patients } from "../../src/server/modules/patient/index.js";
import { visits } from "../../src/server/modules/visit/index.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp, createTestDatabase, type TestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture() {
  const database = createTestDatabase();
  cleanups.push(database.cleanup);
  let sequence = 0;
  const inventory = createInventoryService({
    database,
    clock: () => new Date("2026-08-03T00:00:00.000Z"),
    idFactory: () => `inventory-test-${++sequence}`,
  });
  return { database, inventory };
}

function payload(overrides: Partial<ReceiveInventoryPayload> = {}): ReceiveInventoryPayload {
  return {
    medicationId: "DEMO-MED-001",
    quantity: 12,
    lotNumber: "LOT-2608-A",
    expiryDate: "2027-08-31",
    supplierName: "ผู้จำหน่ายสังเคราะห์",
    note: "รับเข้ารอบเช้า",
    ...overrides,
  };
}

async function receivingActor(database: TestDatabase): Promise<Actor> {
  return (await seedAccount(database, {
    id: "assistant-001",
    username: "assistant",
    displayName: "ผู้ช่วยทดสอบ",
    role: "assistant",
    mustChangePassword: false,
  })).actor;
}

function receive(
  database: TestDatabase,
  inventory: ReturnType<typeof createInventoryService>,
  actor: Actor,
  receiptPayload = payload(),
  expectedMedicationRevision = 1,
) {
  return database.db.transaction((tx) => inventory.receiveStock(
    tx,
    actor,
    expectedMedicationRevision,
    receiptPayload,
  ));
}

function summary(rows: InventorySummaryDto[], medicationId: string): InventorySummaryDto {
  const row = rows.find((candidate) => candidate.medication.id === medicationId);
  if (!row) throw new Error(`Missing inventory summary for ${medicationId}`);
  return row;
}

describe("inventory foundation service", () => {
  it("receives an active medication into a future-expiry lot and derives stock from its movement", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);

    const receipt = receive(database, inventory, actor);

    expect(receipt).toMatchObject({
      medication: { id: "DEMO-MED-001", revision: 1 },
      lot: {
        medicationId: "DEMO-MED-001",
        lotNumber: "LOT-2608-A",
        expiryDate: "2027-08-31",
        supplierName: "ผู้จำหน่ายสังเคราะห์",
      },
      quantity: 12,
      unit: "เม็ด",
    });
    expect(summary(inventory.getInventory(), "DEMO-MED-001")).toMatchObject({
      onHand: 12,
      reserved: 0,
      available: 12,
      lotCount: 1,
      nearestExpiry: "2027-08-31",
      status: "OK",
    });
    expect(database.sqlite.prepare(
      "SELECT quantity_delta FROM inventory_stock_movements WHERE lot_id = ?",
    ).all(receipt.lot.id)).toEqual([{ quantity_delta: 12 }]);
  });

  it("projects received ledger stock for a signed ORDER without creating reservation evidence", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);
    receive(database, inventory, actor, payload({ quantity: 7, lotNumber: "READINESS-LOT" }));
    database.db.insert(patients).values({
      id: "readiness-patient",
      clinicId: "clinic",
      hn: "DEMO-000009",
      displayName: "ผู้ป่วยทดสอบ 000009",
      phone: "0000000009",
      birthDate: "1990-01-01",
      sex: "unknown",
      revision: 1,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    }).run();
    database.db.insert(visits).values({
      id: "readiness-visit",
      clinicId: "clinic",
      patientId: "readiness-patient",
      status: "AWAITING_PREPARATION",
      chiefComplaint: "อาการสังเคราะห์",
      revision: 3,
      arrivedAt: "2026-08-03T00:00:00.000Z",
      startedAt: "2026-08-03T00:00:00.000Z",
      closedAt: null,
      createdBy: actor.id,
    }).run();
    database.db.insert(medicationDecisions).values({
      id: "readiness-decision",
      visitId: "readiness-visit",
      version: 1,
      kind: "ORDER",
      noMedicationReason: null,
      revisionReason: null,
      supersedesId: null,
      signedBy: actor.id,
      signedByDisplayName: actor.displayName,
      signedAt: "2026-08-03T00:00:00.000Z",
      contentHash: "a".repeat(64),
    }).run();
    database.db.insert(medicationOrderItems).values({
      id: "readiness-order-item",
      medicationDecisionId: "readiness-decision",
      position: 0,
      medicationId: "DEMO-MED-001",
      medicationRevision: 1,
      displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A",
      strengthSnapshot: "500 หน่วยทดสอบ",
      dosageFormSnapshot: "เม็ดทดสอบ",
      unitSnapshot: "เม็ด",
      quantity: 7,
      directionsTh: "รับประทานตามคำสั่งสังเคราะห์",
    }).run();
    const before = database.sqlite.prepare(`
      SELECT
        (SELECT count(*) FROM inventory_reservations) AS reservations,
        (SELECT count(*) FROM inventory_reservation_allocations) AS allocations,
        (SELECT count(*) FROM inventory_stock_movements) AS movements,
        (SELECT revision FROM inventory_lots WHERE lot_number = 'READINESS-LOT') AS lot_revision,
        (SELECT revision FROM visits WHERE id = 'readiness-visit') AS visit_revision,
        (SELECT count(*) FROM audit_events) AS audits,
        (SELECT count(*) FROM idempotency_records) AS idempotency
    `).get();

    expect(inventory.getReservationReadiness("readiness-visit")).toEqual({
      ready: true,
      lines: [{
        medicationId: "DEMO-MED-001",
        displayNameSnapshot: "[DEMO] ยาทดสอบชนิด A",
        required: 7,
        available: 7,
        shortfall: 0,
        unitSnapshot: "เม็ด",
      }],
    });
    expect(database.sqlite.prepare(`
      SELECT
        (SELECT count(*) FROM inventory_reservations) AS reservations,
        (SELECT count(*) FROM inventory_reservation_allocations) AS allocations,
        (SELECT count(*) FROM inventory_stock_movements) AS movements,
        (SELECT revision FROM inventory_lots WHERE lot_number = 'READINESS-LOT') AS lot_revision,
        (SELECT revision FROM visits WHERE id = 'readiness-visit') AS visit_revision,
        (SELECT count(*) FROM audit_events) AS audits,
        (SELECT count(*) FROM idempotency_records) AS idempotency
    `).get()).toEqual(before);
  });

  it("classifies zero, low, okay, and all-expired stock from the ledger and clinic date", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);

    receive(database, inventory, actor, payload({ quantity: 1, lotNumber: "LOW-1" }));
    receive(database, inventory, actor, payload({
      medicationId: "DEMO-MED-002", quantity: 11, lotNumber: "OK-11",
    }));
    const expired = receive(database, inventory, actor, payload({
      medicationId: "DEMO-MED-004", quantity: 4, lotNumber: "EXPIRED-4",
    }));
    database.sqlite.prepare("UPDATE inventory_lots SET expiry_date = ? WHERE id = ?")
      .run("2026-08-02", expired.lot.id);

    const rows = inventory.getInventory();
    expect(summary(rows, "DEMO-MED-001")).toMatchObject({ onHand: 1, available: 1, status: "LOW" });
    expect(summary(rows, "DEMO-MED-002")).toMatchObject({ onHand: 11, available: 11, status: "OK" });
    expect(summary(rows, "DEMO-MED-003")).toMatchObject({ onHand: 0, available: 0, status: "OUT" });
    expect(summary(rows, "DEMO-MED-004")).toMatchObject({ onHand: 4, available: 0, status: "EXPIRED" });
  });

  it("rejects stale medication revisions and non-future expiry dates before receipt data is committed", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);

    database.sqlite.prepare("UPDATE medications SET revision = 2 WHERE id = 'DEMO-MED-001'").run();
    expect(() => receive(database, inventory, actor)).toThrow(/ข้อมูลมีการเปลี่ยนแปลง/);
    expect(() => receive(database, inventory, actor, payload({ expiryDate: "2026-08-03" }), 2))
      .toThrow(/วันหมดอายุต้องเป็นวันในอนาคต/);
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_receipts").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_lots").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_stock_movements").get()).toEqual({ count: 0 });
  });

  it("appends a receipt into an existing medication and lot while preserving one lot identity", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);

    const first = receive(database, inventory, actor);
    const second = receive(database, inventory, actor);
    expect(second.lot.id).toBe(first.lot.id);
    expect(second.lot.revision).toBe(2);
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_receipts").get()).toEqual({ count: 2 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_receipt_lines").get()).toEqual({ count: 2 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_lots").get()).toEqual({ count: 1 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_stock_movements").get()).toEqual({ count: 2 });
    expect(summary(inventory.getInventory(), "DEMO-MED-001")).toMatchObject({ onHand: 24, available: 24 });
    expect(() => receive(database, inventory, actor, payload({ expiryDate: "2027-09-01" })))
      .toThrow(/ข้อมูลล็อตเดิมไม่ตรงกัน/);
  });

  it("enforces append-only stock movements at the database boundary", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);
    const receipt = receive(database, inventory, actor);

    expect(() => database.sqlite.prepare(
      "UPDATE inventory_stock_movements SET quantity_delta = 99 WHERE lot_id = ?",
    ).run(receipt.lot.id)).toThrow(/append-only/);
    expect(() => database.sqlite.prepare(
      "DELETE FROM inventory_stock_movements WHERE lot_id = ?",
    ).run(receipt.lot.id)).toThrow(/append-only/);
    expect(() => database.sqlite.prepare(`
      INSERT INTO inventory_adjustments (id, clinic_id, lot_id, corrects_movement_id, quantity_delta, reason, occurred_at, actor_id)
      VALUES ('invalid-adjustment-source', 'clinic', ?, 'missing-movement', 1, 'ทดสอบ', '2026-08-03T00:00:00.000Z', ?)
    `).run(receipt.lot.id, actor.id)).toThrow(/correction source|same clinic|invalid/i);
    const otherReceipt = receive(database, inventory, actor, payload({ lotNumber: "LOT-2608-B" }));
    const otherMovementId = database.sqlite.prepare("SELECT id FROM inventory_stock_movements WHERE lot_id = ?").pluck().get(otherReceipt.lot.id) as string;
    expect(() => database.sqlite.prepare(`
      INSERT INTO inventory_adjustments (id, clinic_id, lot_id, corrects_movement_id, quantity_delta, reason, occurred_at, actor_id)
      VALUES ('invalid-adjustment-cross-lot', 'clinic', ?, ?, 1, 'ทดสอบ', '2026-08-03T00:00:00.000Z', ?)
    `).run(receipt.lot.id, otherMovementId, actor.id)).toThrow(/correction source|same clinic|invalid/i);
  });

  it("rebuilds a persisted receipt by its identifier", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);
    const received = receive(database, inventory, actor);

    expect(inventory.getReceipt(received.id)).toEqual(received);
  });
});

async function inventoryApiFixture() {
  let sequence = 0;
  const fixture = await createTestApp({ idFactory: () => `inventory-request-${++sequence}` });
  cleanups.push(fixture.cleanup);
  const assistant = await seedAccount(fixture.database, {
    id: "inventory-assistant-001",
    username: "inventory-assistant",
    displayName: "ผู้ช่วยคลังทดสอบ",
    role: "assistant",
    mustChangePassword: false,
  });
  const doctor = await seedAccount(fixture.database, {
    id: "inventory-doctor-001",
    username: "inventory-doctor",
    displayName: "พญ. คลังทดสอบ",
    role: "doctor",
    mustChangePassword: false,
  });
  const assistantCookie = cookieFrom(await login(fixture.app, assistant.username, assistant.password));
  const doctorCookie = cookieFrom(await login(fixture.app, doctor.username, doctor.password));
  return { ...fixture, assistant, doctor, assistantCookie, doctorCookie };
}

function receiptCommand(overrides: Partial<ReceiveInventoryPayload> = {}) {
  return {
    expectedRevisions: { medication: 1 },
    payload: payload({ lotNumber: "API-LOT-001", ...overrides }),
  };
}

describe("inventory receiving API", () => {
  it("requires authentication and separates inventory read from inventory receiving", async () => {
    const fixture = await inventoryApiFixture();

    expect((await fixture.app.inject({ method: "GET", url: "/api/inventory" })).statusCode).toBe(401);
    expect((await fixture.app.inject({ method: "GET", url: "/api/inventory/medications?q=DEMO" })).statusCode).toBe(401);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", payload: receiptCommand(),
      headers: { "idempotency-key": "inventory-anon-001" },
    })).statusCode).toBe(401);

    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory", headers: { cookie: fixture.assistantCookie },
    })).statusCode).toBe(200);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory", headers: { cookie: fixture.doctorCookie },
    })).statusCode).toBe(200);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory/medications?q=DEMO", headers: { cookie: fixture.assistantCookie },
    })).json().data).toHaveLength(4);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory/medications?q=DEMO", headers: { cookie: fixture.doctorCookie },
    })).statusCode).toBe(200);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers: {
        cookie: fixture.doctorCookie, "idempotency-key": "inventory-doctor-receive-001",
      }, payload: receiptCommand(),
    })).statusCode).toBe(201);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/medications?q=DEMO", headers: { cookie: fixture.assistantCookie },
    })).statusCode).toBe(403);
  });

  it("receives stock atomically with audit evidence and exactly replays the original receipt response", async () => {
    const fixture = await inventoryApiFixture();
    const command = receiptCommand({ note: "นับรับพร้อมใบส่งของ" });
    const headers = { cookie: fixture.assistantCookie, "idempotency-key": "inventory-receipt-001" };

    const first = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers, payload: command,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      replayed: false,
      data: { id: expect.any(String), quantity: 12, inventory: { available: 12 } },
    });
    const audit = fixture.database.sqlite.prepare(
      "SELECT action, entity_type, entity_id, entity_revision, reason, actor_id FROM audit_events",
    ).get();
    expect(audit).toEqual({
      action: "inventory.stock-received",
      entity_type: "inventory_receipt",
      entity_id: first.json().data.id,
      entity_revision: 1,
      reason: "นับรับพร้อมใบส่งของ",
      actor_id: fixture.assistant.actor.id,
    });
    const stored = fixture.database.sqlite.prepare(
      "SELECT request_hash, response_json FROM idempotency_records WHERE actor_id = ? AND key = ?",
    ).get(fixture.assistant.actor.id, headers["idempotency-key"]) as {
      request_hash: string;
      response_json: string;
    };
    expect(stored.request_hash).toBe("3a96c7495f31ee87dff376013c6a55c9ed34146abd9c2c8cf5fd9fb033ddae1f");
    expect(JSON.parse(stored.response_json)).toEqual({ data: first.json().data, replayed: false });

    const second = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts",
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-receipt-002" },
      payload: receiptCommand({ lotNumber: "API-LOT-002", quantity: 5, note: "ล็อตถัดไป" }),
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.inventory.available).toBe(17);

    const replay = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers, payload: command,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ data: first.json().data, replayed: true });
    expect(fixture.database.sqlite.prepare("SELECT count(*) AS count FROM audit_events").get()).toEqual({ count: 2 });

    const collision = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers,
      payload: receiptCommand({ quantity: 13, note: "จำนวนเปลี่ยน" }),
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("returns domain conflicts for stale revisions and appends a matching medication lot", async () => {
    const fixture = await inventoryApiFixture();
    const headers = { cookie: fixture.assistantCookie, "idempotency-key": "inventory-stale-001" };
    const stale = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers,
      payload: { ...receiptCommand(), expectedRevisions: { medication: 9 } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("REVISION_CONFLICT");

    const first = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts",
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-lot-first-001" },
      payload: receiptCommand(),
    });
    expect(first.statusCode).toBe(201);
    const duplicate = await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts",
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-lot-duplicate-001" },
      payload: receiptCommand(),
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().data.lot.id).toBe(first.json().data.lot.id);
    expect(duplicate.json().data.lot.revision).toBe(first.json().data.lot.revision + 1);
  });

  it("rejects malformed or unknown inventory input and invalid idempotency keys", async () => {
    const fixture = await inventoryApiFixture();
    const headers = { cookie: fixture.assistantCookie, "idempotency-key": "inventory-validate-001" };

    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory/medications?q=D", headers: { cookie: fixture.assistantCookie },
    })).statusCode).toBe(422);
    expect((await fixture.app.inject({
      method: "GET", url: "/api/inventory/medications?q=DEMO&unexpected=true", headers: {
        cookie: fixture.assistantCookie,
      },
    })).statusCode).toBe(422);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers: { cookie: fixture.assistantCookie },
      payload: receiptCommand(),
    })).statusCode).toBe(422);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers: {
        cookie: fixture.assistantCookie, "idempotency-key": "short",
      }, payload: receiptCommand(),
    })).statusCode).toBe(422);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers,
      payload: { ...receiptCommand(), unexpected: true },
    })).statusCode).toBe(422);
  });
});

describe("inventory integrity API", () => {
  async function receivedLot() {
    const fixture = await inventoryApiFixture();
    const receipt = await fixture.app.inject({
      method: "POST",
      url: "/api/inventory/receipts",
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-integrity-receipt-001" },
      payload: receiptCommand({ lotNumber: "INTEGRITY-LOT-001", quantity: 12 }),
    });
    expect(receipt.statusCode).toBe(201);
    return { fixture, lot: receipt.json().data.lot as { id: string; revision: number } };
  }

  it("lists a medication's immutable lot balance and revision for inventory actions", async () => {
    const { fixture, lot } = await receivedLot();

    const response = await fixture.app.inject({
      method: "GET",
      url: "/api/inventory/medications/DEMO-MED-001/lots",
      headers: { cookie: fixture.assistantCookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([expect.objectContaining({
      id: lot.id,
      status: "AVAILABLE",
      revision: lot.revision,
      onHand: 12,
      reserved: 0,
      available: 12,
      recentMovements: [expect.objectContaining({
        id: expect.any(String), lotId: lot.id, quantityDelta: 12, sourceType: "RECEIPT", sourceId: expect.any(String), occurredAt: expect.any(String),
      })],
    })]);
  });

  it("allows assistant quarantine but reserves unquarantine and adjustments for doctors", async () => {
    const { fixture, lot } = await receivedLot();
    const assistantQuarantine = await fixture.app.inject({
      method: "POST",
      url: `/api/inventory/lots/${lot.id}/quarantine`,
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-quarantine-assistant-001" },
      payload: { expectedRevisions: { lot: lot.revision }, payload: { reason: "พบกล่องฉีกขาด" } },
    });
    expect(assistantQuarantine.statusCode).toBe(201);
    expect(assistantQuarantine.json()).toMatchObject({ replayed: false, data: { status: "QUARANTINED", revision: lot.revision + 1 } });

    const assistantUnquarantine = await fixture.app.inject({
      method: "POST",
      url: `/api/inventory/lots/${lot.id}/unquarantine`,
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-unquarantine-assistant-001" },
      payload: { expectedRevisions: { lot: lot.revision + 1 }, payload: { reason: "ตรวจแล้ว" } },
    });
    expect(assistantUnquarantine.statusCode).toBe(403);

    const assistantAdjustment = await fixture.app.inject({
      method: "POST",
      url: `/api/inventory/lots/${lot.id}/adjustments`,
      headers: { cookie: fixture.assistantCookie, "idempotency-key": "inventory-adjustment-assistant-001" },
      payload: { expectedRevisions: { lot: lot.revision + 1 }, payload: { correctsMovementId: "missing", quantityDelta: -1, reason: "นับจริง" } },
    });
    expect(assistantAdjustment.statusCode).toBe(403);
  });

  it("strictly validates integrity commands and prevents a stale or negative adjustment", async () => {
    const { fixture, lot } = await receivedLot();
    const doctorHeaders = { cookie: fixture.doctorCookie, "idempotency-key": "inventory-integrity-validation-001" };

    const unknown = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/quarantine`, headers: doctorHeaders,
      payload: { expectedRevisions: { lot: lot.revision }, payload: { reason: "ตรวจสอบ", unexpected: true } },
    });
    expect(unknown.statusCode).toBe(422);
    const missingReason = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/quarantine`,
      headers: { ...doctorHeaders, "idempotency-key": "inventory-integrity-validation-002" },
      payload: { expectedRevisions: { lot: lot.revision }, payload: { reason: "" } },
    });
    expect(missingReason.statusCode).toBe(422);

    const movementId = fixture.database.sqlite.prepare("SELECT id FROM inventory_stock_movements WHERE lot_id = ?").pluck().get(lot.id) as string;
    const stale = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/adjustments`,
      headers: { ...doctorHeaders, "idempotency-key": "inventory-integrity-validation-003" },
      payload: { expectedRevisions: { lot: lot.revision + 1 }, payload: { correctsMovementId: movementId, quantityDelta: -1, reason: "นับจริง" } },
    });
    expect(stale.statusCode).toBe(409);

    const negative = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/adjustments`,
      headers: { ...doctorHeaders, "idempotency-key": "inventory-integrity-validation-004" },
      payload: { expectedRevisions: { lot: lot.revision }, payload: { correctsMovementId: movementId, quantityDelta: -13, reason: "นับจริง" } },
    });
    expect(negative.statusCode).toBe(409);
    expect(negative.json().error.code).toBe("STOCK_WOULD_BE_NEGATIVE");
  });

  it("records a source-linked append-only adjustment and status event exactly once", async () => {
    const { fixture, lot } = await receivedLot();
    const movementId = fixture.database.sqlite.prepare("SELECT id FROM inventory_stock_movements WHERE lot_id = ?").pluck().get(lot.id) as string;
    const adjustmentHeaders = { cookie: fixture.doctorCookie, "idempotency-key": "inventory-adjustment-happy-001" };
    const adjustmentPayload = { expectedRevisions: { lot: lot.revision }, payload: { correctsMovementId: movementId, quantityDelta: -2, reason: "นับจริงหลังตรวจชั้นยา" } };
    const first = await fixture.app.inject({ method: "POST", url: `/api/inventory/lots/${lot.id}/adjustments`, headers: adjustmentHeaders, payload: adjustmentPayload });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ replayed: false, data: { onHand: 10, reserved: 0, available: 10, revision: lot.revision + 1 } });
    expect(fixture.database.sqlite.prepare("SELECT movement_type, source_type, quantity_delta FROM inventory_stock_movements WHERE lot_id = ? AND movement_type = 'ADJUSTMENT'").get(lot.id)).toEqual({ movement_type: "ADJUSTMENT", source_type: "ADJUSTMENT", quantity_delta: -2 });
    const adjustmentAudit = fixture.database.sqlite.prepare("SELECT action, occurred_at, metadata_json FROM audit_events WHERE action LIKE 'inventory.%adjusted'").get() as { action: string; occurred_at: string; metadata_json: string };
    expect(adjustmentAudit.action).toBe("inventory.stock-adjusted");
    expect(adjustmentAudit.occurred_at).toBe("2026-08-03T00:00:00.000Z");
    expect(JSON.parse(adjustmentAudit.metadata_json)).toMatchObject({ lotId: lot.id, correctsMovementId: movementId, quantityDelta: -2 });
    expect(() => fixture.database.sqlite.prepare("UPDATE inventory_adjustments SET reason = 'แก้' WHERE lot_id = ?").run(lot.id)).toThrow(/append-only/);
    const replay = await fixture.app.inject({ method: "POST", url: `/api/inventory/lots/${lot.id}/adjustments`, headers: adjustmentHeaders, payload: adjustmentPayload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, data: { onHand: 10, revision: lot.revision + 1 } });

    const quarantine = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/quarantine`,
      headers: { cookie: fixture.doctorCookie, "idempotency-key": "inventory-status-event-001" },
      payload: { expectedRevisions: { lot: lot.revision + 1 }, payload: { reason: "รอตรวจสอบซ้ำ" } },
    });
    expect(quarantine.statusCode).toBe(201);
    expect(fixture.database.sqlite.prepare("SELECT previous_status, next_status, reason FROM inventory_lot_status_events WHERE lot_id = ?").get(lot.id)).toEqual({ previous_status: "AVAILABLE", next_status: "QUARANTINED", reason: "รอตรวจสอบซ้ำ" });
    expect(() => fixture.database.sqlite.prepare("DELETE FROM inventory_lot_status_events WHERE lot_id = ?").run(lot.id)).toThrow(/append-only/);
  });

  it("blocks quarantine while a lot is actively reserved and blocks expired unquarantine", async () => {
    const { fixture, lot } = await receivedLot();
    const now = "2026-08-03T00:00:00.000Z";
    fixture.database.sqlite.exec(`
      INSERT INTO patients (id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at)
      VALUES ('integrity-patient', 'clinic', 'DEMO-000099', 'ผู้ป่วยทดสอบ 000099', '0000000099', '1990-01-01', 'unknown', 1, '${now}', '${now}');
      INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, created_by)
      VALUES ('integrity-visit', 'clinic', 'integrity-patient', 'PREPARING', 'ทดสอบ', 1, '${now}', '${fixture.doctor.actor.id}');
      INSERT INTO medication_decisions (id, visit_id, version, kind, signed_by, signed_at, content_hash, signed_by_display_name)
      VALUES ('integrity-decision', 'integrity-visit', 1, 'ORDER', '${fixture.doctor.actor.id}', '${now}', '${"a".repeat(64)}', 'พญ. คลังทดสอบ');
      INSERT INTO medication_order_items (id, medication_decision_id, position, medication_id, medication_revision, display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th)
      VALUES ('integrity-order-item', 'integrity-decision', 0, 'DEMO-MED-001', 1, 'ยา integrity', '500 mg', 'เม็ด', 'เม็ด', 1, 'ทดสอบ');
      INSERT INTO inventory_reservations (id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by)
      VALUES ('integrity-reservation', 'clinic', 'integrity-visit', 'integrity-decision', 1, 'ACTIVE', '${now}', '${fixture.assistant.actor.id}');
      INSERT INTO inventory_reservation_allocations (id, reservation_id, medication_order_item_id, lot_id, position, quantity, medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at)
      VALUES ('integrity-allocation', 'integrity-reservation', 'integrity-order-item', '${lot.id}', 0, 1, 'DEMO-MED-001', 'INTEGRITY-LOT-001', '2027-08-31', 'เม็ด', '${now}');
    `);
    const activeReservation = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/quarantine`,
      headers: { cookie: fixture.doctorCookie, "idempotency-key": "inventory-reserved-quarantine-001" },
      payload: { expectedRevisions: { lot: lot.revision }, payload: { reason: "ต้องกักกัน" } },
    });
    expect(activeReservation.statusCode).toBe(409);
    expect(activeReservation.json().error.code).toBe("LOT_RESERVED");

    fixture.database.sqlite.prepare("UPDATE inventory_reservations SET status = 'RELEASED', released_at = ?, released_by = ?, release_reason = ? WHERE id = 'integrity-reservation'").run(now, fixture.assistant.actor.id, "ยกเลิกเพื่อทดสอบ");
    const quarantined = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/quarantine`,
      headers: { cookie: fixture.doctorCookie, "idempotency-key": "inventory-expired-quarantine-001" },
      payload: { expectedRevisions: { lot: lot.revision }, payload: { reason: "ตรวจหมดอายุ" } },
    });
    expect(quarantined.statusCode).toBe(201);
    fixture.database.sqlite.prepare("UPDATE inventory_lots SET expiry_date = '2026-08-03' WHERE id = ?").run(lot.id);
    const expiredUnquarantine = await fixture.app.inject({
      method: "POST", url: `/api/inventory/lots/${lot.id}/unquarantine`,
      headers: { cookie: fixture.doctorCookie, "idempotency-key": "inventory-expired-unquarantine-001" },
      payload: { expectedRevisions: { lot: lot.revision + 1 }, payload: { reason: "ตรวจซ้ำ" } },
    });
    expect(expiredUnquarantine.statusCode).toBe(409);
    expect(expiredUnquarantine.json().error.code).toBe("INVALID_STATE");
  });
});
