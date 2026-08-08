import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  Actor,
  InventoryLotDto,
  InventoryReceiptDto,
  InventorySummaryDto,
  MedicationDto,
  ReceiveInventoryPayload,
} from "../../../shared/contracts.js";
import { receiveInventoryPayloadSchema } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import { createMedicationService, type MedicationService } from "../medication/service.js";
import { medications } from "../medication/schema.js";
import type { AppDatabase, AppTransaction } from "../platform/index.js";
import {
  inventoryLots,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryStockMovements,
} from "./schema.js";
import { staffAccounts } from "../platform/schema.js";

export const SYNTHETIC_PILOT_LOW_STOCK_THRESHOLD = 10;

export interface InventoryService {
  getInventory(): InventorySummaryDto[];
  searchMedicationCatalog(query: string): MedicationDto[];
  receiveStock(
    tx: AppTransaction,
    actor: Actor,
    expectedMedicationRevision: number,
    payload: ReceiveInventoryPayload,
  ): InventoryReceiptDto;
  getReceipt(id: string): InventoryReceiptDto;
}

export interface InventoryServiceOptions {
  database: DatabaseHandle;
  medicationService?: MedicationService;
  clock?: () => Date;
  idFactory?: () => string;
}

type InventoryTransaction = AppDatabase | AppTransaction;

function clinicDate(clock: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(clock);
  const read = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) throw new Error("Clinic date formatting failed");
  return `${year}-${month}-${day}`;
}

function toMedicationDto(row: typeof medications.$inferSelect): MedicationDto {
  return {
    id: row.id,
    displayName: row.displayName,
    strengthText: row.strengthText,
    dosageFormText: row.dosageFormText,
    canonicalUnit: row.canonicalUnit,
    revision: row.revision,
  };
}

function inventoryStatus(onHand: number, available: number): InventorySummaryDto["status"] {
  if (available === 0) return onHand === 0 ? "OUT" : "EXPIRED";
  if (available <= SYNTHETIC_PILOT_LOW_STOCK_THRESHOLD) return "LOW";
  return "OK";
}

function readInventory(tx: InventoryTransaction, currentClinicDate: string): InventorySummaryDto[] {
  const onHand = sql<number>`coalesce(sum(${inventoryStockMovements.quantityDelta}), 0)`;
  const available = sql<number>`coalesce(sum(case
    when ${inventoryLots.status} = 'AVAILABLE' and ${inventoryLots.expiryDate} > ${currentClinicDate}
      then ${inventoryStockMovements.quantityDelta}
    else 0
  end), 0)`;
  const lotCount = sql<number>`count(distinct ${inventoryLots.id})`;
  const nearestExpiry = sql<string | null>`min(case
    when ${inventoryLots.status} = 'AVAILABLE' and ${inventoryLots.expiryDate} > ${currentClinicDate}
      then ${inventoryLots.expiryDate}
    else null
  end)`;
  const rows = tx.select({
    medication: medications,
    onHand,
    available,
    lotCount,
    nearestExpiry,
  })
    .from(medications)
    .leftJoin(inventoryLots, and(
      eq(inventoryLots.medicationId, medications.id),
      eq(inventoryLots.clinicId, "clinic"),
    ))
    .leftJoin(inventoryStockMovements, eq(inventoryStockMovements.lotId, inventoryLots.id))
    .where(eq(medications.active, 1))
    .groupBy(
      medications.id,
      medications.displayName,
      medications.strengthText,
      medications.dosageFormText,
      medications.canonicalUnit,
      medications.revision,
    )
    .orderBy(asc(medications.displayName), asc(medications.id))
    .all();
  return rows.map((row) => {
    const onHandValue = Number(row.onHand);
    const availableValue = Number(row.available);
    return {
      medication: toMedicationDto(row.medication),
      onHand: onHandValue,
      reserved: 0,
      available: availableValue,
      lotCount: Number(row.lotCount),
      nearestExpiry: row.nearestExpiry,
      status: inventoryStatus(onHandValue, availableValue),
    };
  });
}

function parsePayload(payload: ReceiveInventoryPayload): ReceiveInventoryPayload {
  const parsed = receiveInventoryPayloadSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || "payload";
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  throw new ApiError({
    code: "VALIDATION_FAILED",
    messageTh: "ข้อมูลรับยาไม่ถูกต้อง",
    fieldErrors,
  });
}

function assertFutureExpiry(expiryDate: string, currentClinicDate: string): void {
  if (expiryDate <= currentClinicDate) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "วันหมดอายุต้องเป็นวันในอนาคต",
      fieldErrors: { "payload.expiryDate": "วันหมดอายุต้องเป็นวันในอนาคต" },
    });
  }
}

function toLotDto(input: {
  lot: typeof inventoryLots.$inferSelect;
  createdBy: { id: string; displayName: string };
}): InventoryLotDto {
  return {
    id: input.lot.id,
    medicationId: input.lot.medicationId,
    medicationRevision: input.lot.medicationRevision,
    displayNameSnapshot: input.lot.displayNameSnapshot,
    strengthSnapshot: input.lot.strengthSnapshot,
    dosageFormSnapshot: input.lot.dosageFormSnapshot,
    unitSnapshot: input.lot.unitSnapshot,
    lotNumber: input.lot.lotNumber,
    expiryDate: input.lot.expiryDate,
    supplierName: input.lot.supplierName,
    status: input.lot.status,
    createdAt: input.lot.createdAt,
    createdBy: input.createdBy,
  };
}

function receiptFromTransaction(
  tx: InventoryTransaction,
  receiptId: string,
  currentClinicDate: string,
): InventoryReceiptDto {
  const row = tx.select({
    receipt: inventoryReceipts,
    line: inventoryReceiptLines,
    lot: inventoryLots,
    medication: medications,
    receivedBy: { id: staffAccounts.id, displayName: staffAccounts.displayName },
    createdBy: { id: staffAccounts.id, displayName: staffAccounts.displayName },
  })
    .from(inventoryReceipts)
    .innerJoin(inventoryReceiptLines, eq(inventoryReceiptLines.receiptId, inventoryReceipts.id))
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryReceiptLines.lotId))
    .innerJoin(medications, eq(medications.id, inventoryLots.medicationId))
    .innerJoin(staffAccounts, eq(staffAccounts.id, inventoryReceipts.receivedBy))
    .where(eq(inventoryReceipts.id, receiptId))
    .get();
  if (!row) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบใบรับยา" });
  const inventory = readInventory(tx, currentClinicDate)
    .find((entry) => entry.medication.id === row.medication.id);
  if (!inventory) throw new Error("Received medication is missing from inventory summary");
  return {
    id: row.receipt.id,
    supplierName: row.receipt.supplierName,
    note: row.receipt.note,
    receivedAt: row.receipt.receivedAt,
    receivedBy: row.receivedBy,
    medication: toMedicationDto(row.medication),
    lot: toLotDto({ lot: row.lot, createdBy: row.createdBy }),
    quantity: row.line.quantity,
    unit: row.line.unitSnapshot,
    inventory,
  };
}

export function createInventoryService(input: InventoryServiceOptions): InventoryService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  const medicationService = input.medicationService ?? createMedicationService({
    database: input.database,
    clock,
    idFactory,
  });

  return {
    getInventory() {
      return readInventory(input.database.db, clinicDate(clock()));
    },

    searchMedicationCatalog(query) {
      return medicationService.searchMedications(query);
    },

    receiveStock(tx, actor, expectedMedicationRevision, rawPayload) {
      const payload = parsePayload(rawPayload);
      const currentClinicDate = clinicDate(clock());
      assertFutureExpiry(payload.expiryDate, currentClinicDate);
      const medication = medicationService.assertMedicationRevision(
        tx,
        payload.medicationId,
        expectedMedicationRevision,
      );
      const existing = tx.select({ id: inventoryLots.id })
        .from(inventoryLots)
        .where(and(
          eq(inventoryLots.clinicId, "clinic"),
          eq(inventoryLots.medicationId, medication.id),
          eq(inventoryLots.lotNumber, payload.lotNumber),
        ))
        .get();
      if (existing) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "ล็อตยานี้มีในคลังแล้ว" });
      }

      const occurredAt = clock().toISOString();
      const receiptId = idFactory();
      const lotId = idFactory();
      tx.insert(inventoryReceipts).values({
        id: receiptId,
        clinicId: "clinic",
        supplierName: payload.supplierName,
        note: payload.note,
        receivedAt: occurredAt,
        receivedBy: actor.id,
      }).run();
      tx.insert(inventoryLots).values({
        id: lotId,
        clinicId: "clinic",
        medicationId: medication.id,
        medicationRevision: medication.revision,
        displayNameSnapshot: medication.displayName,
        strengthSnapshot: medication.strengthText,
        dosageFormSnapshot: medication.dosageFormText,
        unitSnapshot: medication.canonicalUnit,
        lotNumber: payload.lotNumber,
        expiryDate: payload.expiryDate,
        supplierName: payload.supplierName,
        status: "AVAILABLE",
        createdAt: occurredAt,
        createdBy: actor.id,
      }).run();
      tx.insert(inventoryReceiptLines).values({
        id: idFactory(),
        receiptId,
        lotId,
        quantity: payload.quantity,
        unitSnapshot: medication.canonicalUnit,
      }).run();
      tx.insert(inventoryStockMovements).values({
        id: idFactory(),
        clinicId: "clinic",
        lotId,
        movementType: "RECEIPT",
        quantityDelta: payload.quantity,
        sourceType: "RECEIPT",
        sourceId: receiptId,
        reason: payload.note,
        occurredAt,
        actorId: actor.id,
      }).run();
      return receiptFromTransaction(tx, receiptId, currentClinicDate);
    },

    getReceipt(id) {
      return receiptFromTransaction(input.database.db, id, clinicDate(clock()));
    },
  };
}
