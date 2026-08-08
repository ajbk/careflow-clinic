import { afterEach, describe, expect, it } from "vitest";
import type { Actor, InventorySummaryDto, ReceiveInventoryPayload } from "../../src/shared/contracts.js";
import { createInventoryService } from "../../src/server/modules/inventory/index.js";
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

  it("rejects a duplicate medication and lot pair without leaving partial receipt records", async () => {
    const { database, inventory } = fixture();
    const actor = await receivingActor(database);

    receive(database, inventory, actor);
    expect(() => receive(database, inventory, actor)).toThrow(/มีในคลังแล้ว/);
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_receipts").get()).toEqual({ count: 1 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_receipt_lines").get()).toEqual({ count: 1 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_lots").get()).toEqual({ count: 1 });
    expect(database.sqlite.prepare("SELECT count(*) AS count FROM inventory_stock_movements").get()).toEqual({ count: 1 });
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
    })).statusCode).toBe(403);
    expect((await fixture.app.inject({
      method: "POST", url: "/api/inventory/receipts", headers: {
        cookie: fixture.doctorCookie, "idempotency-key": "inventory-doctor-receive-001",
      }, payload: receiptCommand(),
    })).statusCode).toBe(403);
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

  it("returns domain conflicts for stale medication revisions and duplicate medication lots", async () => {
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
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("INVALID_STATE");
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
