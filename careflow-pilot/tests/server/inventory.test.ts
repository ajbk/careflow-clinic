import { afterEach, describe, expect, it } from "vitest";
import type { Actor, InventorySummaryDto, ReceiveInventoryPayload } from "../../src/shared/contracts.js";
import { createInventoryService } from "../../src/server/modules/inventory/index.js";
import { seedAccount } from "./helpers/auth.js";
import { createTestDatabase, type TestDatabase } from "./helpers/database.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
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
});
