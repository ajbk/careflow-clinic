import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type {
  Actor,
  CloseVisitBody,
  ClinicalNoteAmendmentDto,
  OpdCardDto,
  SignedClinicalNoteDto,
  VisitClosureDto,
} from "../../shared/contracts.js";
import type { DatabaseHandle } from "../db/client.js";
import { ApiError } from "../errors.js";
import {
  financeChargeLines,
  type FinanceService,
} from "../modules/finance/index.js";
import {
  fulfillmentDispenseLines,
  fulfillmentDispenses,
  fulfillmentPreparations,
  type FulfillmentService,
} from "../modules/fulfillment/index.js";
import { inventoryReservations } from "../modules/inventory/index.js";
import {
  medicationDecisions,
  type MedicationService,
} from "../modules/medication/index.js";
import {
  clinicalNoteAmendments,
  clinicalNoteDiagnoses,
  clinicalNotes,
  type NoteService,
} from "../modules/note/index.js";
import { patients } from "../modules/patient/schema.js";
import {
  appendAuditEvent,
  hashEvidence,
  requirePermission,
  type AuditedTransaction,
} from "../modules/platform/index.js";
import { clinicConfig } from "../modules/platform/schema.js";
import {
  intakeObservations,
  visitClosures,
  visits,
  type VisitService,
} from "../modules/visit/index.js";

type ClosureRow = typeof visitClosures.$inferSelect;

type ClosureReplayReference = {
  visitId: string;
  closureId: string;
};

type CloseBlocker = "charge" | "collection" | "visitState";

export type VisitCloseWriteStage =
  | "AFTER_CLOSURE_INSERT"
  | "AFTER_VISIT_TRANSITION"
  | "AFTER_AUDIT_APPEND"
  | "AFTER_IDEMPOTENCY_INSERT";

function notFound(): never {
  throw new ApiError({ code: "NOT_FOUND", messageTh: "ไม่พบ Visit ที่ร้องขอ" });
}

function closeBlocked(field: CloseBlocker): never {
  throw new ApiError({
    code: "VISIT_CLOSE_BLOCKED",
    messageTh: "Visit นี้ยังไม่พร้อมปิด",
    fieldErrors: {
      [field]: field === "charge"
        ? "ต้องมีหลักฐาน Charge ที่สมบูรณ์"
        : field === "collection"
          ? "ต้องมีหลักฐานการชำระหรือยกเว้นที่ตรงกัน"
          : "สถานะ Visit ยังไม่พร้อมปิด",
    },
  });
}

function opdNotReady(): never {
  throw new ApiError({
    code: "OPD_CARD_NOT_READY",
    messageTh: "Visit นี้ยังไม่มี OPD Card ที่พร้อมอ่าน",
  });
}

function closureHashInput(closure: Pick<ClosureRow,
  | "id"
  | "clinicId"
  | "visitId"
  | "visitRevision"
  | "chargeId"
  | "paymentId"
  | "waiverAdjustmentId"
  | "clinicNameSnapshot"
  | "patientIdSnapshot"
  | "patientHnSnapshot"
  | "patientDisplayNameSnapshot"
  | "patientBirthDateSnapshot"
  | "patientSexSnapshot"
  | "doctorIdSnapshot"
  | "doctorDisplayNameSnapshot"
  | "closedAt"
>): Record<string, unknown> {
  return {
    id: closure.id,
    clinicId: closure.clinicId,
    visitId: closure.visitId,
    visitRevision: closure.visitRevision,
    chargeId: closure.chargeId,
    paymentId: closure.paymentId,
    waiverAdjustmentId: closure.waiverAdjustmentId,
    clinicNameSnapshot: closure.clinicNameSnapshot,
    patientIdSnapshot: closure.patientIdSnapshot,
    patientHnSnapshot: closure.patientHnSnapshot,
    patientDisplayNameSnapshot: closure.patientDisplayNameSnapshot,
    patientBirthDateSnapshot: closure.patientBirthDateSnapshot,
    patientSexSnapshot: closure.patientSexSnapshot,
    doctorIdSnapshot: closure.doctorIdSnapshot,
    doctorDisplayNameSnapshot: closure.doctorDisplayNameSnapshot,
    closedAt: closure.closedAt,
  };
}

function closureHash(closure: Parameters<typeof closureHashInput>[0]): string {
  return hashEvidence({ visitClosure: closureHashInput(closure) });
}

function toClosureDto(
  closure: ClosureRow,
  visit: typeof visits.$inferSelect,
): VisitClosureDto {
  if (closure.paymentId === null && closure.waiverAdjustmentId === null) {
    throw new Error("Visit Closure has no financial resolution");
  }
  if (closure.paymentId !== null && closure.waiverAdjustmentId !== null) {
    throw new Error("Visit Closure has two financial resolutions");
  }
  if (visit.status !== "CLOSED" || visit.closedAt !== closure.closedAt) {
    throw new Error("Visit Closure does not match CLOSED Visit");
  }
  return {
    id: closure.id,
    visitId: closure.visitId,
    visitRevision: closure.visitRevision,
    chargeId: closure.chargeId,
    resolution: closure.paymentId !== null
      ? { kind: "PAYMENT", paymentId: closure.paymentId }
      : { kind: "COLLECTION_NOT_REQUIRED", waiverAdjustmentId: closure.waiverAdjustmentId! },
    clinic: { id: closure.clinicId, name: closure.clinicNameSnapshot },
    patient: {
      id: closure.patientIdSnapshot,
      hn: closure.patientHnSnapshot,
      displayName: closure.patientDisplayNameSnapshot,
      birthDate: closure.patientBirthDateSnapshot,
      sex: closure.patientSexSnapshot,
    },
    doctor: { id: closure.doctorIdSnapshot, displayName: closure.doctorDisplayNameSnapshot },
    closedAt: closure.closedAt,
    contentHash: closure.contentHash,
    visit: {
      id: visit.id,
      status: "CLOSED",
      revision: visit.revision,
      arrivedAt: visit.arrivedAt,
      startedAt: visit.startedAt,
      closedAt: visit.closedAt,
    },
  };
}

function toSignedNote(
  tx: DatabaseHandle["db"] | AuditedTransaction,
  note: typeof clinicalNotes.$inferSelect,
): SignedClinicalNoteDto {
  const diagnoses = tx.select({ diagnosisText: clinicalNoteDiagnoses.diagnosisText })
    .from(clinicalNoteDiagnoses)
    .where(eq(clinicalNoteDiagnoses.clinicalNoteId, note.id))
    .orderBy(asc(clinicalNoteDiagnoses.position))
    .all()
    .map((row) => row.diagnosisText);
  return {
    id: note.id,
    visitId: note.visitId,
    version: note.version,
    subjective: note.subjective,
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan,
    diagnoses,
    sourceDraftRevision: note.sourceDraftRevision,
    revisionReason: null,
    supersedesId: null,
    signedBy: { id: note.signedBy, displayName: note.signedByDisplayName },
    signedAt: note.signedAt,
    contentHash: note.contentHash,
  };
}

function toAmendment(amendment: typeof clinicalNoteAmendments.$inferSelect): ClinicalNoteAmendmentDto {
  return {
    id: amendment.id,
    clinicalNoteId: amendment.clinicalNoteId,
    version: amendment.version,
    content: amendment.content,
    reason: amendment.reason,
    signedBy: { id: amendment.signedBy, displayName: amendment.signedByDisplayName },
    signedAt: amendment.signedAt,
    contentHash: amendment.contentHash,
  };
}

export interface VisitCompletionWorkflow {
  /** Presence-only Closure evidence for Journey; never returns Closure/OPD data. */
  hasClosure(visitId: string): boolean;
  closeVisit(
    tx: AuditedTransaction,
    actor: Actor,
    visitId: string,
    command: CloseVisitBody,
  ): VisitClosureDto;
  replayClose(tx: AuditedTransaction, reference: ClosureReplayReference): VisitClosureDto;
  getOpdCard(actor: Actor, visitId: string): OpdCardDto;
}

export interface VisitCompletionWorkflowOptions {
  database: DatabaseHandle;
  visits: VisitService;
  finance: FinanceService;
  notes: NoteService;
  medications: MedicationService;
  fulfillment: FulfillmentService;
  clock?: () => Date;
  idFactory?: () => string;
  /** Focused test seam: proves inserted Closure rolls back when transition work fails. */
  beforeVisitCloseTransition?: () => void;
  /** Focused test seam for each write in the caller-owned close transaction. */
  failureInjector?: (stage: VisitCloseWriteStage) => void;
}

export function createVisitCompletionWorkflow(
  input: VisitCompletionWorkflowOptions,
): VisitCompletionWorkflow {
  const clock = input.clock ?? (() => new Date());
  const idFactory = input.idFactory ?? randomUUID;

  return {
    hasClosure(visitId) {
      return !!input.database.db.select({ id: visitClosures.id })
        .from(visitClosures)
        .where(eq(visitClosures.visitId, visitId))
        .get();
    },

    closeVisit(tx, actor, visitId, command) {
      requirePermission(actor, "visit:close");
      const context = tx.select({ visit: visits, clinic: clinicConfig, patient: patients })
        .from(visits)
        .innerJoin(clinicConfig, eq(clinicConfig.id, visits.clinicId))
        .innerJoin(patients, eq(patients.id, visits.patientId))
        .where(eq(visits.id, visitId))
        .get();
      if (!context) return notFound();
      if (context.visit.revision !== command.expectedRevisions.visit) {
        throw new ApiError({
          code: "REVISION_CONFLICT",
          messageTh: "Visit ถูกเปลี่ยนแปลงแล้ว",
          currentRevisions: { visit: context.visit.revision },
        });
      }
      if (context.visit.status !== "READY_TO_CLOSE") closeBlocked("visitState");

      const financeValidation = input.finance.getCloseEvidence(tx, visitId);
      if (financeValidation.kind === "CHARGE_ABSENT" || financeValidation.kind === "CHARGE_INVALID") {
        closeBlocked("charge");
      }
      if (financeValidation.kind === "RESOLUTION_INVALID") closeBlocked("collection");
      const finance = financeValidation.evidence;
      if (finance.charge.id !== command.payload.chargeId) closeBlocked("charge");

      let paymentId: string | null = null;
      let waiverAdjustmentId: string | null = null;
      if (command.payload.resolution.kind === "PAYMENT") {
        if (
          !finance.payment ||
          finance.adjustment ||
          finance.payment.id !== command.payload.resolution.paymentId ||
          finance.payment.amountBaht !== finance.netDueBaht ||
          finance.netDueBaht < 1
        ) {
          closeBlocked("collection");
        }
        paymentId = finance.payment.id;
      } else {
        if (
          !finance.adjustment ||
          finance.payment ||
          finance.adjustment.id !== command.payload.resolution.waiverAdjustmentId ||
          finance.adjustment.amountBaht !== -finance.grossTotalBaht ||
          finance.netDueBaht !== 0
        ) {
          closeBlocked("collection");
        }
        waiverAdjustmentId = finance.adjustment.id;
      }

      const note = tx.select().from(clinicalNotes)
        .where(eq(clinicalNotes.visitId, visitId))
        .orderBy(desc(clinicalNotes.version))
        .get();
      if (!note || toSignedNote(tx, note).diagnoses.length === 0) closeBlocked("visitState");
      const decision = tx.select().from(medicationDecisions)
        .where(and(
          eq(medicationDecisions.id, finance.charge.medicationDecisionId),
          eq(medicationDecisions.visitId, visitId),
        ))
        .get();
      if (
        !decision ||
        decision.version !== finance.charge.medicationDecisionVersion ||
        decision.kind !== finance.charge.sourceKind
      ) {
        closeBlocked("charge");
      }
      if (finance.charge.sourceKind === "ORDER") {
        const dispense = finance.charge.fulfillmentDispenseId === null ? undefined : tx.select()
          .from(fulfillmentDispenses)
          .where(eq(fulfillmentDispenses.id, finance.charge.fulfillmentDispenseId))
          .get();
        if (
          !dispense ||
          dispense.visitId !== visitId ||
          dispense.medicationDecisionId !== decision.id ||
          dispense.medicationDecisionVersion !== decision.version
        ) {
          closeBlocked("visitState");
        }
      } else if (finance.charge.fulfillmentDispenseId !== null) {
        closeBlocked("visitState");
      }
      const pendingPreparation = tx.select({ id: fulfillmentPreparations.id })
        .from(fulfillmentPreparations)
        .where(and(eq(fulfillmentPreparations.visitId, visitId), eq(fulfillmentPreparations.status, "ACTIVE")))
        .get();
      const activeReservation = tx.select({ id: inventoryReservations.id })
        .from(inventoryReservations)
        .where(and(eq(inventoryReservations.visitId, visitId), eq(inventoryReservations.status, "ACTIVE")))
        .get();
      if (pendingPreparation || activeReservation) closeBlocked("visitState");

      const closureBase = {
        id: idFactory(),
        clinicId: context.visit.clinicId,
        visitId: context.visit.id,
        visitRevision: context.visit.revision,
        chargeId: finance.charge.id,
        paymentId,
        waiverAdjustmentId,
        clinicNameSnapshot: context.clinic.name,
        patientIdSnapshot: context.patient.id,
        patientHnSnapshot: context.patient.hn,
        patientDisplayNameSnapshot: context.patient.displayName,
        patientBirthDateSnapshot: context.patient.birthDate,
        patientSexSnapshot: context.patient.sex,
        doctorIdSnapshot: actor.id,
        doctorDisplayNameSnapshot: actor.displayName,
        closedAt: clock().toISOString(),
      } as const;
      const closure = { ...closureBase, contentHash: closureHash(closureBase) };
      tx.insert(visitClosures).values(closure).run();
      input.failureInjector?.("AFTER_CLOSURE_INSERT");
      input.beforeVisitCloseTransition?.();
      const changed = tx.update(visits)
        .set({
          status: "CLOSED",
          revision: context.visit.revision + 1,
          closedAt: closure.closedAt,
        })
        .where(and(
          eq(visits.id, context.visit.id),
          eq(visits.status, "READY_TO_CLOSE"),
          eq(visits.revision, context.visit.revision),
        ))
        .run();
      if (changed.changes !== 1) {
        const current = tx.select().from(visits).where(eq(visits.id, context.visit.id)).get();
        if (current && current.revision !== context.visit.revision) {
          throw new ApiError({
            code: "REVISION_CONFLICT",
            messageTh: "Visit ถูกเปลี่ยนแปลงแล้ว",
            currentRevisions: { visit: current.revision },
          });
        }
        closeBlocked("visitState");
      }
      input.failureInjector?.("AFTER_VISIT_TRANSITION");
      appendAuditEvent({
        tx,
        actor,
        id: idFactory(),
        action: "visit.closed",
        entityType: "visit",
        entityId: context.visit.id,
        entityRevision: context.visit.revision + 1,
        reason: null,
        occurredAt: closure.closedAt,
        metadata: {
          chargeId: closure.chargeId,
          ...(paymentId ? { paymentId } : { waiverAdjustmentId }),
          closureId: closure.id,
          previousStatus: "READY_TO_CLOSE",
          nextStatus: "CLOSED",
        },
      });
      input.failureInjector?.("AFTER_AUDIT_APPEND");
      const closedVisit = tx.select().from(visits).where(eq(visits.id, context.visit.id)).get();
      if (!closedVisit) throw new Error("Closed Visit was not persisted");
      return toClosureDto(closure, closedVisit);
    },

    replayClose(tx, reference) {
      const closure = tx.select().from(visitClosures)
        .where(and(eq(visitClosures.id, reference.closureId), eq(visitClosures.visitId, reference.visitId)))
        .get();
      const visit = tx.select().from(visits).where(eq(visits.id, reference.visitId)).get();
      if (!closure || !visit || closure.contentHash !== closureHash(closure)) {
        throw new Error("Idempotency Visit Closure reference does not match immutable evidence");
      }
      return toClosureDto(closure, visit);
    },

    getOpdCard(actor, visitId) {
      requirePermission(actor, "opd:read");
      const context = input.database.db.select({ closure: visitClosures, visit: visits })
        .from(visitClosures)
        .innerJoin(visits, eq(visits.id, visitClosures.visitId))
        .where(eq(visitClosures.visitId, visitId))
        .get();
      if (
        !context ||
        context.visit.status !== "CLOSED" ||
        context.visit.closedAt !== context.closure.closedAt ||
        context.closure.contentHash !== closureHash(context.closure)
      ) {
        opdNotReady();
      }
      const financeValidation = input.finance.getCloseEvidence(input.database.db, visitId);
      if (financeValidation.kind !== "VALID") opdNotReady();
      const finance = financeValidation.evidence;
      if (finance.charge.id !== context.closure.chargeId) opdNotReady();
      const closureResolution = context.closure.paymentId !== null
        ? finance.payment && !finance.adjustment && finance.payment.id === context.closure.paymentId
        : context.closure.waiverAdjustmentId !== null && finance.adjustment && !finance.payment && finance.adjustment.id === context.closure.waiverAdjustmentId;
      if (!closureResolution) opdNotReady();

      const note = input.database.db.select().from(clinicalNotes)
        .where(eq(clinicalNotes.visitId, visitId))
        .orderBy(desc(clinicalNotes.version))
        .get();
      if (!note) opdNotReady();
      const signedNote = toSignedNote(input.database.db, note);
      if (signedNote.diagnoses.length === 0) opdNotReady();
      const amendments = input.database.db.select().from(clinicalNoteAmendments)
        .where(eq(clinicalNoteAmendments.clinicalNoteId, note.id))
        .orderBy(asc(clinicalNoteAmendments.version))
        .all()
        .map(toAmendment);
      const decision = input.database.db.select().from(medicationDecisions)
        .where(and(
          eq(medicationDecisions.id, finance.charge.medicationDecisionId),
          eq(medicationDecisions.visitId, visitId),
        ))
        .get();
      if (!decision || decision.version !== finance.charge.medicationDecisionVersion) opdNotReady();
      const decisionEvidence = {
        id: decision.id,
        version: decision.version,
        signedAt: decision.signedAt,
        contentHash: decision.contentHash,
      };
      const medication = decision.kind === "ORDER" ? (() => {
        if (!finance.charge.fulfillmentDispenseId) return opdNotReady();
        const dispense = input.database.db.select().from(fulfillmentDispenses)
          .where(eq(fulfillmentDispenses.id, finance.charge.fulfillmentDispenseId))
          .get();
        if (
          !dispense ||
          dispense.visitId !== visitId ||
          dispense.medicationDecisionId !== decision.id ||
          dispense.medicationDecisionVersion !== decision.version
        ) {
          return opdNotReady();
        }
        const items = input.database.db.select().from(fulfillmentDispenseLines)
          .where(eq(fulfillmentDispenseLines.dispenseId, dispense.id))
          .orderBy(asc(fulfillmentDispenseLines.id))
          .all()
          .map((line) => ({
            dispenseLineId: line.id,
            orderItemId: line.medicationOrderItemId,
            displayName: line.displayNameSnapshot,
            strengthText: line.strengthSnapshot,
            dosageFormText: line.dosageFormSnapshot,
            quantity: line.quantity,
            unit: line.unitSnapshot,
            directionsTh: line.directionsThSnapshot,
            lotNumber: line.lotNumberSnapshot,
            expiryDate: line.expiryDateSnapshot,
          }));
        if (items.length === 0) return opdNotReady();
        return { kind: "ORDER" as const, decision: decisionEvidence, dispense: { id: dispense.id, handedOffAt: dispense.handedOffAt }, items };
      })() : (() => {
        if (finance.charge.fulfillmentDispenseId !== null || !decision.noMedicationReason) return opdNotReady();
        return { kind: "NO_MEDICATION" as const, decision: decisionEvidence, noMedicationReason: decision.noMedicationReason, items: [] as [] };
      })();
      const observation = input.database.db.select().from(intakeObservations)
        .where(eq(intakeObservations.visitId, visitId))
        .get();
      if (!observation) opdNotReady();
      const closure = toClosureDto(context.closure, context.visit);
      const lines = input.database.db.select().from(financeChargeLines)
        .where(eq(financeChargeLines.chargeId, finance.charge.id))
        .orderBy(asc(financeChargeLines.position), asc(financeChargeLines.id))
        .all()
        .map((line) => ({
          id: line.id,
          position: line.position,
          lineType: line.lineType,
          descriptionSnapshot: line.descriptionSnapshot,
          quantity: line.quantity,
          unitPriceBaht: line.unitPriceBaht,
          lineTotalBaht: line.lineTotalBaht,
          medicationOrderItemId: line.medicationOrderItemId,
          fulfillmentDispenseLineId: line.fulfillmentDispenseLineId,
        }));
      const resolution = finance.payment ? {
        kind: "PAYMENT" as const,
        paymentId: finance.payment.id,
        method: finance.payment.method,
        amountBaht: finance.payment.amountBaht,
        manualReference: finance.payment.manualReference,
        confirmedBy: { id: finance.payment.confirmedBy, displayName: finance.payment.confirmedByDisplayName },
        confirmedAt: finance.payment.confirmedAt,
        contentHash: finance.payment.contentHash,
      } : finance.adjustment ? {
        kind: "COLLECTION_NOT_REQUIRED" as const,
        waiverAdjustmentId: finance.adjustment.id,
        amountBaht: finance.adjustment.amountBaht,
        reason: finance.adjustment.reason,
        approvedBy: { id: finance.adjustment.approvedBy, displayName: finance.adjustment.approvedByDisplayName },
        approvedAt: finance.adjustment.approvedAt,
        contentHash: finance.adjustment.contentHash,
      } : opdNotReady();
      return {
        syntheticOnly: true,
        closure,
        visit: {
          id: context.visit.id,
          chiefComplaint: context.visit.chiefComplaint,
          arrivedAt: context.visit.arrivedAt,
          startedAt: context.visit.startedAt,
          closedAt: context.visit.closedAt!,
          vitals: {
            weightKg: observation.weightKg,
            heightCm: observation.heightCm,
            temperatureC: observation.temperatureC,
            systolicMmhg: observation.systolicMmhg,
            diastolicMmhg: observation.diastolicMmhg,
            heartRateBpm: observation.heartRateBpm,
            spo2Percent: observation.spo2Percent,
          },
        },
        clinicalNote: signedNote,
        amendments,
        medication,
        charge: {
          id: finance.charge.id,
          sourceKind: finance.charge.sourceKind,
          currency: finance.charge.currency,
          lines,
          grossTotalBaht: finance.grossTotalBaht,
          adjustmentTotalBaht: finance.adjustmentTotalBaht,
          netDueBaht: finance.netDueBaht,
          resolution,
          contentHash: finance.charge.contentHash,
        },
      };
    },
  };
}
