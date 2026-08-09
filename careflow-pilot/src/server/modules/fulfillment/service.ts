import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type {
  Actor, FulfillmentConfirmationPayload, FulfillmentCurrentLabelDto, FulfillmentHandoffBody, FulfillmentPickListDto,
  FulfillmentRejectBody, FulfillmentReleaseBody,
} from "../../../shared/contracts.js";
import type { DatabaseHandle } from "../../db/client.js";
import { ApiError } from "../../errors.js";
import type { InventoryService } from "../inventory/service.js";
import { inventoryLots, inventoryReservationAllocations, inventoryReservations, inventoryStockMovements } from "../inventory/schema.js";
import { medicationDecisions, medicationOrderItems, medications } from "../medication/schema.js";
import { patients } from "../patient/schema.js";
import { appendAuditEvent, assertExpectedRevision, type AppDatabase, type AppTransaction, type AuditedTransaction } from "../platform/index.js";
import { clinicConfig } from "../platform/schema.js";
import { visits } from "../visit/schema.js";
import {
  fulfillmentArtifactInvalidations, fulfillmentLabelItems, fulfillmentLabelPrintEvents, fulfillmentLabelVersions,
  fulfillmentPreparationConfirmations, fulfillmentPreparations, fulfillmentReleases, fulfillmentRejections,
  fulfillmentDispenses, fulfillmentDispenseLines,
} from "./schema.js";

type Reader = AppDatabase | AppTransaction;

export interface FulfillmentService {
  getPickList(visitId: string): FulfillmentPickListDto;
  getCurrentLabel(visitId: string): FulfillmentCurrentLabelDto;
  createLabelForSignedOrder(tx: AuditedTransaction, actor: Actor, visitId: string, decisionId: string): FulfillmentCurrentLabelDto;
  startPreparation(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, decisionVersion: number, labelVersionId: string): FulfillmentPickListDto;
  recordPrintRequest(tx: AuditedTransaction, actor: Actor, visitId: string, labelVersionId: string, visitRevision: number, decisionVersion: number, rendererVersion: string): FulfillmentPickListDto;
  confirmAllocation(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, preparationRevision: number, payload: FulfillmentConfirmationPayload): FulfillmentPickListDto;
  completePreparation(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, preparationRevision: number, preparationId: string, reservationId: string): FulfillmentPickListDto;
  abandonPreparation(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, preparationRevision: number, preparationId: string, reservationId: string, reason: string): FulfillmentPickListDto;
  releaseForVisit(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, preparationRevision: number, payload: FulfillmentReleaseBody["payload"]): FulfillmentPickListDto;
  rejectForVisit(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, preparationRevision: number, payload: FulfillmentRejectBody["payload"]): FulfillmentPickListDto;
  handoffForVisit(tx: AuditedTransaction, actor: Actor, visitId: string, visitRevision: number, payload: FulfillmentHandoffBody["payload"]): FulfillmentPickListDto;
  invalidateCurrentArtifacts(tx: AuditedTransaction, actor: Actor, visitId: string, trigger: "ALLERGY_REVISION" | "ORDER_REVISION", reason: string, replacementDecisionId?: string): void;
  readHandoffChain(visitId: string): FulfillmentPickListDto;
}

export interface FulfillmentServiceOptions {
  database: DatabaseHandle;
  inventory: InventoryService;
  clock?: () => Date;
  idFactory?: () => string;
}

function invalidState(messageTh: string): never { throw new ApiError({ code: "INVALID_STATE", messageTh }); }
function artifactStale(messageTh: string): never { throw new ApiError({ code: "ARTIFACT_STALE", messageTh }); }
function preparationIncomplete(messageTh: string): never { throw new ApiError({ code: "PREPARATION_INCOMPLETE", messageTh }); }
function reservationNotSellable(messageTh: string): never { throw new ApiError({ code: "RESERVATION_NOT_SELLABLE", messageTh }); }
function clinicDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year"); const month = part("month"); const day = part("day");
  if (!year || !month || !day) throw new Error("Clinic date formatting failed");
  return `${year}-${month}-${day}`;
}
function activeInvalidation(tx: Reader, type: "LABEL" | "PREPARATION" | "RELEASE", id: string): boolean {
  return !!tx.select({ id: fulfillmentArtifactInvalidations.id }).from(fulfillmentArtifactInvalidations)
    .where(and(eq(fulfillmentArtifactInvalidations.artifactType, type), eq(fulfillmentArtifactInvalidations.artifactId, id))).get();
}

export function createFulfillmentService(input: FulfillmentServiceOptions): FulfillmentService {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;
  let generatedId = 0;
  const nextId = () => `${idFactory()}:fulfillment:${++generatedId}`;

  const labelFor = (tx: Reader, visitId: string): FulfillmentCurrentLabelDto => {
    const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId))
      .orderBy(desc(medicationDecisions.version)).get();
    if (!decision || decision.kind !== "ORDER") return null;
    const row = tx.select().from(fulfillmentLabelVersions)
      .where(and(eq(fulfillmentLabelVersions.medicationDecisionId, decision.id), eq(fulfillmentLabelVersions.visitId, visitId))).get();
    if (!row || activeInvalidation(tx, "LABEL", row.id)) return null;
    const items = tx.select().from(fulfillmentLabelItems).where(eq(fulfillmentLabelItems.labelVersionId, row.id))
      .orderBy(asc(fulfillmentLabelItems.position)).all().map((item) => ({
        orderItemId: item.medicationOrderItemId,
        medicationId: item.medicationId,
        medicationRevision: item.medicationRevision,
        displayNameSnapshot: item.displayNameSnapshot,
        strengthSnapshot: item.strengthSnapshot,
        dosageFormSnapshot: item.dosageFormSnapshot,
        quantity: item.quantity,
        unitSnapshot: item.unitSnapshot,
        directionsThSnapshot: item.directionsThSnapshot,
        internalBarcode: item.internalBarcodeSnapshot,
      }));
    return items.length ? {
      id: row.id,
      medicationDecisionId: row.medicationDecisionId,
      medicationDecisionVersion: row.medicationDecisionVersion,
      version: row.version,
      clinicNameSnapshot: row.clinicNameSnapshot,
      patientHnSnapshot: row.patientHnSnapshot,
      patientDisplayNameSnapshot: row.patientDisplayNameSnapshot,
      items,
    } : null;
  };
  const assertReservationSellable = (tx: AuditedTransaction, reservationId: string): void => {
    const allocations = tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservationId)).all();
    if (!allocations.length) reservationNotSellable("รายการจองยาไม่มี allocation");
    const activeIds = new Set(tx.select({ id: inventoryReservations.id }).from(inventoryReservations).where(eq(inventoryReservations.status, "ACTIVE")).all().map((row) => row.id));
    const activeAllocations = tx.select().from(inventoryReservationAllocations).all().filter((row) => activeIds.has(row.reservationId));
    const movements = tx.select().from(inventoryStockMovements).all(); const today = clinicDate(clock());
    for (const allocation of allocations) {
      const lot = tx.select().from(inventoryLots).where(eq(inventoryLots.id, allocation.lotId)).get();
      const onHand = movements.filter((movement) => movement.lotId === allocation.lotId).reduce((sum, movement) => sum + movement.quantityDelta, 0);
      const reserved = activeAllocations.filter((row) => row.lotId === allocation.lotId).reduce((sum, row) => sum + row.quantity, 0);
      if (!lot || lot.medicationId !== allocation.medicationId || lot.status !== "AVAILABLE" || lot.expiryDate <= today || onHand < reserved || onHand < allocation.quantity) {
        reservationNotSellable("ล็อตยาสำหรับรายการจองไม่พร้อมใช้งาน");
      }
    }
  };
  const read = (tx: Reader, visitId: string): FulfillmentPickListDto => {
    const visit = tx.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.clinicId, "clinic"))).get();
    if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
    const patient = tx.select().from(patients).where(eq(patients.id, visit.patientId)).get();
    if (!patient) throw new Error("Visit patient missing");
    const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId))
      .orderBy(desc(medicationDecisions.version)).get();
    const medicationDecision = !decision ? null : decision.kind === "ORDER"
      ? { id: decision.id, version: decision.version, kind: "ORDER" as const }
      : { id: decision.id, version: decision.version, kind: "NO_MEDICATION" as const, noMedicationReason: decision.noMedicationReason ?? "" };
    const label = labelFor(tx, visitId);
    const reservation = decision ? tx.select().from(inventoryReservations).where(and(
      eq(inventoryReservations.visitId, visitId), eq(inventoryReservations.medicationDecisionId, decision.id),
    )).orderBy(desc(inventoryReservations.createdAt)).all().find((row) => row.status !== "RELEASED") : undefined;
    const allocations = reservation ? tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id))
      .orderBy(asc(inventoryReservationAllocations.position)).all().map((row) => {
        const item = tx.select().from(medicationOrderItems).where(eq(medicationOrderItems.id, row.medicationOrderItemId)).get();
        const labelItem = item && label ? tx.select().from(fulfillmentLabelItems).where(and(eq(fulfillmentLabelItems.labelVersionId, label.id), eq(fulfillmentLabelItems.medicationOrderItemId, item.id))).get() : undefined;
        if (!item || !labelItem) throw new Error("Allocation snapshot source missing");
        return { id: row.id, orderItemId: row.medicationOrderItemId, medicationId: row.medicationId, displayNameSnapshot: item.displayNameSnapshot, strengthSnapshot: item.strengthSnapshot, dosageFormSnapshot: item.dosageFormSnapshot, internalBarcode: labelItem.internalBarcodeSnapshot, lotId: row.lotId, lotNumberSnapshot: row.lotNumberSnapshot, expiryDateSnapshot: row.expiryDateSnapshot, unitSnapshot: row.unitSnapshot, quantity: row.quantity };
      }) : [];
    const preparationRow = reservation ? tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.reservationId, reservation.id)).get() : undefined;
    const preparation = preparationRow && !activeInvalidation(tx, "PREPARATION", preparationRow.id) ? {
      id: preparationRow.id, revision: preparationRow.revision, status: preparationRow.status,
      minimumPrintSequence: preparationRow.minimumPrintSequence,
      latestPrintEventId: tx.select().from(fulfillmentLabelPrintEvents).where(eq(fulfillmentLabelPrintEvents.labelVersionId, preparationRow.labelVersionId)).orderBy(desc(fulfillmentLabelPrintEvents.sequence)).get()?.id ?? null,
      latestPrintSequence: tx.select().from(fulfillmentLabelPrintEvents).where(eq(fulfillmentLabelPrintEvents.labelVersionId, preparationRow.labelVersionId)).orderBy(desc(fulfillmentLabelPrintEvents.sequence)).get()?.sequence ?? null,
      confirmations: tx.select().from(fulfillmentPreparationConfirmations).where(eq(fulfillmentPreparationConfirmations.preparationId, preparationRow.id)).all().map((row) => row.method === "BARCODE"
        ? { allocationId: row.reservationAllocationId, orderItemId: row.medicationOrderItemId, lotId: row.lotId, method: "BARCODE" as const, barcode: row.barcodeSnapshot ?? "" }
        : { allocationId: row.reservationAllocationId, orderItemId: row.medicationOrderItemId, lotId: row.lotId, method: "MANUAL" as const, reason: row.manualReason ?? "" }),
    } : null;
    const releaseRow = reservation ? tx.select().from(fulfillmentReleases).where(eq(fulfillmentReleases.reservationId, reservation.id)).get() : undefined;
    const release = releaseRow && !activeInvalidation(tx, "RELEASE", releaseRow.id) ? { id: releaseRow.id, reservationId: releaseRow.reservationId } : null;
    const dispenseRow = reservation ? tx.select().from(fulfillmentDispenses).where(eq(fulfillmentDispenses.reservationId, reservation.id)).get() : undefined;
    const dispense = dispenseRow ? {
      id: dispenseRow.id,
      reservationId: dispenseRow.reservationId,
      lines: tx.select().from(fulfillmentDispenseLines).where(eq(fulfillmentDispenseLines.dispenseId, dispenseRow.id)).all()
        .map((line) => ({ allocationId: line.reservationAllocationId, orderItemId: line.medicationOrderItemId, lotId: line.lotId, quantity: line.quantity })),
    } : null;
    const allowedActions: FulfillmentPickListDto["allowedActions"] = [];
    if (medicationDecision?.kind === "ORDER") {
      if (visit.status === "AWAITING_PREPARATION") allowedActions.push("START_PREPARATION");
      if (visit.status === "PREPARING" && label && preparation?.status === "ACTIVE") allowedActions.push("PRINT_LABEL", "CONFIRM_ALLOCATION", "COMPLETE_PREPARATION", "ABANDON_PREPARATION");
      if (visit.status === "AWAITING_RELEASE" && label && preparation?.status === "COMPLETED" && reservation?.status === "ACTIVE") allowedActions.push("RELEASE", "REJECT");
      if (visit.status === "AWAITING_HANDOFF" && release && reservation?.status === "ACTIVE" && !dispense) allowedActions.push("HANDOFF");
    }
    return {
      visit: { id: visit.id, status: visit.status as FulfillmentPickListDto["visit"]["status"], revision: visit.revision, arrivedAt: visit.arrivedAt, startedAt: visit.startedAt },
      patient: { id: patient.id, hn: patient.hn, displayName: patient.displayName, phone: patient.phone, birthDate: patient.birthDate, sex: patient.sex, revision: patient.revision, createdAt: patient.createdAt },
      medicationDecision, label, reservation: reservation ? { id: reservation.id, allocations } : null, preparation, release, dispense, allowedActions,
    };
  };
  const ensureLabel = (tx: AuditedTransaction, actor: Actor, visitId: string, decisionId: string): FulfillmentCurrentLabelDto => {
    const existing = tx.select().from(fulfillmentLabelVersions).where(eq(fulfillmentLabelVersions.medicationDecisionId, decisionId)).get();
    if (existing) return labelFor(tx, visitId) ?? invalidState("ฉลากยาปัจจุบันไม่พร้อมใช้งาน");
    const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.id, decisionId)).get();
    if (!decision || decision.visitId !== visitId || decision.kind !== "ORDER") invalidState("ไม่พบคำสั่งยาที่ลงนามแล้ว");
    const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
    const patient = visit && tx.select().from(patients).where(eq(patients.id, visit.patientId)).get();
    const clinic = tx.select().from(clinicConfig).where(eq(clinicConfig.id, "clinic")).get();
    if (!visit || !patient || !clinic) throw new Error("Fulfillment label source missing");
    const orderItems = tx.select().from(medicationOrderItems).where(eq(medicationOrderItems.medicationDecisionId, decision.id)).orderBy(asc(medicationOrderItems.position)).all();
    if (!orderItems.length) invalidState("คำสั่งยาไม่มีรายการยา");
    const now = clock().toISOString(); const labelId = nextId();
    tx.insert(fulfillmentLabelVersions).values({ id: labelId, clinicId: "clinic", visitId, medicationDecisionId: decision.id, medicationDecisionVersion: decision.version, version: decision.version, createdAt: now, createdBy: actor.id, patientHnSnapshot: patient.hn, patientDisplayNameSnapshot: patient.displayName, clinicNameSnapshot: clinic.name }).run();
    tx.insert(fulfillmentLabelItems).values(orderItems.map((item) => {
      const med = tx.select().from(medications).where(eq(medications.id, item.medicationId)).get();
      if (!med?.internalBarcode) throw new Error("Medication barcode missing");
      return { id: nextId(), labelVersionId: labelId, medicationOrderItemId: item.id, position: item.position, medicationId: item.medicationId, medicationRevision: item.medicationRevision, displayNameSnapshot: item.displayNameSnapshot, strengthSnapshot: item.strengthSnapshot, dosageFormSnapshot: item.dosageFormSnapshot, quantity: item.quantity, unitSnapshot: item.unitSnapshot, directionsThSnapshot: item.directionsTh, internalBarcodeSnapshot: med.internalBarcode };
    })).run();
    appendAuditEvent({ tx, actor, id: nextId(), action: "label.version-created", entityType: "fulfillment_label_version", entityId: labelId, entityRevision: decision.version, reason: null, occurredAt: now, metadata: { visitId, medicationDecisionId: decision.id, medicationDecisionVersion: decision.version, labelVersionId: labelId } });
    return labelFor(tx, visitId) ?? invalidState("สร้างฉลากยาไม่สำเร็จ");
  };
  const invalidate = (tx: AuditedTransaction, actor: Actor, visitId: string, trigger: "ABANDON" | "REJECT" | "ALLERGY_REVISION" | "ORDER_REVISION", reason: string, replacementDecisionId?: string, onlyPreparation = false): void => {
    const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
    if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
    const currentDecision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId)).orderBy(desc(medicationDecisions.version)).get();
    const replacementDecision = replacementDecisionId
      ? tx.select().from(medicationDecisions).where(eq(medicationDecisions.id, replacementDecisionId)).get()
      : undefined;
    const nextStatus = trigger === "ALLERGY_REVISION"
      ? "AWAITING_ORDER_REVISION"
      : trigger === "ABANDON" || trigger === "REJECT"
        ? "AWAITING_PREPARATION"
        : replacementDecision?.kind === "ORDER" ? "AWAITING_PREPARATION" : "AWAITING_CHARGE";
    const labels = tx.select().from(fulfillmentLabelVersions).where(eq(fulfillmentLabelVersions.visitId, visitId)).all();
    const preparations = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.visitId, visitId)).all();
    const releases = tx.select().from(fulfillmentReleases).where(eq(fulfillmentReleases.visitId, visitId)).all();
    type Artifact = {
      artifactType: "LABEL" | "PREPARATION" | "RELEASE";
      artifactId: string;
      label?: typeof fulfillmentLabelVersions.$inferSelect;
      preparation?: typeof fulfillmentPreparations.$inferSelect;
      release?: typeof fulfillmentReleases.$inferSelect;
    };
    const artifacts: Artifact[] = onlyPreparation
      ? preparations.map((preparation) => ({ artifactType: "PREPARATION", artifactId: preparation.id, preparation }))
      : [
        ...labels.map((label) => ({ artifactType: "LABEL" as const, artifactId: label.id, label })),
        ...preparations.map((preparation) => ({ artifactType: "PREPARATION" as const, artifactId: preparation.id, preparation })),
        ...releases.map((release) => ({ artifactType: "RELEASE" as const, artifactId: release.id, release })),
      ];
    const now = clock().toISOString();
    for (const artifact of artifacts) if (!activeInvalidation(tx, artifact.artifactType, artifact.artifactId)) {
      const linkedPreparation = artifact.preparation
        ?? preparations.find((preparation) => preparation.labelVersionId === artifact.label?.id || preparation.reservationId === artifact.release?.reservationId);
      const linkedRelease = artifact.release
        ?? releases.find((release) => release.labelVersionId === artifact.label?.id || release.preparationId === artifact.preparation?.id);
      const linkedReservation = artifact.preparation?.reservationId
        ?? artifact.release?.reservationId
        ?? linkedPreparation?.reservationId
        ?? linkedRelease?.reservationId
        ?? tx.select().from(inventoryReservations).where(and(
          eq(inventoryReservations.visitId, visitId),
          eq(inventoryReservations.medicationDecisionId, artifact.label?.medicationDecisionId ?? currentDecision?.id ?? replacementDecisionId ?? ""),
        )).orderBy(desc(inventoryReservations.createdAt)).get()?.id;
      const allocationRows = linkedReservation
        ? tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, linkedReservation)).orderBy(asc(inventoryReservationAllocations.position)).all()
        : [];
      const decisionId = artifact.label?.medicationDecisionId ?? artifact.preparation?.medicationDecisionId ?? artifact.release?.medicationDecisionId ?? currentDecision?.id ?? replacementDecisionId ?? "";
      const decisionVersion = artifact.label?.medicationDecisionVersion ?? artifact.preparation?.medicationDecisionVersion ?? artifact.release?.medicationDecisionVersion ?? currentDecision?.version ?? replacementDecision?.version ?? 1;
      const labelVersionId = artifact.label?.id ?? artifact.preparation?.labelVersionId ?? artifact.release?.labelVersionId ?? linkedPreparation?.labelVersionId ?? linkedRelease?.labelVersionId ?? null;
      const preparationId = artifact.preparation?.id ?? artifact.release?.preparationId ?? linkedPreparation?.id ?? null;
      const releaseId = artifact.release?.id ?? linkedRelease?.id ?? null;
      tx.insert(fulfillmentArtifactInvalidations).values({ id: nextId(), clinicId: "clinic", visitId, artifactType: artifact.artifactType, artifactId: artifact.artifactId, trigger, reason, invalidatedAt: now, invalidatedBy: actor.id, replacementDecisionId: trigger === "ORDER_REVISION" ? replacementDecisionId ?? null : null }).run();
      appendAuditEvent({ tx, actor, id: nextId(), action: "fulfillment.artifacts-invalidated", entityType: "fulfillment_artifact", entityId: artifact.artifactId, entityRevision: 1, reason, occurredAt: now, metadata: {
        visitId,
        artifactType: artifact.artifactType,
        artifactId: artifact.artifactId,
        trigger,
        replacementDecisionId: replacementDecisionId ?? null,
        decisionId,
        decisionVersion,
        labelVersionId,
        preparationId,
        releaseId,
        reservationId: linkedReservation ?? null,
        previousStatus: visit.status,
        nextStatus,
        allocations: allocationRows.map((allocation) => ({
          allocationId: allocation.id,
          lotId: allocation.lotId,
          lotNumber: allocation.lotNumberSnapshot,
          lotNumberSnapshot: allocation.lotNumberSnapshot,
          quantity: allocation.quantity,
          unit: allocation.unitSnapshot,
        })),
      } });
    }
  };
  return {
    getPickList: (visitId) => read(input.database.db, visitId), getCurrentLabel: (visitId) => labelFor(input.database.db, visitId), readHandoffChain: (visitId) => read(input.database.db, visitId),
    createLabelForSignedOrder: ensureLabel,
    startPreparation(tx, actor, visitId, visitRevision, decisionVersion, labelVersionId) {
      const currentLabel = labelFor(tx, visitId);
      if (currentLabel && (currentLabel.id !== labelVersionId || currentLabel.medicationDecisionVersion !== decisionVersion)) artifactStale("ฉลากยาปัจจุบันไม่ตรงกับคำสั่งที่เลือก");
      input.inventory.reserveForVisit(tx, actor, visitId, visitRevision, decisionVersion);
      const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId)).orderBy(desc(medicationDecisions.version)).get();
      if (!decision) throw new Error("Signed decision disappeared");
      const label = ensureLabel(tx, actor, visitId, decision.id);
      if (!label) throw new Error("Label was not created");
      const reservation = tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.visitId, visitId), eq(inventoryReservations.status, "ACTIVE"))).orderBy(desc(inventoryReservations.createdAt)).get();
      if (!reservation) throw new Error("Reservation was not created");
      const existing = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.reservationId, reservation.id)).get();
      const lastRejection = tx.select().from(fulfillmentRejections).where(and(eq(fulfillmentRejections.visitId, visitId), eq(fulfillmentRejections.labelVersionId, label.id))).orderBy(desc(fulfillmentRejections.printSequenceAtRejection)).get();
      if (!existing) tx.insert(fulfillmentPreparations).values({ id: nextId(), clinicId: "clinic", visitId, reservationId: reservation.id, medicationDecisionId: decision.id, medicationDecisionVersion: decision.version, labelVersionId: label.id, revision: 1, status: "ACTIVE", minimumPrintSequence: (lastRejection?.printSequenceAtRejection ?? 0) + 1, createdAt: clock().toISOString(), createdBy: actor.id, completedAt: null, completedBy: null }).run();
      return read(tx, visitId);
    },
    recordPrintRequest(tx, actor, visitId, labelVersionId, visitRevision, decisionVersion, rendererVersion) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get(); if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" }); assertExpectedRevision(visit.revision, visitRevision, "visit");
      const label = labelFor(tx, visitId); if (!label || label.id !== labelVersionId || label.medicationDecisionVersion !== decisionVersion) artifactStale("ฉลากยานี้ไม่พร้อมพิมพ์");
      const sequence = (tx.select().from(fulfillmentLabelPrintEvents).where(eq(fulfillmentLabelPrintEvents.labelVersionId, label.id)).all().reduce((max, event) => Math.max(max, event.sequence), 0)) + 1;
      const now = clock().toISOString(); const id = nextId();
      tx.insert(fulfillmentLabelPrintEvents).values({ id, labelVersionId: label.id, sequence, requestedAt: now, requestedBy: actor.id, rendererVersion, mediaSizeSnapshot: "80x100mm" }).run();
      appendAuditEvent({ tx, actor, id: nextId(), action: "label.print-requested", entityType: "fulfillment_label_version", entityId: label.id, entityRevision: label.version, reason: null, occurredAt: now, metadata: { visitId, labelVersionId: label.id, sequence } }); return read(tx, visitId);
    },
    confirmAllocation(tx, actor, visitId, visitRevision, preparationRevision, payload) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get(); if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" }); assertExpectedRevision(visit.revision, visitRevision, "visit");
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, payload.preparationId)).get();
      if (!prep || prep.visitId !== visitId || prep.status !== "ACTIVE" || activeInvalidation(tx, "PREPARATION", prep.id)) artifactStale("รายการจัดยาไม่พร้อมยืนยัน"); assertExpectedRevision(prep.revision, preparationRevision, "preparation");
      const allocation = tx.select().from(inventoryReservationAllocations).where(and(eq(inventoryReservationAllocations.id, payload.allocationId), eq(inventoryReservationAllocations.reservationId, prep.reservationId))).get(); if (!allocation) artifactStale("ไม่พบรายการจัดยาที่เลือก");
      const existingConfirmation = tx.select({ id: fulfillmentPreparationConfirmations.id }).from(fulfillmentPreparationConfirmations).where(and(eq(fulfillmentPreparationConfirmations.preparationId, prep.id), eq(fulfillmentPreparationConfirmations.reservationAllocationId, allocation.id))).get();
      if (existingConfirmation) throw new ApiError({ code: "ALLOCATION_ALREADY_CONFIRMED", messageTh: "รายการจัดยานี้ได้รับการยืนยันแล้ว" });
      const labelItem = tx.select().from(fulfillmentLabelItems).where(and(eq(fulfillmentLabelItems.labelVersionId, prep.labelVersionId), eq(fulfillmentLabelItems.medicationOrderItemId, allocation.medicationOrderItemId))).get();
      if (payload.method === "BARCODE" && (!labelItem || labelItem.internalBarcodeSnapshot !== payload.barcode.trim().toUpperCase())) throw new ApiError({ code: "BARCODE_MISMATCH", messageTh: "บาร์โค้ดไม่ตรงกับรายการจัดยา" });
      const now = clock().toISOString();
      const confirmationId = nextId(); const manualReason = payload.method === "MANUAL" ? payload.reason.trim() : null;
      tx.insert(fulfillmentPreparationConfirmations).values({ id: confirmationId, preparationId: prep.id, reservationAllocationId: allocation.id, medicationOrderItemId: allocation.medicationOrderItemId, medicationId: allocation.medicationId, lotId: allocation.lotId, quantity: allocation.quantity, method: payload.method, barcodeSnapshot: payload.method === "BARCODE" ? payload.barcode.trim().toUpperCase() : null, manualReason, confirmedAt: now, confirmedBy: actor.id }).run();
      appendAuditEvent({ tx, actor, id: nextId(), action: "preparation.allocation-confirmed", entityType: "fulfillment_preparation", entityId: prep.id, entityRevision: prep.revision, reason: manualReason, occurredAt: now, metadata: { visitId, decisionId: prep.medicationDecisionId, decisionVersion: prep.medicationDecisionVersion, labelVersionId: prep.labelVersionId, preparationId: prep.id, reservationId: prep.reservationId, confirmationId, allocationId: allocation.id, orderItemId: allocation.medicationOrderItemId, method: payload.method, barcode: payload.method === "BARCODE" ? payload.barcode.trim().toUpperCase() : null, manualReason, lot: { lotId: allocation.lotId, lotNumber: allocation.lotNumberSnapshot, expiryDate: allocation.expiryDateSnapshot, unit: allocation.unitSnapshot, quantity: allocation.quantity } } }); return read(tx, visitId);
    },
    completePreparation(tx, actor, visitId, visitRevision, preparationRevision, preparationId, reservationId) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get(); if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" }); assertExpectedRevision(visit.revision, visitRevision, "visit");
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, preparationId)).get(); if (!prep || prep.visitId !== visitId || prep.status !== "ACTIVE" || activeInvalidation(tx, "PREPARATION", prep.id) || prep.reservationId !== reservationId) artifactStale("รายการจัดยาไม่พร้อมเสร็จสิ้น"); assertExpectedRevision(prep.revision, preparationRevision, "preparation");
      const allocationCount = tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, prep.reservationId)).all().length; const confirmationCount = tx.select().from(fulfillmentPreparationConfirmations).where(eq(fulfillmentPreparationConfirmations.preparationId, prep.id)).all().length; if (allocationCount !== confirmationCount) preparationIncomplete("ยืนยันรายการจัดยาไม่ครบ");
      const now = clock().toISOString();
      assertReservationSellable(tx, prep.reservationId);
      const changedPreparation = tx.update(fulfillmentPreparations).set({ status: "COMPLETED", revision: prep.revision + 1, completedAt: now, completedBy: actor.id }).where(and(eq(fulfillmentPreparations.id, prep.id), eq(fulfillmentPreparations.revision, prep.revision))).run();
      if (changedPreparation.changes !== 1) invalidState("รายการจัดยาถูกเปลี่ยนแปลงแล้ว");
      const changedVisit = tx.update(visits).set({ status: "AWAITING_RELEASE", revision: visit.revision + 1 }).where(and(eq(visits.id, visitId), eq(visits.status, "PREPARING"), eq(visits.revision, visit.revision))).run();
      if (changedVisit.changes !== 1) invalidState("Visit ถูกเปลี่ยนแปลงแล้ว");
      appendAuditEvent({ tx, actor, id: nextId(), action: "visit.preparation-completed", entityType: "visit", entityId: visitId, entityRevision: visit.revision + 1, reason: null, occurredAt: now, metadata: { previousStatus: visit.status, nextStatus: "AWAITING_RELEASE", preparationId: prep.id, reservationId: prep.reservationId } }); return read(tx, visitId);
    },
    abandonPreparation(tx, actor, visitId, visitRevision, preparationRevision, preparationId, reservationId, reason) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, visitRevision, "visit");
      if (visit.status !== "PREPARING") invalidState("สถานะ Visit ไม่อนุญาตให้ยกเลิกการจัดยา");
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, preparationId)).get();
      if (!prep || prep.visitId !== visitId || prep.status !== "ACTIVE" || activeInvalidation(tx, "PREPARATION", prep.id) || prep.reservationId !== reservationId) artifactStale("รายการจัดยาไม่พร้อมยกเลิก");
      assertExpectedRevision(prep.revision, preparationRevision, "preparation");
      const reservation = tx.select().from(inventoryReservations).where(and(
        eq(inventoryReservations.id, prep.reservationId),
        eq(inventoryReservations.visitId, visitId),
        eq(inventoryReservations.status, "ACTIVE"),
      )).get();
      if (!reservation) invalidState("รายการจองยาที่เกี่ยวข้องไม่พร้อมยกเลิก");
      const allocations = tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, prep.reservationId)).all();
      invalidate(tx, actor, visitId, "ABANDON", reason.trim(), undefined, true);
      const released = input.inventory.releaseActiveReservation(tx, actor, visitId, reason.trim());
      if (!released || released.id !== reservation.id) invalidState("รายการจองยาที่เกี่ยวข้องถูกเปลี่ยนแปลงแล้ว");
      const now = clock().toISOString();
      appendAuditEvent({ tx, actor, id: nextId(), action: "inventory.reservation-released", entityType: "inventory_reservation", entityId: released.id, entityRevision: 1, reason: reason.trim(), occurredAt: released.releasedAt ?? now, metadata: { visitId, trigger: "manual-release", allocations: allocations.map((allocation) => ({ lotId: allocation.lotId, lotNumber: allocation.lotNumberSnapshot, quantity: allocation.quantity, unit: allocation.unitSnapshot })) } });
      const changedVisit = tx.update(visits).set({ status: "AWAITING_PREPARATION", revision: visit.revision + 1 }).where(and(eq(visits.id, visitId), eq(visits.status, "PREPARING"), eq(visits.revision, visit.revision))).run();
      if (changedVisit.changes !== 1) invalidState("Visit ถูกเปลี่ยนแปลงแล้ว");
      appendAuditEvent({ tx, actor, id: nextId(), action: "visit.preparation-abandoned", entityType: "visit", entityId: visitId, entityRevision: visit.revision + 1, reason: reason.trim(), occurredAt: now, metadata: { previousStatus: visit.status, nextStatus: "AWAITING_PREPARATION", preparationId, reservationId: prep.reservationId } }); return read(tx, visitId);
    },
    releaseForVisit(tx, actor, visitId, visitRevision, preparationRevision, payload) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, visitRevision, "visit");
      if (visit.status !== "AWAITING_RELEASE") artifactStale("สถานะ Visit ไม่อนุญาตให้ตรวจปล่อยยา");
      const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId)).orderBy(desc(medicationDecisions.version)).get();
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, payload.preparationId)).get();
      const label = labelFor(tx, visitId);
      if (!decision || decision.kind !== "ORDER" || decision.id !== payload.decisionId || decision.version !== payload.decisionVersion || !prep || prep.visitId !== visitId || prep.status !== "COMPLETED" || prep.medicationDecisionId !== payload.decisionId || prep.medicationDecisionVersion !== payload.decisionVersion || !label || label.id !== payload.labelVersionId || label.medicationDecisionId !== payload.decisionId || label.medicationDecisionVersion !== payload.decisionVersion || prep.labelVersionId !== payload.labelVersionId || activeInvalidation(tx, "LABEL", label.id) || activeInvalidation(tx, "PREPARATION", prep.id)) artifactStale("หลักฐานการเตรียมยาไม่พร้อมตรวจปล่อย");
      assertExpectedRevision(prep.revision, preparationRevision, "preparation");
      const reservation = tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.id, prep.reservationId), eq(inventoryReservations.status, "ACTIVE"))).get();
      if (!reservation || reservation.id !== payload.reservationId || reservation.medicationDecisionId !== decision.id || reservation.medicationDecisionVersion !== decision.version) reservationNotSellable("รายการจองยาไม่พร้อมตรวจปล่อย");
      const print = tx.select().from(fulfillmentLabelPrintEvents).where(eq(fulfillmentLabelPrintEvents.labelVersionId, label.id)).orderBy(desc(fulfillmentLabelPrintEvents.sequence)).get();
      if (!print || print.id !== payload.labelPrintEventId || print.labelVersionId !== payload.labelVersionId || print.sequence < prep.minimumPrintSequence) throw new ApiError({ code: "LABEL_PRINT_REQUIRED", messageTh: "ยังไม่มีคำขอพิมพ์ฉลากตามรอบที่ต้องใช้" });
      const allocations = tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id)).all();
      const confirmations = tx.select().from(fulfillmentPreparationConfirmations).where(eq(fulfillmentPreparationConfirmations.preparationId, prep.id)).all();
      if (allocations.length === 0 || confirmations.length !== allocations.length || allocations.some((allocation) => !confirmations.some((confirmation) => confirmation.reservationAllocationId === allocation.id && confirmation.quantity === allocation.quantity && confirmation.lotId === allocation.lotId && confirmation.medicationOrderItemId === allocation.medicationOrderItemId))) preparationIncomplete("การยืนยันรายการจัดยาไม่ครบถ้วน");
      for (const allocation of allocations) {
        const lot = tx.select().from(inventoryLots).where(eq(inventoryLots.id, allocation.lotId)).get();
        const today = clinicDate(clock());
        if (!lot || lot.status !== "AVAILABLE" || lot.expiryDate <= today) reservationNotSellable("ล็อตยาสำหรับตรวจปล่อยไม่พร้อมใช้งาน");
      }
      if (tx.select({ id: fulfillmentReleases.id }).from(fulfillmentReleases).where(eq(fulfillmentReleases.reservationId, reservation.id)).get()) artifactStale("มีหลักฐานการตรวจปล่อยสำหรับรายการจองนี้แล้ว");
      const now = clock().toISOString(); const releaseId = nextId();
      tx.insert(fulfillmentReleases).values({ id: releaseId, clinicId: "clinic", visitId, medicationDecisionId: decision.id, medicationDecisionVersion: decision.version, labelVersionId: label.id, labelPrintEventId: print.id, preparationId: prep.id, preparationRevision: prep.revision, reservationId: reservation.id, releasedAt: now, releasedBy: actor.id }).run();
      const changed = tx.update(visits).set({ status: "AWAITING_HANDOFF", revision: visit.revision + 1 }).where(and(eq(visits.id, visitId), eq(visits.status, "AWAITING_RELEASE"), eq(visits.revision, visit.revision))).run();
      if (changed.changes !== 1) invalidState("Visit ถูกเปลี่ยนแปลงแล้ว");
      const releaseMetadata = {
        visitId,
        releaseId,
        decisionId: decision.id,
        decisionVersion: decision.version,
        labelVersionId: label.id,
        labelPrintEventId: print.id,
        printSequence: print.sequence,
        preparationId: prep.id,
        preparationRevision: prep.revision,
        reservationId: reservation.id,
        previousStatus: visit.status,
        nextStatus: "AWAITING_HANDOFF",
        allocations: allocations.map((allocation) => ({
          allocationId: allocation.id,
          lotId: allocation.lotId,
          lotNumber: allocation.lotNumberSnapshot,
          lotNumberSnapshot: allocation.lotNumberSnapshot,
          quantity: allocation.quantity,
          unit: allocation.unitSnapshot,
        })),
      };
      appendAuditEvent({ tx, actor, id: nextId(), action: "medication.release-created", entityType: "fulfillment_release", entityId: releaseId, entityRevision: 1, reason: null, occurredAt: now, metadata: releaseMetadata });
      return read(tx, visitId);
    },
    rejectForVisit(tx, actor, visitId, visitRevision, preparationRevision, payload) {
      const trimmedReason = payload.reason.trim();
      if (!trimmedReason) throw new ApiError({ code: "VALIDATION_FAILED", messageTh: "ต้องระบุเหตุผลการปฏิเสธ" });
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, visitRevision, "visit");
      if (visit.status !== "AWAITING_RELEASE") invalidState("สถานะ Visit ไม่อนุญาตให้ปฏิเสธการจัดยา");
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, payload.preparationId)).get();
      const label = labelFor(tx, visitId);
      const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId)).orderBy(desc(medicationDecisions.version)).get();
      if (!decision || decision.kind !== "ORDER" || decision.id !== payload.decisionId || decision.version !== payload.decisionVersion || !prep || prep.visitId !== visitId || prep.status !== "COMPLETED" || prep.medicationDecisionId !== payload.decisionId || prep.medicationDecisionVersion !== payload.decisionVersion || !label || label.id !== payload.labelVersionId || label.medicationDecisionId !== payload.decisionId || label.medicationDecisionVersion !== payload.decisionVersion || prep.labelVersionId !== payload.labelVersionId || activeInvalidation(tx, "LABEL", label.id) || activeInvalidation(tx, "PREPARATION", prep.id)) invalidState("รายการจัดยาไม่พร้อมปฏิเสธ");
      assertExpectedRevision(prep.revision, preparationRevision, "preparation");
      const reservation = tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.id, prep.reservationId), eq(inventoryReservations.status, "ACTIVE"))).get();
      const print = tx.select().from(fulfillmentLabelPrintEvents).where(eq(fulfillmentLabelPrintEvents.labelVersionId, label.id)).orderBy(desc(fulfillmentLabelPrintEvents.sequence)).get();
      if (!reservation || reservation.id !== payload.reservationId || !print || print.id !== payload.labelPrintEventId || print.labelVersionId !== payload.labelVersionId || print.sequence < prep.minimumPrintSequence) invalidState("หลักฐานฉลากหรือรายการจองยาไม่พร้อมปฏิเสธ");
      const now = clock().toISOString(); const rejectionId = nextId();
      tx.insert(fulfillmentRejections).values({ id: rejectionId, clinicId: "clinic", visitId, preparationId: prep.id, reservationId: reservation.id, labelVersionId: label.id, printSequenceAtRejection: print.sequence, reason: trimmedReason, rejectedAt: now, rejectedBy: actor.id }).run();
      invalidate(tx, actor, visitId, "REJECT", trimmedReason, undefined, true);
      const released = input.inventory.releaseActiveReservation(tx, actor, visitId, trimmedReason);
      if (!released || released.id !== reservation.id) invalidState("รายการจองยาถูกเปลี่ยนแปลงแล้ว");
      const changed = tx.update(visits).set({ status: "AWAITING_PREPARATION", revision: visit.revision + 1 }).where(and(eq(visits.id, visitId), eq(visits.status, "AWAITING_RELEASE"), eq(visits.revision, visit.revision))).run();
      if (changed.changes !== 1) invalidState("Visit ถูกเปลี่ยนแปลงแล้ว");
      const rejectionMetadata = {
        visitId,
        rejectionId,
        decisionId: decision.id,
        decisionVersion: decision.version,
        labelVersionId: label.id,
        labelPrintEventId: print.id,
        printSequence: print.sequence,
        preparationId: prep.id,
        preparationRevision: prep.revision,
        reservationId: reservation.id,
        previousStatus: visit.status,
        nextStatus: "AWAITING_PREPARATION",
        allocations: tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id)).all().map((allocation) => ({
          allocationId: allocation.id,
          lotId: allocation.lotId,
          lotNumber: allocation.lotNumberSnapshot,
          lotNumberSnapshot: allocation.lotNumberSnapshot,
          quantity: allocation.quantity,
          unit: allocation.unitSnapshot,
        })),
      };
      appendAuditEvent({ tx, actor, id: nextId(), action: "preparation.rejected", entityType: "fulfillment_preparation", entityId: prep.id, entityRevision: prep.revision, reason: trimmedReason, occurredAt: now, metadata: rejectionMetadata });
      appendAuditEvent({ tx, actor, id: nextId(), action: "inventory.reservation-released", entityType: "inventory_reservation", entityId: reservation.id, entityRevision: 1, reason: trimmedReason, occurredAt: released.releasedAt ?? now, metadata: { ...rejectionMetadata, releaseReason: trimmedReason } });
      return read(tx, visitId);
    },
    handoffForVisit(tx, actor, visitId, visitRevision, payload) {
      const visit = tx.select().from(visits).where(eq(visits.id, visitId)).get();
      if (!visit) throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit" });
      assertExpectedRevision(visit.revision, visitRevision, "visit");
      if (visit.status !== "AWAITING_HANDOFF") {
        if (tx.select({ id: fulfillmentDispenses.id }).from(fulfillmentDispenses).where(eq(fulfillmentDispenses.visitId, visitId)).get()) throw new ApiError({ code: "HANDOFF_ALREADY_CONFIRMED", messageTh: "รายการส่งมอบนี้ได้รับการยืนยันแล้ว" });
        artifactStale("สถานะ Visit ไม่อนุญาตให้ส่งมอบยา");
      }
      const decision = tx.select().from(medicationDecisions).where(eq(medicationDecisions.visitId, visitId)).orderBy(desc(medicationDecisions.version)).get();
      const label = labelFor(tx, visitId);
      if (!decision || decision.kind !== "ORDER" || decision.id !== payload.decisionId || decision.version !== payload.decisionVersion || !label || label.id !== payload.labelVersionId || label.medicationDecisionId !== payload.decisionId || label.medicationDecisionVersion !== payload.decisionVersion || activeInvalidation(tx, "LABEL", label.id)) invalidState("คำสั่งยาหรือฉลากปัจจุบันไม่พร้อมส่งมอบ");
      const release = tx.select().from(fulfillmentReleases).where(and(eq(fulfillmentReleases.visitId, visitId), eq(fulfillmentReleases.medicationDecisionId, decision.id))).get();
      if (!release || release.id !== payload.releaseId || activeInvalidation(tx, "RELEASE", release.id) || release.labelVersionId !== label.id || release.medicationDecisionVersion !== payload.decisionVersion) throw new ApiError({ code: "RELEASE_REQUIRED", messageTh: "หลักฐานการตรวจปล่อยไม่พร้อมส่งมอบ" });
      const prep = tx.select().from(fulfillmentPreparations).where(eq(fulfillmentPreparations.id, release.preparationId)).get();
      const reservation = tx.select().from(inventoryReservations).where(and(eq(inventoryReservations.id, release.reservationId), eq(inventoryReservations.status, "ACTIVE"))).get();
      if (!prep || prep.status !== "COMPLETED" || prep.medicationDecisionId !== payload.decisionId || prep.medicationDecisionVersion !== payload.decisionVersion || prep.labelVersionId !== payload.labelVersionId || activeInvalidation(tx, "PREPARATION", prep.id) || !reservation || reservation.id !== payload.reservationId || release.reservationId !== payload.reservationId || reservation.medicationDecisionId !== decision.id || reservation.medicationDecisionVersion !== payload.decisionVersion || tx.select({ id: fulfillmentDispenses.id }).from(fulfillmentDispenses).where(eq(fulfillmentDispenses.visitId, visitId)).get()) invalidState("รายการส่งมอบยาไม่พร้อมใช้งาน");
      const allocations = tx.select().from(inventoryReservationAllocations).where(eq(inventoryReservationAllocations.reservationId, reservation.id)).orderBy(asc(inventoryReservationAllocations.position)).all();
      if (!allocations.length) invalidState("รายการจองยาไม่มี allocation");
      const now = clock().toISOString(); const dispenseId = nextId();
      tx.insert(fulfillmentDispenses).values({ id: dispenseId, clinicId: "clinic", visitId, medicationDecisionId: decision.id, medicationDecisionVersion: decision.version, labelVersionId: label.id, preparationId: prep.id, releaseId: release.id, reservationId: reservation.id, handedOffAt: now, handedOffBy: actor.id }).run();
      const lines = allocations.map((allocation) => {
        const item = tx.select().from(medicationOrderItems).where(eq(medicationOrderItems.id, allocation.medicationOrderItemId)).get();
        const lot = tx.select().from(inventoryLots).where(eq(inventoryLots.id, allocation.lotId)).get();
        if (!item || !lot || item.medicationId !== allocation.medicationId || lot.medicationId !== allocation.medicationId) invalidState("ข้อมูล allocation ไม่สมบูรณ์");
        return { id: nextId(), dispenseId, reservationAllocationId: allocation.id, medicationOrderItemId: item.id, medicationId: allocation.medicationId, lotId: allocation.lotId, quantity: allocation.quantity, displayNameSnapshot: item.displayNameSnapshot, strengthSnapshot: item.strengthSnapshot, dosageFormSnapshot: item.dosageFormSnapshot, unitSnapshot: item.unitSnapshot, lotNumberSnapshot: allocation.lotNumberSnapshot, expiryDateSnapshot: allocation.expiryDateSnapshot, directionsThSnapshot: item.directionsTh };
      });
      tx.insert(fulfillmentDispenseLines).values(lines).run();
      input.inventory.consumeReservationForDispense(tx, actor, { visitId, reservationId: reservation.id, dispenseId, decisionId: decision.id, decisionVersion: decision.version, labelVersionId: label.id, labelPrintEventId: release.labelPrintEventId, releaseId: release.id, preparationId: prep.id, occurredAt: now, previousStatus: visit.status, nextStatus: "AWAITING_CHARGE", lines: lines.map((line) => ({ id: line.id, reservationAllocationId: line.reservationAllocationId, lotId: line.lotId, quantity: line.quantity, lotNumberSnapshot: line.lotNumberSnapshot, unitSnapshot: line.unitSnapshot })) });
      const changed = tx.update(visits).set({ status: "AWAITING_CHARGE", revision: visit.revision + 1 }).where(and(eq(visits.id, visitId), eq(visits.status, "AWAITING_HANDOFF"), eq(visits.revision, visit.revision))).run();
      if (changed.changes !== 1) invalidState("Visit ถูกเปลี่ยนแปลงแล้ว");
      const handoffMetadata = {
        visitId,
        dispenseId,
        decisionId: decision.id,
        decisionVersion: decision.version,
        labelVersionId: label.id,
        labelPrintEventId: release.labelPrintEventId,
        releaseId: release.id,
        preparationId: prep.id,
        preparationRevision: release.preparationRevision,
        reservationId: reservation.id,
        previousStatus: visit.status,
        nextStatus: "AWAITING_CHARGE",
        allocations: lines.map((line) => ({
          allocationId: line.reservationAllocationId,
          dispenseLineId: line.id,
          lotId: line.lotId,
          lotNumber: line.lotNumberSnapshot,
          lotNumberSnapshot: line.lotNumberSnapshot,
          quantity: line.quantity,
          unit: line.unitSnapshot,
        })),
      };
      appendAuditEvent({ tx, actor, id: nextId(), action: "dispense.handoff-confirmed", entityType: "fulfillment_dispense", entityId: dispenseId, entityRevision: 1, reason: null, occurredAt: now, metadata: handoffMetadata });
      appendAuditEvent({ tx, actor, id: nextId(), action: "visit.handoff-confirmed", entityType: "visit", entityId: visitId, entityRevision: visit.revision + 1, reason: null, occurredAt: now, metadata: handoffMetadata });
      return read(tx, visitId);
    },
    invalidateCurrentArtifacts(tx, actor, visitId, trigger, reason, replacementDecisionId) { invalidate(tx, actor, visitId, trigger, reason.trim(), replacementDecisionId); },
  };
}
