import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  Actor,
  InventoryPickListDto,
  InventoryReservationAllocationDto,
  InventoryReservationDto,
  InventoryLotDto,
  InventoryLotBalanceDto,
  InventoryReceiptDto,
  InventorySummaryDto,
  MedicationDto,
  PatientDto,
  ReceiveInventoryPayload,
  SignedMedicationDecisionDto,
  VisitSummaryDto,
} from "../../../shared/contracts.js";
import { receiveInventoryPayloadSchema } from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import { createMedicationService, type MedicationService } from "../medication/service.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import { patients } from "../patient/schema.js";
import { appendAuditEvent, assertExpectedRevision, type AppDatabase, type AppTransaction, type AuditedTransaction } from "../platform/index.js";
import { staffAccounts } from "../platform/schema.js";
import { visits } from "../visit/schema.js";
import {
  inventoryLots,
  inventoryAdjustments,
  inventoryLotStatusEvents,
  inventoryReceiptLines,
  inventoryReceipts,
  inventoryReservationAllocations,
  inventoryReservations,
  inventoryStockMovements,
} from "./schema.js";

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
  getPickList(visitId: string): InventoryPickListDto;
  getMedicationLots(medicationId: string): InventoryLotBalanceDto[];
  adjustLot(
    tx: AuditedTransaction,
    actor: Actor,
    input: { lotId: string; expectedRevision: number; correctsMovementId: string; quantityDelta: number; reason: string },
  ): InventoryLotBalanceDto;
  changeLotStatus(
    tx: AuditedTransaction,
    actor: Actor,
    input: { lotId: string; expectedRevision: number; nextStatus: "AVAILABLE" | "QUARANTINED"; reason: string },
  ): InventoryLotBalanceDto;
  reserveForVisit(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    expectedVisitRevision: number,
    expectedDecisionVersion: number,
  ): InventoryPickListDto;
  releaseReservation(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    expectedVisitRevision: number,
    expectedReservationId: string,
    reason: string,
  ): InventoryPickListDto;
  releaseActiveReservation(
    tx: AppTransaction,
    actor: Actor,
    visitId: string,
    reason: string,
  ): InventoryReservationDto | null;
  consumeReservationForDispense(
    tx: AuditedTransaction,
    actor: Actor,
    input: {
      visitId: string;
      reservationId: string;
      dispenseId: string;
      decisionId: string;
      decisionVersion: number;
      labelVersionId: string;
      labelPrintEventId: string;
      releaseId: string;
      preparationId: string;
      previousStatus: string;
      nextStatus: string;
      lines: Array<{ id: string; reservationAllocationId: string; lotId: string; quantity: number; lotNumberSnapshot: string; unitSnapshot: string }>;
    },
  ): void;
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
  if (!row.internalBarcode) throw new Error("Active synthetic medication is missing an internal barcode");
  return {
    id: row.id,
    displayName: row.displayName,
    strengthText: row.strengthText,
    dosageFormText: row.dosageFormText,
    canonicalUnit: row.canonicalUnit,
    internalBarcode: row.internalBarcode,
    revision: row.revision,
  };
}

function inventoryStatus(onHand: number, available: number, hasSellableStock: boolean): InventorySummaryDto["status"] {
  if (available === 0) {
    if (onHand === 0) return "OUT";
    return hasSellableStock ? "RESERVED" : "EXPIRED";
  }
  if (available <= SYNTHETIC_PILOT_LOW_STOCK_THRESHOLD) return "LOW";
  return "OK";
}

interface LotBalance {
  lot: typeof inventoryLots.$inferSelect;
  onHand: number;
  reserved: number;
  available: number;
}

function readLotBalances(tx: InventoryTransaction): LotBalance[] {
  const lots = tx.select().from(inventoryLots).where(eq(inventoryLots.clinicId, "clinic")).all();
  const movementRows = tx.select({ lotId: inventoryStockMovements.lotId, quantity: inventoryStockMovements.quantityDelta })
    .from(inventoryStockMovements)
    .where(eq(inventoryStockMovements.clinicId, "clinic"))
    .all();
  const activeAllocationRows = tx.select({
    lotId: inventoryReservationAllocations.lotId,
    quantity: inventoryReservationAllocations.quantity,
  })
    .from(inventoryReservationAllocations)
    .innerJoin(inventoryReservations, eq(inventoryReservations.id, inventoryReservationAllocations.reservationId))
    .where(and(
      eq(inventoryReservations.clinicId, "clinic"),
      eq(inventoryReservations.status, "ACTIVE"),
    ))
    .all();
  const onHandByLot = new Map<string, number>();
  for (const row of movementRows) onHandByLot.set(row.lotId, (onHandByLot.get(row.lotId) ?? 0) + Number(row.quantity));
  const reservedByLot = new Map<string, number>();
  for (const row of activeAllocationRows) {
    reservedByLot.set(row.lotId, (reservedByLot.get(row.lotId) ?? 0) + Number(row.quantity));
  }
  return lots.map((lot) => {
    const onHand = onHandByLot.get(lot.id) ?? 0;
    const reserved = reservedByLot.get(lot.id) ?? 0;
    return { lot, onHand, reserved, available: Math.max(0, onHand - reserved) };
  });
}

function readInventory(tx: InventoryTransaction, currentClinicDate: string): InventorySummaryDto[] {
  const meds = tx.select().from(medications)
    .where(eq(medications.active, 1))
    .orderBy(asc(medications.displayName), asc(medications.id)).all();
  const balances = readLotBalances(tx);
  return meds.map((medication) => {
    const medicationLots = balances.filter((balance) => balance.lot.medicationId === medication.id);
    const onHandValue = medicationLots.reduce((sum, balance) => sum + balance.onHand, 0);
    const reservedValue = medicationLots.reduce((sum, balance) => sum + balance.reserved, 0);
    const sellableLots = medicationLots.filter((balance) => (
      balance.lot.status === "AVAILABLE" && balance.lot.expiryDate > currentClinicDate
    ));
    const availableValue = sellableLots.reduce((sum, balance) => sum + balance.available, 0);
    return {
      medication: toMedicationDto(medication),
      onHand: onHandValue,
      reserved: reservedValue,
      available: availableValue,
      lotCount: medicationLots.length,
      nearestExpiry: sellableLots.map((balance) => balance.lot.expiryDate).sort()[0] ?? null,
      status: inventoryStatus(onHandValue, availableValue, sellableLots.some((balance) => balance.onHand > 0)),
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
    revision: input.lot.revision,
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

function toLotBalanceDto(
  tx: InventoryTransaction,
  balance: LotBalance,
): InventoryLotBalanceDto {
  const createdBy = tx.select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
    .from(staffAccounts).where(eq(staffAccounts.id, balance.lot.createdBy)).get();
  if (!createdBy) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบผู้สร้างล็อตยา" });
  const latestMovement = tx.select({ id: inventoryStockMovements.id }).from(inventoryStockMovements)
    .where(eq(inventoryStockMovements.lotId, balance.lot.id))
    .orderBy(desc(inventoryStockMovements.occurredAt), desc(inventoryStockMovements.id)).get();
  return { ...toLotDto({ lot: balance.lot, createdBy }), onHand: balance.onHand, reserved: balance.reserved, available: balance.available, latestMovementId: latestMovement?.id ?? null };
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

function toPatientDto(row: typeof patients.$inferSelect): PatientDto {
  return {
    id: row.id,
    hn: row.hn,
    displayName: row.displayName,
    phone: row.phone,
    birthDate: row.birthDate,
    sex: row.sex,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

function toVisitSummary(row: typeof visits.$inferSelect): VisitSummaryDto {
  return {
    id: row.id,
    status: row.status as VisitSummaryDto["status"],
    revision: row.revision,
    arrivedAt: row.arrivedAt,
    startedAt: row.startedAt,
  };
}

interface SignedOrderRead {
  row: typeof medicationDecisions.$inferSelect;
  dto: SignedMedicationDecisionDto;
  items: (typeof medicationOrderItems.$inferSelect)[];
}

function readSignedDecision(
  tx: InventoryTransaction,
  visitId: string,
  expectedVersion?: number,
): SignedOrderRead {
  const latest = tx.select().from(medicationDecisions)
    .where(eq(medicationDecisions.visitId, visitId))
    .orderBy(desc(medicationDecisions.version), desc(medicationDecisions.id)).get();
  if (!latest) throw new ApiError({ code: "NOT_FOUND", messageTh: "Visit นี้ยังไม่มีคำสั่งยาที่ลงนามแล้ว" });
  if (expectedVersion !== undefined) {
    if (latest.version !== expectedVersion) {
      throw new ApiError({
        code: "REVISION_CONFLICT",
        messageTh: "คำสั่งยามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด",
        currentRevisions: { medicationDecision: latest.version },
      });
    }
  }
  const items = tx.select().from(medicationOrderItems)
    .where(eq(medicationOrderItems.medicationDecisionId, latest.id))
    .orderBy(asc(medicationOrderItems.position), asc(medicationOrderItems.id)).all();
  const base = {
    id: latest.id,
    visitId: latest.visitId,
    version: latest.version,
    revisionReason: latest.revisionReason,
    supersedesId: latest.supersedesId,
    signedBy: { id: latest.signedBy, displayName: latest.signedByDisplayName },
    signedAt: latest.signedAt,
    contentHash: latest.contentHash,
  };
  const dto: SignedMedicationDecisionDto = latest.kind === "ORDER"
    ? {
      ...base,
      kind: "ORDER",
      noMedicationReason: null,
      items: items.map((item) => ({
        id: item.medicationId,
        orderItemId: item.id,
        displayName: item.displayNameSnapshot,
        strengthText: item.strengthSnapshot,
        dosageFormText: item.dosageFormSnapshot,
        canonicalUnit: item.unitSnapshot,
        revision: item.medicationRevision,
        quantity: item.quantity,
        directionsTh: item.directionsTh,
      })),
    }
    : {
      ...base,
      kind: "NO_MEDICATION",
      noMedicationReason: latest.noMedicationReason ?? "",
      items: [],
    };
  return { row: latest, dto, items };
}

function readReservation(
  tx: InventoryTransaction,
  row: typeof inventoryReservations.$inferSelect,
): InventoryReservationDto {
  const createdBy = tx.select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
    .from(staffAccounts)
    .where(eq(staffAccounts.id, row.createdBy)).get();
  if (!createdBy) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบผู้สร้างรายการจอง" });
  const releasedBy = row.releasedBy
    ? tx.select({ id: staffAccounts.id, displayName: staffAccounts.displayName })
      .from(staffAccounts)
      .where(eq(staffAccounts.id, row.releasedBy)).get() ?? null
    : null;
  if (row.releasedBy && !releasedBy) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่พบผู้ยกเลิกรายการจอง" });
  const allocations: InventoryReservationAllocationDto[] = tx.select()
    .from(inventoryReservationAllocations)
    .where(eq(inventoryReservationAllocations.reservationId, row.id))
    .orderBy(asc(inventoryReservationAllocations.position), asc(inventoryReservationAllocations.id))
    .all()
    .map((allocation) => ({
      id: allocation.id,
      reservationId: allocation.reservationId,
      medicationOrderItemId: allocation.medicationOrderItemId,
      medicationId: allocation.medicationId,
      lotId: allocation.lotId,
      position: allocation.position,
      quantity: allocation.quantity,
      lotNumberSnapshot: allocation.lotNumberSnapshot,
      expiryDateSnapshot: allocation.expiryDateSnapshot,
      unitSnapshot: allocation.unitSnapshot,
      allocatedAt: allocation.allocatedAt,
    }));
  const common = {
    id: row.id,
    clinicId: row.clinicId,
    visitId: row.visitId,
    medicationDecisionId: row.medicationDecisionId,
    medicationDecisionVersion: row.medicationDecisionVersion,
    createdAt: row.createdAt,
    createdBy,
    allocations,
  };
  if (row.status === "RELEASED") {
    if (!row.releasedAt || !releasedBy || !row.releaseReason?.trim()) {
      throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ข้อมูลยกเลิกรายการจองไม่ครบถ้วน" });
    }
    return {
      ...common,
      status: "RELEASED" as const,
      releasedAt: row.releasedAt,
      releasedBy,
      releaseReason: row.releaseReason,
    };
  }
  return {
    ...common,
    status: row.status as "ACTIVE" | "CONSUMED",
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
  };
}

function readPickList(
  tx: InventoryTransaction,
  visitId: string,
  currentClinicDate: string,
): InventoryPickListDto {
  const joined = tx.select({ visit: visits, patient: patients })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic")))
    .get();
  if (!joined) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
  const signed = readSignedDecision(tx, visitId);
  const reservationRows = tx.select().from(inventoryReservations)
    .where(and(
      eq(inventoryReservations.clinicId, "clinic"),
      eq(inventoryReservations.visitId, visitId),
      eq(inventoryReservations.medicationDecisionId, signed.row.id),
      eq(inventoryReservations.medicationDecisionVersion, signed.row.version),
    ))
    .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id)).all();
  const reservationRow = reservationRows.find((row) => row.status === "ACTIVE") ?? reservationRows[0];
  return {
    visit: toVisitSummary(joined.visit),
    patient: toPatientDto(joined.patient),
    medicationDecision: signed.dto,
    reservation: reservationRow ? readReservation(tx, reservationRow) : null,
    inventory: readInventory(tx, currentClinicDate),
  };
}

function reservationError(messageTh: string): ApiError {
  return new ApiError({ code: "INVALID_STATE", messageTh });
}

function assertReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > 500) {
    throw new ApiError({
      code: "VALIDATION_FAILED",
      messageTh: "เหตุผลต้องมี 1–500 ตัวอักษร",
      fieldErrors: { reason: "เหตุผลต้องมี 1–500 ตัวอักษร" },
    });
  }
  return trimmed;
}

export function createInventoryService(input: InventoryServiceOptions): InventoryService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  let generatedInventoryId = 0;
  const nextInventoryId = () => `${idFactory()}:inventory:${++generatedInventoryId}`;
  const medicationService = input.medicationService ?? createMedicationService({
    database: input.database,
    clock,
    idFactory,
  });

  return {
    getInventory() {
      return readInventory(input.database.db, clinicDate(clock()));
    },

    getMedicationLots(medicationId) {
      return readLotBalances(input.database.db)
        .filter((balance) => balance.lot.medicationId === medicationId)
        .sort((left, right) => left.lot.expiryDate.localeCompare(right.lot.expiryDate) || left.lot.id.localeCompare(right.lot.id))
        .map((balance) => toLotBalanceDto(input.database.db, balance));
    },

    adjustLot(tx, actor, command) {
      const reason = assertReason(command.reason);
      const lot = tx.select().from(inventoryLots).where(and(
        eq(inventoryLots.id, command.lotId), eq(inventoryLots.clinicId, "clinic"),
      )).get();
      if (!lot) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบล็อตยา" });
      assertExpectedRevision(lot.revision, command.expectedRevision, "lot");
      const corrected = tx.select().from(inventoryStockMovements).where(and(
        eq(inventoryStockMovements.id, command.correctsMovementId),
        eq(inventoryStockMovements.lotId, lot.id),
        eq(inventoryStockMovements.clinicId, "clinic"),
      )).get();
      if (!corrected) throw new ApiError({ code: "VALIDATION_FAILED", messageTh: "รายการอ้างอิงไม่อยู่ในล็อตยานี้", fieldErrors: { "payload.correctsMovementId": "ต้องอ้างอิงการเคลื่อนไหวของล็อตเดียวกัน" } });
      const balance = readLotBalances(tx).find((candidate) => candidate.lot.id === lot.id);
      if (!balance) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่สามารถคำนวณยอดล็อตยา" });
      if (balance.onHand + command.quantityDelta < balance.reserved) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "ยอดหลังปรับต้องไม่ต่ำกว่ายอดที่จองไว้" });
      }
      const occurredAt = clock().toISOString();
      const adjustmentId = nextInventoryId();
      const movementId = nextInventoryId();
      tx.insert(inventoryAdjustments).values({
        id: adjustmentId, clinicId: "clinic", lotId: lot.id, correctsMovementId: corrected.id,
        quantityDelta: command.quantityDelta, reason, occurredAt, actorId: actor.id,
      }).run();
      tx.insert(inventoryStockMovements).values({
        id: movementId, clinicId: "clinic", lotId: lot.id, movementType: "ADJUSTMENT", quantityDelta: command.quantityDelta,
        sourceType: "ADJUSTMENT", sourceId: adjustmentId, reason, occurredAt, actorId: actor.id,
      }).run();
      const changed = tx.update(inventoryLots).set({ revision: lot.revision + 1 }).where(and(
        eq(inventoryLots.id, lot.id), eq(inventoryLots.revision, command.expectedRevision),
      )).run();
      if (changed.changes !== 1) throw new ApiError({ code: "REVISION_CONFLICT", messageTh: "ล็อตยามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", currentRevisions: { lot: lot.revision } });
      const updated = readLotBalances(tx).find((candidate) => candidate.lot.id === lot.id);
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่สามารถอ่านล็อตยาที่ปรับแล้ว" });
      return toLotBalanceDto(tx, updated);
    },

    changeLotStatus(tx, actor, command) {
      const reason = assertReason(command.reason);
      const lot = tx.select().from(inventoryLots).where(and(
        eq(inventoryLots.id, command.lotId), eq(inventoryLots.clinicId, "clinic"),
      )).get();
      if (!lot) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบล็อตยา" });
      assertExpectedRevision(lot.revision, command.expectedRevision, "lot");
      if (lot.status === command.nextStatus) throw new ApiError({ code: "INVALID_STATE", messageTh: "ล็อตยาอยู่ในสถานะนี้แล้ว" });
      const balance = readLotBalances(tx).find((candidate) => candidate.lot.id === lot.id);
      if (!balance) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่สามารถคำนวณยอดล็อตยา" });
      if (command.nextStatus === "QUARANTINED" && balance.reserved > 0) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "ไม่สามารถกักกันล็อตที่มีรายการจองกำลังใช้งาน" });
      }
      if (command.nextStatus === "AVAILABLE" && lot.expiryDate <= clinicDate(clock())) {
        throw new ApiError({ code: "INVALID_STATE", messageTh: "ไม่สามารถปลดกักกันล็อตยาที่หมดอายุแล้ว" });
      }
      const occurredAt = clock().toISOString();
      tx.insert(inventoryLotStatusEvents).values({
        id: nextInventoryId(), clinicId: "clinic", lotId: lot.id, previousStatus: lot.status,
        nextStatus: command.nextStatus, reason, occurredAt, actorId: actor.id,
      }).run();
      const changed = tx.update(inventoryLots).set({ status: command.nextStatus, revision: lot.revision + 1 }).where(and(
        eq(inventoryLots.id, lot.id), eq(inventoryLots.revision, command.expectedRevision), eq(inventoryLots.status, lot.status),
      )).run();
      if (changed.changes !== 1) throw new ApiError({ code: "REVISION_CONFLICT", messageTh: "ล็อตยามีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุด", currentRevisions: { lot: lot.revision } });
      const updated = readLotBalances(tx).find((candidate) => candidate.lot.id === lot.id);
      if (!updated) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ไม่สามารถอ่านล็อตยาที่ปรับแล้ว" });
      return toLotBalanceDto(tx, updated);
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
        revision: 1,
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

    getPickList(visitId) {
      return readPickList(input.database.db, visitId, clinicDate(clock()));
    },

    reserveForVisit(tx, actor, visitId, expectedVisitRevision, expectedDecisionVersion) {
      const visit = tx.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic"))).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, expectedVisitRevision, "visit");
      const signed = readSignedDecision(tx, visitId, expectedDecisionVersion);
      if (signed.row.kind !== "ORDER" || signed.items.length === 0) {
        throw reservationError("คำสั่งยานี้ไม่ใช่ ORDER ที่สามารถจองยาได้");
      }

      const activeForVisit = tx.select().from(inventoryReservations)
        .where(and(
          eq(inventoryReservations.clinicId, "clinic"),
          eq(inventoryReservations.visitId, visitId),
          eq(inventoryReservations.status, "ACTIVE"),
        ))
        .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id)).get();
      if (activeForVisit) {
        if (
          activeForVisit.medicationDecisionId === signed.row.id &&
          activeForVisit.medicationDecisionVersion === signed.row.version &&
          visit.status === "PREPARING"
        ) {
          return readPickList(tx, visitId, clinicDate(clock()));
        }
        throw reservationError("Visit นี้มีรายการจองที่กำลังใช้งานอยู่");
      }
      if (visit.status !== "AWAITING_PREPARATION") {
        throw reservationError("สถานะ Visit ไม่อนุญาตให้เริ่มจองยา");
      }

      const balances = readLotBalances(tx);
      const currentClinicDate = clinicDate(clock());
      const candidatesByMedication = new Map<string, LotBalance[]>();
      for (const balance of balances) {
        if (balance.lot.status !== "AVAILABLE" || balance.lot.expiryDate <= currentClinicDate || balance.available <= 0) continue;
        const candidates = candidatesByMedication.get(balance.lot.medicationId) ?? [];
        candidates.push({ ...balance });
        candidatesByMedication.set(balance.lot.medicationId, candidates);
      }
      for (const candidates of candidatesByMedication.values()) {
        candidates.sort((left, right) => (
          left.lot.expiryDate.localeCompare(right.lot.expiryDate) || left.lot.id.localeCompare(right.lot.id)
        ));
      }

      const allocations: Array<{
        orderItem: typeof medicationOrderItems.$inferSelect;
        lot: typeof inventoryLots.$inferSelect;
        quantity: number;
      }> = [];
      for (const orderItem of signed.items) {
        let remaining = orderItem.quantity;
        const candidates = candidatesByMedication.get(orderItem.medicationId) ?? [];
        for (const candidate of candidates) {
          if (remaining <= 0) break;
          const quantity = Math.min(remaining, candidate.available);
          if (quantity <= 0) continue;
          allocations.push({ orderItem, lot: candidate.lot, quantity });
          candidate.available -= quantity;
          remaining -= quantity;
        }
        if (remaining > 0) {
          throw reservationError(`สต็อกยา ${orderItem.displayNameSnapshot} ไม่เพียงพอสำหรับการจอง`);
        }
      }

      const now = clock().toISOString();
      const reservationCandidate = idFactory();
      const reservationId = tx.select({ id: inventoryReservations.id }).from(inventoryReservations)
        .where(eq(inventoryReservations.id, reservationCandidate)).get() ? nextInventoryId() : reservationCandidate;
      tx.insert(inventoryReservations).values({
        id: reservationId,
        clinicId: "clinic",
        visitId,
        medicationDecisionId: signed.row.id,
        medicationDecisionVersion: signed.row.version,
        status: "ACTIVE",
        createdAt: now,
        createdBy: actor.id,
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
      }).run();
      tx.insert(inventoryReservationAllocations).values(allocations.map((allocation, position) => {
        const candidate = position === 0 ? idFactory() : nextInventoryId();
        const allocationId = tx.select({ id: inventoryReservationAllocations.id }).from(inventoryReservationAllocations)
          .where(eq(inventoryReservationAllocations.id, candidate)).get() ? nextInventoryId() : candidate;
        return {
        id: allocationId,
        reservationId,
        medicationOrderItemId: allocation.orderItem.id,
        medicationId: allocation.orderItem.medicationId,
        lotId: allocation.lot.id,
        position,
        quantity: allocation.quantity,
        lotNumberSnapshot: allocation.lot.lotNumber,
        expiryDateSnapshot: allocation.lot.expiryDate,
        unitSnapshot: allocation.orderItem.unitSnapshot,
        allocatedAt: now,
      }; })).run();
      for (const lotId of new Set(allocations.map((allocation) => allocation.lot.id))) {
        const changedLot = tx.update(inventoryLots).set({ revision: sql`${inventoryLots.revision} + 1` })
          .where(eq(inventoryLots.id, lotId)).run();
        if (changedLot.changes !== 1) throw reservationError("ล็อตยาถูกเปลี่ยนแปลงแล้ว");
      }
      const changed = tx.update(visits)
        .set({ status: "PREPARING", revision: visit.revision + 1 })
        .where(and(
          eq(visits.id, visitId),
          eq(visits.clinicId, "clinic"),
          eq(visits.status, "AWAITING_PREPARATION"),
          eq(visits.revision, expectedVisitRevision),
        )).run();
      if (changed.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visitId)).get();
        if (!latest) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
        assertExpectedRevision(latest.revision, expectedVisitRevision, "visit");
        throw reservationError("สถานะ Visit ไม่อนุญาตให้เริ่มจองยา");
      }
      return readPickList(tx, visitId, currentClinicDate);
    },

    releaseReservation(tx, actor, visitId, expectedVisitRevision, expectedReservationId, reason) {
      const visit = tx.select().from(visits)
        .where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic"))).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, expectedVisitRevision, "visit");
      if (visit.status !== "PREPARING") throw reservationError("สถานะ Visit ไม่อนุญาตให้ยกเลิกรายการจอง");
      const reservation = tx.select().from(inventoryReservations)
        .where(and(
          eq(inventoryReservations.id, expectedReservationId),
          eq(inventoryReservations.clinicId, "clinic"),
          eq(inventoryReservations.visitId, visitId),
        )).get();
      if (!reservation) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบรายการจองยา" });
      if (reservation.status !== "ACTIVE") {
        if (reservation.status === "RELEASED") return readPickList(tx, visitId, clinicDate(clock()));
        throw reservationError("รายการจองยานี้ไม่อยู่ในสถานะที่ยกเลิกได้");
      }
      const releaseReason = assertReason(reason);
      const releasedAt = clock().toISOString();
      const changedReservation = tx.update(inventoryReservations)
        .set({ status: "RELEASED", releasedAt, releasedBy: actor.id, releaseReason })
        .where(and(eq(inventoryReservations.id, reservation.id), eq(inventoryReservations.status, "ACTIVE"))).run();
      if (changedReservation.changes !== 1) throw reservationError("รายการจองยาถูกเปลี่ยนแปลงแล้ว");
      const allocationRows = tx.select({ lotId: inventoryReservationAllocations.lotId })
        .from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id)).all();
      for (const lotId of new Set(allocationRows.map((allocation) => allocation.lotId))) {
        const changedLot = tx.update(inventoryLots).set({ revision: sql`${inventoryLots.revision} + 1` })
          .where(eq(inventoryLots.id, lotId)).run();
        if (changedLot.changes !== 1) throw reservationError("ล็อตยาถูกเปลี่ยนแปลงแล้ว");
      }
      const changedVisit = tx.update(visits)
        .set({ status: "AWAITING_PREPARATION", revision: visit.revision + 1 })
        .where(and(
          eq(visits.id, visitId),
          eq(visits.clinicId, "clinic"),
          eq(visits.status, "PREPARING"),
          eq(visits.revision, expectedVisitRevision),
        )).run();
      if (changedVisit.changes !== 1) {
        const latest = tx.select().from(visits).where(eq(visits.id, visitId)).get();
        if (!latest) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
        assertExpectedRevision(latest.revision, expectedVisitRevision, "visit");
        throw reservationError("สถานะ Visit ไม่อนุญาตให้ยกเลิกรายการจอง");
      }
      return readPickList(tx, visitId, clinicDate(clock()));
    },

    releaseActiveReservation(tx, actor, visitId, reason) {
      const reservation = tx.select().from(inventoryReservations)
        .where(and(
          eq(inventoryReservations.clinicId, "clinic"),
          eq(inventoryReservations.visitId, visitId),
          eq(inventoryReservations.status, "ACTIVE"),
        ))
        .orderBy(desc(inventoryReservations.createdAt), desc(inventoryReservations.id)).get();
      if (!reservation) return null;
      const releaseReason = assertReason(reason);
      const releasedAt = clock().toISOString();
      const changed = tx.update(inventoryReservations)
        .set({ status: "RELEASED", releasedAt, releasedBy: actor.id, releaseReason })
        .where(and(eq(inventoryReservations.id, reservation.id), eq(inventoryReservations.status, "ACTIVE"))).run();
      if (changed.changes !== 1) throw reservationError("รายการจองยาถูกเปลี่ยนแปลงแล้ว");
      const allocationRows = tx.select({ lotId: inventoryReservationAllocations.lotId })
        .from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id)).all();
      for (const lotId of new Set(allocationRows.map((allocation) => allocation.lotId))) {
        const changedLot = tx.update(inventoryLots).set({ revision: sql`${inventoryLots.revision} + 1` })
          .where(eq(inventoryLots.id, lotId)).run();
        if (changedLot.changes !== 1) throw reservationError("ล็อตยาถูกเปลี่ยนแปลงแล้ว");
      }
      const released = tx.select().from(inventoryReservations).where(eq(inventoryReservations.id, reservation.id)).get();
      if (!released) throw new ApiError({ code: "INTERNAL_ERROR", messageTh: "ยกเลิกรายการจองไม่สำเร็จ" });
      return readReservation(tx, released);
    },

    consumeReservationForDispense(tx, actor, input) {
      const reservation = tx.select().from(inventoryReservations).where(and(
        eq(inventoryReservations.id, input.reservationId),
        eq(inventoryReservations.clinicId, "clinic"),
        eq(inventoryReservations.visitId, input.visitId),
        eq(inventoryReservations.status, "ACTIVE"),
      )).get();
      if (!reservation) throw reservationError("รายการจองยานี้ไม่พร้อมส่งมอบ");
      const allocations = tx.select().from(inventoryReservationAllocations)
        .where(eq(inventoryReservationAllocations.reservationId, reservation.id))
        .orderBy(asc(inventoryReservationAllocations.position), asc(inventoryReservationAllocations.id)).all();
      if (allocations.length === 0 || allocations.length !== input.lines.length) {
        throw reservationError("รายการจองยาไม่ครบสำหรับการส่งมอบ");
      }
      const linesById = new Map(input.lines.map((line) => [line.id, line]));
      const linesByAllocationId = new Map(input.lines.map((line) => [line.reservationAllocationId, line]));
      const allocationTotals = new Map<string, number>();
      for (const allocation of allocations) allocationTotals.set(allocation.lotId, (allocationTotals.get(allocation.lotId) ?? 0) + allocation.quantity);
      const lineTotals = new Map<string, number>();
      for (const line of input.lines) lineTotals.set(line.lotId, (lineTotals.get(line.lotId) ?? 0) + line.quantity);
      if ([...allocationTotals.entries()].some(([lotId, quantity]) => lineTotals.get(lotId) !== quantity)
        || linesById.size !== input.lines.length
        || linesByAllocationId.size !== input.lines.length
        || allocations.some((allocation) => {
          const line = linesByAllocationId.get(allocation.id);
          return !line || line.lotId !== allocation.lotId || line.quantity !== allocation.quantity || line.lotNumberSnapshot !== allocation.lotNumberSnapshot || line.unitSnapshot !== allocation.unitSnapshot;
        })) {
        throw reservationError("รายการส่งมอบไม่ตรงกับรายการจองยา");
      }
      const date = clinicDate(clock());
      const balances = readLotBalances(tx);
      for (const [lotId, quantity] of allocationTotals) {
        const balance = balances.find((entry) => entry.lot.id === lotId);
        if (!balance || balance.lot.status !== "AVAILABLE" || balance.lot.expiryDate <= date || balance.onHand < quantity || balance.onHand < balance.reserved) {
          throw reservationError("ล็อตยาสำหรับส่งมอบไม่พร้อมใช้งาน");
        }
      }
      const now = clock().toISOString();
      const movements = input.lines.map((line) => ({
        id: nextInventoryId(), clinicId: "clinic", lotId: line.lotId, movementType: "DISPENSE" as const,
        quantityDelta: -line.quantity, sourceType: "DISPENSE" as const, sourceId: line.id,
        reason: "", occurredAt: now, actorId: actor.id,
      }));
      tx.insert(inventoryStockMovements).values(movements).run();
      for (const [index, movement] of movements.entries()) {
        const line = input.lines[index];
        appendAuditEvent({ tx, actor, id: `audit:inventory.stock-dispensed:${movement.id}`, action: "inventory.stock-dispensed", entityType: "inventory_stock_movement", entityId: movement.id, entityRevision: 1, reason: null, occurredAt: now, metadata: { visitId: input.visitId, dispenseId: input.dispenseId, dispenseLineId: line.id, allocationId: line.reservationAllocationId, decisionId: input.decisionId, decisionVersion: input.decisionVersion, labelVersionId: input.labelVersionId, labelPrintEventId: input.labelPrintEventId, releaseId: input.releaseId, preparationId: input.preparationId, reservationId: input.reservationId, previousStatus: input.previousStatus, nextStatus: input.nextStatus, lotId: line.lotId, lotNumber: line.lotNumberSnapshot, lotNumberSnapshot: line.lotNumberSnapshot, quantity: line.quantity, unit: line.unitSnapshot, quantityDelta: movement.quantityDelta, allocations: [{ allocationId: line.reservationAllocationId, lotId: line.lotId, lotNumber: line.lotNumberSnapshot, lotNumberSnapshot: line.lotNumberSnapshot, quantity: line.quantity, unit: line.unitSnapshot }] } });
      }
      for (const lotId of allocationTotals.keys()) {
        const changedLot = tx.update(inventoryLots).set({ revision: sql`${inventoryLots.revision} + 1` }).where(eq(inventoryLots.id, lotId)).run();
        if (changedLot.changes !== 1) throw reservationError("ล็อตยาถูกเปลี่ยนแปลงแล้ว");
      }
      const changed = tx.update(inventoryReservations).set({
        status: "CONSUMED", consumedAt: now, consumedBy: actor.id, consumedDispenseId: input.dispenseId,
      }).where(and(eq(inventoryReservations.id, reservation.id), eq(inventoryReservations.status, "ACTIVE"))).run();
      if (changed.changes !== 1) throw reservationError("รายการจองยาถูกเปลี่ยนแปลงแล้ว");
    },
  };
}
