import { z } from "zod";

const invalidPrototypeKey = Symbol("invalid-prototype-key");

function hasOwnPrototypeKey(value: unknown, seen = new Set<object>()): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null) continue;
    if (Object.prototype.hasOwnProperty.call(current, "__proto__")) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    const record = current as Record<string, unknown>;
    for (const key of Object.keys(record)) pending.push(record[key]);
  }
  return false;
}

function rejectOwnPrototypeKeys<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (hasOwnPrototypeKey(value) ? invalidPrototypeKey : value),
    schema,
  );
}

export interface Actor {
  id: string;
  role: "assistant" | "doctor";
  displayName: string;
}

export const roleSchema = z.enum(["assistant", "doctor"]);
export const permissionSchema = z.enum([
  "patient:read",
  "patient:create-synthetic",
  "visit:submit-intake",
  "visit:read-queue",
  "visit:start-consultation",
  "patient:update-allergy",
  "clinical:read",
  "clinical:save-draft",
  "clinical:sign",
  "clinical:amend",
  "medication:read-catalog",
  "medication:sign-decision",
  "inventory:read",
  "inventory:receive",
  "inventory:reserve",
  "fulfillment:read",
  "fulfillment:prepare",
  "label:print",
  "fulfillment:release",
  "fulfillment:handoff",
  "inventory:quarantine",
  "inventory:release-quarantine",
  "inventory:adjust",
  "finance:read",
  "finance:finalize-charge",
  "finance:record-cash",
  "finance:confirm-promptpay",
  "finance:waive",
  "visit:close",
  "opd:read",
]);

export const loginBodySchema = z.strictObject({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const sessionDtoSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1),
    username: z.string().min(1),
    displayName: z.string().min(1),
    role: roleSchema,
  }),
  clinic: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  permissions: z.array(permissionSchema),
  pilotAcknowledgedAt: z.string().datetime().nullable(),
  mustChangePassword: z.boolean(),
  idleExpiresAt: z.string().datetime(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const sessionResponseSchema = z.strictObject({ data: sessionDtoSchema });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const pilotAcknowledgementBodySchema = z.strictObject({ accepted: z.literal(true) });
export type PilotAcknowledgementBody = z.infer<typeof pilotAcknowledgementBodySchema>;

export const changePasswordBodySchema = z.strictObject({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;

export const createSyntheticPatientBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({}),
    payload: z.strictObject({}),
  }),
);
export type CreateSyntheticPatientBody = z.infer<typeof createSyntheticPatientBodySchema>;

export const patientSchema = z.strictObject({
  id: z.string().min(1),
  hn: z.string().regex(/^DEMO-[0-9]{6}$/),
  displayName: z.string().min(1),
  phone: z.string().regex(/^000000[0-9]{4}$/),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["female", "male", "unknown"]),
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(),
});
export type PatientDto = z.infer<typeof patientSchema>;

export const patientCommandResponseSchema = z.strictObject({
  data: patientSchema,
  replayed: z.boolean(),
});
export type PatientCommandResponse = z.infer<typeof patientCommandResponseSchema>;

export const patientSearchQuerySchema = z.strictObject({
  q: z.string()
    .trim()
    .refine(
      (value) => {
        const length = Array.from(value).length;
        return length >= 2 && length <= 80;
      },
      { message: "คำค้นหาต้องมี 2–80 ตัวอักษร" },
    ),
});
export type PatientSearchQuery = z.infer<typeof patientSearchQuerySchema>;

export const patientSearchResponseSchema = z.strictObject({
  data: z.array(patientSchema),
});
export type PatientSearchResponse = z.infer<typeof patientSearchResponseSchema>;

export const medicationSchema = z.strictObject({
  id: z.string().regex(/^DEMO-MED-\d{3}$/),
  displayName: z.string().min(1).max(200),
  strengthText: z.string().min(1).max(100),
  dosageFormText: z.string().min(1).max(100),
  canonicalUnit: z.string().min(1).max(100),
  internalBarcode: z.string().regex(/^[!-~]{1,64}$/),
  revision: z.number().int().min(1),
});
export type MedicationDto = z.infer<typeof medicationSchema>;

export const consultationFeeBahtSchema = z.number().int().safe().min(1).max(1_000_000);
export const unitPriceBahtSchema = z.number().int().safe().min(0).max(1_000_000);
export const priceSnapshotSchema = z.strictObject({
  unitPriceBaht: unitPriceBahtSchema,
  currency: z.literal("THB"),
  sourceMedicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  sourceMedicationRevision: z.number().int().safe().min(1),
});
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;

const financeIdSchema = z.string().trim().min(1).max(120);
const financeDisplayNameSchema = z.string().trim().min(1).max(200);
const financeDescriptionSchema = z.string().trim().min(1).max(200);
const financeContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const chargeGrossTotalBahtSchema = z.number().int().safe().min(1).max(100_000_000);

export const checkoutLineSchema = z.strictObject({
  id: financeIdSchema.nullable(),
  position: z.number().int().min(0).max(20),
  lineType: z.enum(["CONSULTATION", "MEDICATION"]),
  descriptionSnapshot: financeDescriptionSchema,
  quantity: z.number().int().min(1).max(999_999),
  unitPriceBaht: unitPriceBahtSchema,
  lineTotalBaht: z.number().int().safe().min(0).max(100_000_000),
  medicationOrderItemId: financeIdSchema.nullable(),
  fulfillmentDispenseLineId: financeIdSchema.nullable(),
}).superRefine((line, context) => {
  if (line.lineTotalBaht !== line.quantity * line.unitPriceBaht) {
    context.addIssue({ code: "custom", path: ["lineTotalBaht"], message: "ยอดรวมรายการต้องเท่ากับจำนวนคูณราคาต่อหน่วย" });
  }
  if (
    (line.lineType === "CONSULTATION" && (
      line.position !== 0 ||
      line.quantity !== 1 ||
      line.medicationOrderItemId !== null ||
      line.fulfillmentDispenseLineId !== null
    )) ||
    (line.lineType === "MEDICATION" && (
      line.position < 1 ||
      line.medicationOrderItemId === null ||
      line.fulfillmentDispenseLineId === null
    ))
  ) {
    context.addIssue({ code: "custom", path: ["lineType"], message: "หลักฐานรายการคิดเงินไม่สอดคล้องกัน" });
  }
});
export type CheckoutLineDto = z.infer<typeof checkoutLineSchema>;

export const checkoutChargeSchema = z.strictObject({
  id: financeIdSchema,
  sourceKind: z.enum(["ORDER", "NO_MEDICATION"]),
  medicationDecisionId: financeIdSchema,
  medicationDecisionVersion: z.number().int().min(1),
  fulfillmentDispenseId: financeIdSchema.nullable(),
  clinicPricingRevision: z.number().int().min(1),
  consultationFeeBahtSnapshot: consultationFeeBahtSchema,
  currency: z.literal("THB"),
  lineCount: z.number().int().min(1).max(21),
  finalizedBy: z.strictObject({ id: financeIdSchema, displayName: financeDisplayNameSchema }),
  finalizedAt: z.string().datetime(),
});
export type CheckoutChargeDto = z.infer<typeof checkoutChargeSchema>;

export const collectionStateSchema = z.enum([
  "PENDING_CHARGE",
  "AWAITING_COLLECTION",
  "PAID_CASH",
  "PAID_PROMPTPAY",
  "COLLECTION_NOT_REQUIRED",
  "CLOSED",
]);
export const checkoutAllowedActionSchema = z.enum([
  "FINALIZE_CHARGE",
  "APPROVE_FULL_WAIVER",
  "RECORD_CASH",
  "CONFIRM_PROMPTPAY",
  "CLOSE_VISIT",
  "READ_OPD",
]);
export const checkoutCloseBlockerSchema = z.enum(["charge", "collection", "visitState"]);

/** Safe finance identity required for a Doctor to pin an eventual close command. */
export const financeResolutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("PENDING_CHARGE") }),
  z.strictObject({ kind: z.literal("PENDING_COLLECTION"), chargeId: financeIdSchema, netDueBaht: chargeGrossTotalBahtSchema }),
  z.strictObject({ kind: z.literal("COLLECTION_NOT_REQUIRED"), adjustmentId: financeIdSchema }),
  z.strictObject({ kind: z.literal("PAYMENT"), paymentId: financeIdSchema, method: z.enum(["CASH", "PROMPTPAY"]) }),
]);
export type FinanceResolution = z.infer<typeof financeResolutionSchema>;

export const checkoutDtoSchema = z.strictObject({
  patient: z.strictObject({
    id: financeIdSchema,
    hn: z.string().regex(/^DEMO-[0-9]{6}$/),
    displayName: financeDisplayNameSchema,
    birthDate: z.iso.date(),
    sex: z.enum(["female", "male", "unknown"]),
  }),
  visit: z.strictObject({
    id: financeIdSchema,
    status: z.enum([
      "WAITING",
      "CONSULTING",
      "AWAITING_PREPARATION",
      "PREPARING",
      "AWAITING_RELEASE",
      "AWAITING_HANDOFF",
      "AWAITING_ORDER_REVISION",
      "AWAITING_CHARGE",
      "AWAITING_PAYMENT",
      "READY_TO_CLOSE",
      "CLOSED",
    ]),
    revision: z.number().int().min(1),
    arrivedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime().nullable(),
  }),
  clinicPricingRevision: z.number().int().safe().min(1),
  sourceKind: z.enum(["ORDER", "NO_MEDICATION"]),
  charge: checkoutChargeSchema.nullable(),
  lines: z.array(checkoutLineSchema).min(1).max(21),
  grossTotalBaht: chargeGrossTotalBahtSchema,
  adjustmentTotalBaht: z.number().int().safe().min(-100_000_000).max(0),
  netDueBaht: z.number().int().safe().min(0).max(100_000_000),
  collectionState: collectionStateSchema,
  /** Never clinical: only the immutable financial ID necessary to close a resolved Visit. */
  resolution: financeResolutionSchema.optional(),
  allowedActions: z.array(checkoutAllowedActionSchema),
  closeBlockers: z.array(checkoutCloseBlockerSchema),
});
export type CheckoutDto = z.infer<typeof checkoutDtoSchema>;

const waiverReasonSchema = z.string().trim().min(1).max(500);

export const finalizeChargeBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({
      visit: z.number().int().min(1),
      clinicPricing: z.number().int().min(1),
    }),
    payload: z.discriminatedUnion("settlementIntent", [
      z.strictObject({ settlementIntent: z.literal("COLLECT") }),
      z.strictObject({
        settlementIntent: z.literal("FULL_WAIVER"),
        waiverReason: waiverReasonSchema,
      }),
    ]),
  }),
);
export type FinalizeChargeBody = z.infer<typeof finalizeChargeBodySchema>;

export const finalizeChargeResponseSchema = z.strictObject({
  data: checkoutDtoSchema,
  replayed: z.boolean(),
});
export type FinalizeChargeResponse = z.infer<typeof finalizeChargeResponseSchema>;

const collectionExpectedRevisionsSchema = z.strictObject({
  visit: z.number().int().safe().min(1),
});
const paymentAmountBahtSchema = z.number().int().safe().min(1).max(100_000_000);
const manualPromptPayReferenceSchema = z.string().trim().min(1).max(100);

export const approveFullWaiverBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: collectionExpectedRevisionsSchema,
    payload: z.strictObject({
      chargeId: financeIdSchema,
      reason: waiverReasonSchema,
    }),
  }),
);
export type ApproveFullWaiverBody = z.infer<typeof approveFullWaiverBodySchema>;

export const recordCashBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: collectionExpectedRevisionsSchema,
    payload: z.strictObject({
      chargeId: financeIdSchema,
      amountBaht: paymentAmountBahtSchema,
    }),
  }),
);
export type RecordCashBody = z.infer<typeof recordCashBodySchema>;

export const confirmPromptPayBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: collectionExpectedRevisionsSchema,
    payload: z.strictObject({
      chargeId: financeIdSchema,
      amountBaht: paymentAmountBahtSchema,
      manualReference: manualPromptPayReferenceSchema,
    }),
  }),
);
export type ConfirmPromptPayBody = z.infer<typeof confirmPromptPayBodySchema>;

export const collectionResponseSchema = z.strictObject({
  data: checkoutDtoSchema,
  replayed: z.boolean(),
});
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;

export const medicationSearchQuerySchema = z.strictObject({
  q: z.string()
    .trim()
    .refine(
      (value) => {
        const length = Array.from(value).length;
        return length >= 2 && length <= 80;
      },
      { message: "คำค้นหาต้องมี 2–80 ตัวอักษร" },
    ),
});
export type MedicationSearchQuery = z.infer<typeof medicationSearchQuerySchema>;

export const medicationSearchResponseSchema = z.strictObject({
  data: z.array(medicationSchema).max(20),
});
export type MedicationSearchResponse = z.infer<typeof medicationSearchResponseSchema>;

export const inventoryStatusSchema = z.enum(["OK", "LOW", "OUT", "EXPIRED", "RESERVED"]);
export type InventoryStatus = z.infer<typeof inventoryStatusSchema>;

export const inventoryLotSchema = z.strictObject({
  id: z.string().min(1),
  medicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  medicationRevision: z.number().int().min(1),
  revision: z.number().int().min(1),
  displayNameSnapshot: z.string().min(1).max(200),
  strengthSnapshot: z.string().min(1).max(100),
  dosageFormSnapshot: z.string().min(1).max(100),
  unitSnapshot: z.string().min(1).max(100),
  lotNumber: z.string().min(1).max(100),
  expiryDate: z.iso.date(),
  supplierName: z.string().min(1).max(200),
  status: z.enum(["AVAILABLE", "QUARANTINED"]),
  createdAt: z.string().datetime(),
  createdBy: z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) }),
});
export type InventoryLotDto = z.infer<typeof inventoryLotSchema>;

export const inventoryLotMovementSchema = z.strictObject({
  id: z.string().min(1),
  lotId: z.string().min(1),
  movementType: z.enum(["RECEIPT", "DISPENSE", "ADJUSTMENT"]),
  quantityDelta: z.number().int().min(-999_999).max(999_999).refine((value) => value !== 0),
  sourceType: z.enum(["RECEIPT", "DISPENSE", "ADJUSTMENT"]),
  sourceId: z.string().min(1),
  occurredAt: z.string().datetime(),
});
export type InventoryLotMovementDto = z.infer<typeof inventoryLotMovementSchema>;

export const inventoryLotBalanceSchema = inventoryLotSchema.extend({
  onHand: z.number().int().min(0),
  reserved: z.number().int().min(0),
  available: z.number().int().min(0),
  latestMovementId: z.string().min(1).nullable(),
  recentMovements: z.array(inventoryLotMovementSchema).max(20),
});
export type InventoryLotBalanceDto = z.infer<typeof inventoryLotBalanceSchema>;

export const inventoryLotsResponseSchema = z.strictObject({
  data: z.array(inventoryLotBalanceSchema),
});
export type InventoryLotsResponse = z.infer<typeof inventoryLotsResponseSchema>;

export const inventorySummarySchema = z.strictObject({
  medication: medicationSchema,
  onHand: z.number().int().min(0),
  reserved: z.number().int().min(0),
  available: z.number().int().min(0),
  lotCount: z.number().int().min(0),
  nearestExpiry: z.iso.date().nullable(),
  status: inventoryStatusSchema,
});
export type InventorySummaryDto = z.infer<typeof inventorySummarySchema>;

export const inventoryReceiptSchema = z.strictObject({
  id: z.string().min(1),
  supplierName: z.string().min(1).max(200),
  note: z.string().max(500),
  receivedAt: z.string().datetime(),
  receivedBy: z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) }),
  medication: medicationSchema,
  lot: inventoryLotSchema,
  quantity: z.number().int().min(1).max(999_999),
  unit: z.string().min(1).max(100),
  inventory: inventorySummarySchema,
});
export type InventoryReceiptDto = z.infer<typeof inventoryReceiptSchema>;

export const inventoryResponseSchema = z.strictObject({
  data: z.array(inventorySummarySchema),
});
export type InventoryResponse = z.infer<typeof inventoryResponseSchema>;

export const inventoryMedicationSearchResponseSchema = z.strictObject({
  data: z.array(medicationSchema).max(20),
});
export type InventoryMedicationSearchResponse = z.infer<typeof inventoryMedicationSearchResponseSchema>;

export const receiveInventoryPayloadSchema = z.strictObject({
  medicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  quantity: z.number().int().min(1).max(999_999),
  lotNumber: z.string().trim().min(1).max(100),
  expiryDate: z.iso.date(),
  supplierName: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500),
});
export type ReceiveInventoryPayload = z.infer<typeof receiveInventoryPayloadSchema>;

export const receiveInventoryBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ medication: z.number().int().min(1) }),
    payload: receiveInventoryPayloadSchema,
  }),
);
export type ReceiveInventoryBody = z.infer<typeof receiveInventoryBodySchema>;

export const receiveInventoryResponseSchema = z.strictObject({
  data: inventoryReceiptSchema,
  replayed: z.boolean(),
});
export type ReceiveInventoryResponse = z.infer<typeof receiveInventoryResponseSchema>;

const inventoryIntegrityReasonSchema = z.string().trim().min(1).max(500);
const inventoryLotExpectedRevisionSchema = z.strictObject({ lot: z.number().int().min(1) });

export const quarantineInventoryLotBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: inventoryLotExpectedRevisionSchema,
  payload: z.strictObject({ reason: inventoryIntegrityReasonSchema }),
}));
export type QuarantineInventoryLotBody = z.infer<typeof quarantineInventoryLotBodySchema>;

export const adjustInventoryLotBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: inventoryLotExpectedRevisionSchema,
  payload: z.strictObject({
    correctsMovementId: z.string().trim().min(1).max(120),
    quantityDelta: z.number().int().min(-999_999).max(999_999).refine((value) => value !== 0, "จำนวนที่ปรับต้องไม่เป็นศูนย์"),
    reason: inventoryIntegrityReasonSchema,
  }),
}));
export type AdjustInventoryLotBody = z.infer<typeof adjustInventoryLotBodySchema>;

export const inventoryLotCommandResponseSchema = z.strictObject({
  data: inventoryLotBalanceSchema,
  replayed: z.boolean(),
});
export type InventoryLotCommandResponse = z.infer<typeof inventoryLotCommandResponseSchema>;

export const inventoryReservationStatusSchema = z.enum(["ACTIVE", "RELEASED", "CONSUMED"]);
export type InventoryReservationStatus = z.infer<typeof inventoryReservationStatusSchema>;

const inventoryReservationStaffSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
});

export const inventoryReservationAllocationSchema = z.strictObject({
  id: z.string().min(1),
  reservationId: z.string().min(1),
  medicationOrderItemId: z.string().min(1),
  medicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  lotId: z.string().min(1),
  position: z.number().int().min(0),
  quantity: z.number().int().min(1).max(999_999),
  lotNumberSnapshot: z.string().trim().min(1).max(100),
  expiryDateSnapshot: z.iso.date(),
  unitSnapshot: z.string().min(1).max(100),
  allocatedAt: z.string().datetime(),
});
export type InventoryReservationAllocationDto = z.infer<typeof inventoryReservationAllocationSchema>;

const inventoryReservationBaseSchema = z.strictObject({
  id: z.string().min(1),
  clinicId: z.string().min(1),
  visitId: z.string().min(1),
  medicationDecisionId: z.string().min(1),
  medicationDecisionVersion: z.number().int().min(1),
  createdAt: z.string().datetime(),
  createdBy: inventoryReservationStaffSchema,
  allocations: z.array(inventoryReservationAllocationSchema),
});
export const inventoryReservationSchema = z.discriminatedUnion("status", [
  inventoryReservationBaseSchema.extend({
    status: z.literal("ACTIVE"),
    releasedAt: z.null(),
    releasedBy: z.null(),
    releaseReason: z.null(),
  }),
  inventoryReservationBaseSchema.extend({
    status: z.literal("RELEASED"),
    releasedAt: z.string().datetime(),
    releasedBy: inventoryReservationStaffSchema,
    releaseReason: requiredClinicalText(500),
  }),
  inventoryReservationBaseSchema.extend({
    status: z.literal("CONSUMED"),
    releasedAt: z.null(),
    releasedBy: z.null(),
    releaseReason: z.null(),
  }),
]);
export type InventoryReservationDto = z.infer<typeof inventoryReservationSchema>;

export const reserveInventoryBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ visit: z.number().int().min(1), medicationDecision: z.number().int().min(1) }),
    payload: z.strictObject({ labelVersionId: z.string().trim().min(1).max(120) }),
  }),
);
export type ReserveInventoryBody = z.infer<typeof reserveInventoryBodySchema>;

export const releaseInventoryBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ visit: z.number().int().min(1) }),
    payload: z.strictObject({ reason: requiredClinicalText(500) }),
  }),
);
export type ReleaseInventoryBody = z.infer<typeof releaseInventoryBodySchema>;

export const inventoryReservationResponseSchema = z.strictObject({
  data: z.lazy(() => inventoryPickListSchema),
  replayed: z.boolean(),
});
export type InventoryReservationResponse = z.infer<typeof inventoryReservationResponseSchema>;

export const visitStatuses = [
  "WAITING",
  "CONSULTING",
  "AWAITING_PREPARATION",
  "PREPARING",
  "AWAITING_RELEASE",
  "AWAITING_HANDOFF",
  "AWAITING_ORDER_REVISION",
  "AWAITING_CHARGE",
  "AWAITING_PAYMENT",
  "READY_TO_CLOSE",
  "CLOSED",
] as const;

export const visitStatusSchema = z.enum(visitStatuses);
export type VisitStatus = z.infer<typeof visitStatusSchema>;

export const allergyStateSchema = z.enum(["UNKNOWN", "NONE_KNOWN", "PRESENT"]);
export const allergySeveritySchema = z.enum(["UNKNOWN", "MILD", "MODERATE", "SEVERE"]);
export const medicationDecisionDraftKindSchema = z.enum(["UNDECIDED", "ORDER", "NO_MEDICATION"]);
export const medicationDecisionKindSchema = z.enum(["ORDER", "NO_MEDICATION"]);
export type AllergySeverity = z.infer<typeof allergySeveritySchema>;

function requiredClinicalText(maximumLength: number) {
  return z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= maximumLength,
    { message: `ต้องมีความยาวไม่เกิน ${maximumLength} ตัวอักษร` },
  );
}

export const allergyItemSchema = z.strictObject({
  substance: requiredClinicalText(200),
  reaction: requiredClinicalText(300),
  severity: allergySeveritySchema,
  note: requiredClinicalText(500).nullable(),
});

const intakeAllergyChangeReasonSchema = requiredClinicalText(500).nullable();

export const intakeAllergyAnswerSchema = z.discriminatedUnion("answer", [
  z.strictObject({
    answer: z.literal("NO"),
    items: z.tuple([]),
    changeReason: intakeAllergyChangeReasonSchema,
  }),
  z.strictObject({
    answer: z.literal("YES"),
    items: z.array(allergyItemSchema).min(1).max(20),
    changeReason: intakeAllergyChangeReasonSchema,
  }),
]);
export type IntakeAllergyAnswer = z.infer<typeof intakeAllergyAnswerSchema>;

export const allergyAssessmentSchema = z.strictObject({
  id: z.string().min(1).nullable(),
  revision: z.number().int().min(0),
  state: allergyStateSchema,
  items: z.array(allergyItemSchema),
  sourceText: z.string().nullable(),
  reason: z.string().nullable(),
  reviewedBy: z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) }).nullable(),
  reviewedAt: z.string().datetime().nullable(),
});
export type AllergyAssessmentDto = z.infer<typeof allergyAssessmentSchema>;

export const patientAllergyContextSchema = z.strictObject({
  patient: patientSchema,
  allergy: allergyAssessmentSchema,
});
export type PatientAllergyContextDto = z.infer<typeof patientAllergyContextSchema>;

export const patientAllergyContextResponseSchema = z.strictObject({
  data: patientAllergyContextSchema,
});
export type PatientAllergyContextResponse = z.infer<typeof patientAllergyContextResponseSchema>;

export const visitSummarySchema = z.strictObject({
  id: z.string().min(1),
  status: visitStatusSchema,
  revision: z.number().int().min(1),
  arrivedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
});
export type VisitSummaryDto = z.infer<typeof visitSummarySchema>;

export const reviewAllergyPayloadSchema = rejectOwnPrototypeKeys(
  z.strictObject({
    visitId: z.string().trim().min(1).max(120),
    state: allergyStateSchema,
    items: z.array(allergyItemSchema).max(20),
    sourceText: requiredClinicalText(500),
    reason: requiredClinicalText(500),
  }).superRefine((payload, context) => {
    const expectedLength = payload.state === "PRESENT" ? [1, 20] : [0, 0];
    if (payload.items.length < expectedLength[0] || payload.items.length > expectedLength[1]) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: payload.state === "PRESENT"
          ? "ต้องระบุรายการแพ้อย่างน้อย 1 รายการและไม่เกิน 20 รายการ"
          : "สถานะนี้ต้องไม่มีรายการแพ้",
      });
    }
  }),
);
export type ReviewAllergyPayload = z.infer<typeof reviewAllergyPayloadSchema>;

export const reviewAllergyBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({
      patient: z.number().int().min(1),
      visit: z.number().int().min(1),
    }),
    payload: reviewAllergyPayloadSchema,
  }),
);
export type ReviewAllergyBody = z.infer<typeof reviewAllergyBodySchema>;

export const allergyReviewResultSchema = z.strictObject({
  patient: patientSchema,
  allergy: allergyAssessmentSchema,
  visit: visitSummarySchema,
});
export type AllergyReviewResultDto = z.infer<typeof allergyReviewResultSchema>;

const intakeVitalsSchema = z.strictObject({
  weightKg: z.number().finite().min(1).max(350).nullable(),
  heightCm: z.number().finite().min(30).max(250).nullable(),
  temperatureC: z.number().finite().min(30).max(45).nullable(),
  systolicMmhg: z.number().finite().int().min(50).max(260).nullable(),
  diastolicMmhg: z.number().finite().int().min(30).max(180).nullable(),
  heartRateBpm: z.number().finite().int().min(20).max(250).nullable(),
  spo2Percent: z.number().finite().int().min(50).max(100).nullable(),
});

const intakeVitalsWithRelationshipSchema = intakeVitalsSchema.superRefine((vitals, context) => {
  if (
    vitals.systolicMmhg !== null &&
    vitals.diastolicMmhg !== null &&
    vitals.systolicMmhg < vitals.diastolicMmhg
  ) {
    context.addIssue({
      code: "custom",
      path: ["systolicMmhg"],
      message: "ค่าความดันตัวบนต้องไม่น้อยกว่าค่าความดันตัวล่าง",
    });
  }
});

export const intakePayloadSchema = rejectOwnPrototypeKeys(
  z.strictObject({
    patientId: z.string().trim().min(1).max(120),
    chiefComplaint: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 500, {
        message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
      }),
    vitals: intakeVitalsWithRelationshipSchema,
    allergy: intakeAllergyAnswerSchema,
  }),
);
export type IntakePayload = z.infer<typeof intakePayloadSchema>;

export const submitIntakeBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ patient: z.number().int().min(1) }),
    payload: intakePayloadSchema,
  }),
);
export type SubmitIntakeBody = z.infer<typeof submitIntakeBodySchema>;

const queueVisitSchema = visitSummarySchema;

const queuePatientSchema = patientSchema.pick({
  id: true,
  hn: true,
  displayName: true,
  birthDate: true,
  sex: true,
  revision: true,
});

export const queueItemSchema = z.strictObject({
  visit: queueVisitSchema,
  patient: queuePatientSchema,
  allergy: allergyAssessmentSchema,
  chiefComplaint: z
    .string()
    .min(1)
    .refine((value) => Array.from(value).length <= 500, {
      message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
    }),
  vitals: intakeVitalsSchema,
  allowedActions: z.array(z.enum(["START_CONSULTATION", "REVIEW_ALLERGY", "OPEN_CONSULTATION"])),
});
export type QueueItemDto = z.infer<typeof queueItemSchema>;

export const queueResponseSchema = z.strictObject({
  data: z.array(queueItemSchema),
});
export type QueueResponse = z.infer<typeof queueResponseSchema>;

export const dashboardTodayResponseSchema = z.strictObject({
  data: z.strictObject({
    waiting: z.number().int().min(0),
    consulting: z.number().int().min(0),
    awaitingOrderRevision: z.number().int().min(0),
    awaitingPreparation: z.number().int().min(0),
    preparing: z.number().int().min(0),
    awaitingRelease: z.number().int().min(0),
    awaitingHandoff: z.number().int().min(0),
    awaitingCharge: z.number().int().min(0),
    awaitingPayment: z.number().int().min(0),
    readyToClose: z.number().int().min(0),
    updatedAt: z.string().datetime(),
  }),
});
export type DashboardTodayResponse = z.infer<typeof dashboardTodayResponseSchema>;

export const visitWorkspaceBaseSchema = z.strictObject({
  visit: visitSummarySchema,
  patient: patientSchema,
  intake: z.strictObject({
    id: z.string().min(1),
    chiefComplaint: z
      .string()
      .min(1)
      .refine((value) => Array.from(value).length <= 500, {
        message: "อาการสำคัญต้องมี 1–500 ตัวอักษร",
      }),
    vitals: intakeVitalsSchema,
    recordedAt: z.string().datetime(),
    recordedBy: z.strictObject({ id: z.string().min(1), displayName: z.string().min(1) }),
  }),
});
export type VisitWorkspaceBaseDto = z.infer<typeof visitWorkspaceBaseSchema>;

export const startConsultationBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ visit: z.number().int().min(1) }),
    payload: z.strictObject({}),
  }),
);
export type StartConsultationBody = z.infer<typeof startConsultationBodySchema>;

const draftSoapTextSchema = z.string().refine(
  (value) => Array.from(value).length <= 4000,
  { message: "ข้อความต้องมีความยาวไม่เกิน 4000 ตัวอักษร" },
);

const draftDiagnosisSchema = z.string().trim().min(1).refine(
  (value) => Array.from(value).length <= 300,
  { message: "การวินิจฉัยต้องมี 1–300 ตัวอักษร" },
);

export const clinicalNoteDraftInputSchema = z.strictObject({
  subjective: draftSoapTextSchema,
  objective: draftSoapTextSchema,
  assessment: draftSoapTextSchema,
  plan: draftSoapTextSchema,
  diagnoses: z.array(draftDiagnosisSchema).max(20),
});
export type ClinicalNoteDraftInput = z.infer<typeof clinicalNoteDraftInputSchema>;

const medicationDecisionDraftItemInputSchema = z.strictObject({
  medicationId: z.string().trim().min(1).max(120),
  medicationRevision: z.number().int().min(1),
  quantity: z.number().int().min(1).max(9999),
  directionsTh: z.string().trim().min(1).refine(
    (value) => Array.from(value).length <= 500,
    { message: "คำแนะนำต้องมี 1–500 ตัวอักษร" },
  ),
});

export const medicationDecisionDraftInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("UNDECIDED") }),
  z.strictObject({ kind: z.literal("ORDER"), items: z.array(medicationDecisionDraftItemInputSchema).max(20) }),
  z.strictObject({
    kind: z.literal("NO_MEDICATION"),
    noMedicationReason: z.string().refine(
      (value) => Array.from(value).length <= 500,
      { message: "เหตุผลต้องมีความยาวไม่เกิน 500 ตัวอักษร" },
    ),
  }),
]);
export type MedicationDecisionDraftInput = z.infer<typeof medicationDecisionDraftInputSchema>;

const draftUpdatedBySchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
});

export const clinicalNoteDraftSchema = clinicalNoteDraftInputSchema.extend({
  id: z.string().min(1),
  visitId: z.string().min(1),
  revision: z.number().int().min(1),
  updatedBy: draftUpdatedBySchema,
  updatedAt: z.string().datetime(),
});
export type ClinicalNoteDraftDto = z.infer<typeof clinicalNoteDraftSchema>;

const medicationDecisionDraftBaseSchema = z.strictObject({
  id: z.string().min(1),
  visitId: z.string().min(1),
  revision: z.number().int().min(1),
  updatedBy: draftUpdatedBySchema,
  updatedAt: z.string().datetime(),
});

export const medicationDecisionDraftSchema = z.discriminatedUnion("kind", [
  medicationDecisionDraftBaseSchema.extend({
    kind: z.literal("UNDECIDED"), noMedicationReason: z.null(), items: z.tuple([]),
  }),
  medicationDecisionDraftBaseSchema.extend({
    kind: z.literal("ORDER"),
    noMedicationReason: z.null(),
    items: z.array(z.strictObject({
      medication: medicationSchema,
      quantity: z.number().int().min(1).max(9999),
      directionsTh: z.string().min(1).max(500),
    })),
  }),
  medicationDecisionDraftBaseSchema.extend({
    kind: z.literal("NO_MEDICATION"), noMedicationReason: z.string().max(500), items: z.tuple([]),
  }),
]);
export type MedicationDecisionDraftDto = z.infer<typeof medicationDecisionDraftSchema>;

export const saveConsultationDraftBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({
      visit: z.number().int().min(1),
      noteDraft: z.number().int().min(0),
      medicationDraft: z.number().int().min(0),
    }),
    payload: z.strictObject({
      note: clinicalNoteDraftInputSchema,
      medicationDecision: medicationDecisionDraftInputSchema,
    }),
  }),
);
export type SaveConsultationDraftBody = z.infer<typeof saveConsultationDraftBodySchema>;

export const saveConsultationDraftResponseSchema = z.strictObject({
  data: z.strictObject({ note: clinicalNoteDraftSchema, medicationDecision: medicationDecisionDraftSchema }),
  replayed: z.boolean(),
});
export type SaveConsultationDraftResponse = z.infer<typeof saveConsultationDraftResponseSchema>;

const signedBySchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
});
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const signedClinicalNoteSchema = z.strictObject({
  id: z.string().min(1),
  visitId: z.string().min(1),
  version: z.number().int().min(1),
  subjective: requiredClinicalText(4000),
  objective: requiredClinicalText(4000),
  assessment: requiredClinicalText(4000),
  plan: requiredClinicalText(4000),
  diagnoses: z.array(draftDiagnosisSchema).min(1).max(20),
  sourceDraftRevision: z.number().int().min(1),
  revisionReason: z.string().trim().min(1).max(500).nullable(),
  supersedesId: z.string().min(1).nullable(),
  signedBy: signedBySchema,
  signedAt: z.string().datetime(),
  contentHash: contentHashSchema,
});
export type SignedClinicalNoteDto = z.infer<typeof signedClinicalNoteSchema>;

export const clinicalNoteAmendmentSchema = z.strictObject({
  id: z.string().min(1),
  clinicalNoteId: z.string().min(1),
  version: z.number().int().min(1),
  content: requiredClinicalText(4000),
  reason: requiredClinicalText(500),
  signedBy: signedBySchema,
  signedAt: z.string().datetime(),
  contentHash: contentHashSchema,
});
export type ClinicalNoteAmendmentDto = z.infer<typeof clinicalNoteAmendmentSchema>;

export const signClinicalNoteAmendmentBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({ amendment: z.number().int().min(0) }),
    payload: z.strictObject({ content: requiredClinicalText(4000), reason: requiredClinicalText(500) }),
  }),
);
export type SignClinicalNoteAmendmentBody = z.infer<typeof signClinicalNoteAmendmentBodySchema>;

export const clinicalNoteAmendmentResponseSchema = z.strictObject({
  data: clinicalNoteAmendmentSchema,
  replayed: z.boolean(),
});
export type ClinicalNoteAmendmentResponse = z.infer<typeof clinicalNoteAmendmentResponseSchema>;

const signedMedicationDecisionBaseSchema = z.strictObject({
  id: z.string().min(1),
  visitId: z.string().min(1),
  version: z.number().int().min(1),
  revisionReason: z.string().trim().min(1).max(500).nullable(),
  supersedesId: z.string().min(1).nullable(),
  signedBy: signedBySchema,
  signedAt: z.string().datetime(),
  contentHash: contentHashSchema,
});
const signedMedicationItemSchema = medicationSchema.omit({ internalBarcode: true }).extend({
  /** Stable link back to the immutable medication_order_items row when this DTO comes from the server. */
  orderItemId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(9999),
  directionsTh: requiredClinicalText(500),
});
export const signedMedicationDecisionSchema = z.discriminatedUnion("kind", [
  signedMedicationDecisionBaseSchema.extend({
    kind: z.literal("ORDER"),
    noMedicationReason: z.null(),
    items: z.array(signedMedicationItemSchema).min(1).max(20),
  }),
  signedMedicationDecisionBaseSchema.extend({
    kind: z.literal("NO_MEDICATION"),
    noMedicationReason: requiredClinicalText(500),
    items: z.tuple([]),
  }),
]);
export type SignedMedicationDecisionDto = z.infer<typeof signedMedicationDecisionSchema>;

export const inventoryPickListSchema = z.strictObject({
  visit: visitSummarySchema,
  patient: patientSchema,
  medicationDecision: signedMedicationDecisionSchema,
  reservation: inventoryReservationSchema.nullable(),
  inventory: z.array(inventorySummarySchema),
});
export type InventoryPickListDto = z.infer<typeof inventoryPickListSchema>;

const fulfillmentIdSchema = z.string().trim().min(1).max(120);
const fulfillmentBarcodeSchema = z.string().trim().toUpperCase().regex(/^[!-~]{1,64}$/);
const fulfillmentActorSchema = z.strictObject({
  id: fulfillmentIdSchema,
  displayName: z.string().trim().min(1).max(200),
});
const fulfillmentTextSchema = (maximumLength: number) => z.string().trim().min(1).max(maximumLength);

export const fulfillmentLabelItemSchema = z.strictObject({
  orderItemId: fulfillmentIdSchema,
  medicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  medicationRevision: z.number().int().min(1),
  displayNameSnapshot: z.string().trim().min(1).max(200),
  strengthSnapshot: z.string().trim().min(1).max(100),
  dosageFormSnapshot: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(9999),
  unitSnapshot: z.string().trim().min(1).max(100),
  directionsThSnapshot: z.string().trim().min(1).max(500),
  internalBarcode: fulfillmentBarcodeSchema,
});
export const fulfillmentCurrentLabelSchema = z.strictObject({
  id: fulfillmentIdSchema,
  medicationDecisionId: fulfillmentIdSchema,
  medicationDecisionVersion: z.number().int().min(1),
  version: z.number().int().min(1),
  clinicNameSnapshot: z.string().trim().min(1).max(200),
  patientHnSnapshot: z.string().trim().min(1).max(100),
  patientDisplayNameSnapshot: z.string().trim().min(1).max(200),
  items: z.array(fulfillmentLabelItemSchema).min(1).max(20),
}).nullable();
export type FulfillmentCurrentLabelDto = z.infer<typeof fulfillmentCurrentLabelSchema>;

export const fulfillmentPrintEventSchema = z.strictObject({
  id: fulfillmentIdSchema,
  labelVersionId: fulfillmentIdSchema,
  sequence: z.number().int().min(1),
  requestedAt: z.string().datetime(),
  requestedBy: fulfillmentActorSchema,
  rendererVersion: z.string().trim().min(1).max(100),
  mediaSize: z.literal("80x100mm"),
});
export type FulfillmentPrintEventDto = z.infer<typeof fulfillmentPrintEventSchema>;

export const fulfillmentAllocationReferenceSchema = z.strictObject({
  id: fulfillmentIdSchema,
  orderItemId: fulfillmentIdSchema,
  medicationId: z.string().regex(/^DEMO-MED-\d{3}$/),
  displayNameSnapshot: z.string().trim().min(1).max(200),
  strengthSnapshot: z.string().trim().min(1).max(100),
  dosageFormSnapshot: z.string().trim().min(1).max(100),
  internalBarcode: fulfillmentBarcodeSchema,
  lotId: fulfillmentIdSchema,
  lotNumberSnapshot: z.string().trim().min(1).max(100),
  expiryDateSnapshot: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unitSnapshot: z.string().trim().min(1).max(100),
  quantity: z.number().int().min(1).max(999_999),
});

export const fulfillmentConfirmationSchema = z.discriminatedUnion("method", [
  z.strictObject({
    allocationId: fulfillmentIdSchema,
    orderItemId: fulfillmentIdSchema,
    lotId: fulfillmentIdSchema,
    method: z.literal("BARCODE"),
    barcode: fulfillmentBarcodeSchema,
  }),
  z.strictObject({
    allocationId: fulfillmentIdSchema,
    orderItemId: fulfillmentIdSchema,
    lotId: fulfillmentIdSchema,
    method: z.literal("MANUAL"),
    reason: fulfillmentTextSchema(500),
  }),
]);
export type FulfillmentConfirmationDto = z.infer<typeof fulfillmentConfirmationSchema>;

export const fulfillmentPreparationSchema = z.strictObject({
  id: fulfillmentIdSchema,
  revision: z.number().int().min(1),
  status: z.enum(["ACTIVE", "COMPLETED"]),
  confirmations: z.array(fulfillmentConfirmationSchema),
  minimumPrintSequence: z.number().int().min(1).optional(),
  latestPrintEventId: fulfillmentIdSchema.nullable().optional(),
  latestPrintSequence: z.number().int().min(1).nullable().optional(),
}).superRefine((preparation, context) => {
  if (preparation?.status === "COMPLETED" && (!preparation.minimumPrintSequence || !preparation.latestPrintEventId || !preparation.latestPrintSequence)) {
    context.addIssue({ code: "custom", path: ["latestPrintEventId"], message: "Completed preparation must carry the qualifying print evidence" });
  }
}).nullable();
export type FulfillmentPreparationDto = z.infer<typeof fulfillmentPreparationSchema>;

export const fulfillmentReleaseSchema = z.strictObject({
  id: fulfillmentIdSchema,
  reservationId: fulfillmentIdSchema,
}).nullable();
export type FulfillmentReleaseDto = z.infer<typeof fulfillmentReleaseSchema>;

export const fulfillmentRejectionSchema = z.strictObject({
  id: fulfillmentIdSchema,
  preparationId: fulfillmentIdSchema,
  reservationId: fulfillmentIdSchema,
  reason: fulfillmentTextSchema(500),
}).nullable();
export type FulfillmentRejectionDto = z.infer<typeof fulfillmentRejectionSchema>;

export const fulfillmentDispenseLineSchema = z.strictObject({
  allocationId: fulfillmentIdSchema,
  orderItemId: fulfillmentIdSchema,
  lotId: fulfillmentIdSchema,
  quantity: z.number().int().min(1).max(999_999),
});
export const fulfillmentDispenseSchema = z.strictObject({
  id: fulfillmentIdSchema,
  reservationId: fulfillmentIdSchema,
  lines: z.array(fulfillmentDispenseLineSchema).min(1),
}).nullable();
export type FulfillmentDispenseDto = z.infer<typeof fulfillmentDispenseSchema>;

export const fulfillmentPickListSchema = z.strictObject({
  visit: visitSummarySchema,
  patient: patientSchema,
  medicationDecision: z.discriminatedUnion("kind", [
    z.strictObject({ id: fulfillmentIdSchema, version: z.number().int().min(1), kind: z.literal("ORDER") }),
    z.strictObject({
      id: fulfillmentIdSchema,
      version: z.number().int().min(1),
      kind: z.literal("NO_MEDICATION"),
      noMedicationReason: fulfillmentTextSchema(500),
    }),
  ]).nullable(),
  label: fulfillmentCurrentLabelSchema,
  reservation: z.strictObject({
    id: fulfillmentIdSchema,
    allocations: z.array(fulfillmentAllocationReferenceSchema),
  }).nullable(),
  preparation: fulfillmentPreparationSchema,
  release: fulfillmentReleaseSchema,
  dispense: fulfillmentDispenseSchema,
  allowedActions: z.array(z.enum(["START_PREPARATION", "PRINT_LABEL", "CONFIRM_ALLOCATION", "COMPLETE_PREPARATION", "ABANDON_PREPARATION", "RELEASE", "REJECT", "HANDOFF"])),
}).superRefine((pickList, context) => {
  if (pickList.medicationDecision === null || pickList.medicationDecision.kind === "NO_MEDICATION") {
    for (const artifact of ["label", "reservation", "preparation", "release", "dispense"] as const) {
      if (pickList[artifact] !== null) {
        context.addIssue({ code: "custom", path: [artifact], message: "NO_MEDICATION or absent decisions cannot have fulfillment artifacts" });
      }
    }
  }
});
export type FulfillmentPickListDto = z.infer<typeof fulfillmentPickListSchema>;

export const fulfillmentConfirmationPayloadSchema = z.discriminatedUnion("method", [
  z.strictObject({
    method: z.literal("BARCODE"),
    allocationId: fulfillmentIdSchema,
    preparationId: fulfillmentIdSchema,
    barcode: fulfillmentBarcodeSchema,
  }),
  z.strictObject({
    method: z.literal("MANUAL"),
    allocationId: fulfillmentIdSchema,
    preparationId: fulfillmentIdSchema,
    reason: fulfillmentTextSchema(500),
  }),
]);
export type FulfillmentConfirmationPayload = z.infer<typeof fulfillmentConfirmationPayloadSchema>;
export const fulfillmentConfirmationBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({
    visit: z.number().int().min(1),
    preparation: z.number().int().min(1),
  }),
  payload: fulfillmentConfirmationPayloadSchema,
}));
export type FulfillmentConfirmationBody = z.infer<typeof fulfillmentConfirmationBodySchema>;

export const fulfillmentPrintBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1) }),
  payload: z.strictObject({ rendererVersion: z.string().trim().min(1).max(100), decisionVersion: z.number().int().min(1) }),
}));
export type FulfillmentPrintBody = z.infer<typeof fulfillmentPrintBodySchema>;

export const fulfillmentCompletePreparationBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1), preparation: z.number().int().min(1) }),
  payload: z.strictObject({ preparationId: fulfillmentIdSchema, reservationId: fulfillmentIdSchema }),
}));
export type FulfillmentCompletePreparationBody = z.infer<typeof fulfillmentCompletePreparationBodySchema>;

export const fulfillmentAbandonPreparationBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1), preparation: z.number().int().min(1) }),
  payload: z.strictObject({ preparationId: fulfillmentIdSchema, reservationId: fulfillmentIdSchema, reason: fulfillmentTextSchema(500) }),
}));
export type FulfillmentAbandonPreparationBody = z.infer<typeof fulfillmentAbandonPreparationBodySchema>;

export const fulfillmentReleaseBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1), preparation: z.number().int().min(1) }),
  payload: z.strictObject({
    decisionId: fulfillmentIdSchema,
    decisionVersion: z.number().int().min(1),
    labelVersionId: fulfillmentIdSchema,
    labelPrintEventId: fulfillmentIdSchema,
    preparationId: fulfillmentIdSchema,
    reservationId: fulfillmentIdSchema,
  }),
}));
export type FulfillmentReleaseBody = z.infer<typeof fulfillmentReleaseBodySchema>;

export const fulfillmentRejectBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1), preparation: z.number().int().min(1) }),
  payload: z.strictObject({
    decisionId: fulfillmentIdSchema,
    decisionVersion: z.number().int().min(1),
    labelVersionId: fulfillmentIdSchema,
    labelPrintEventId: fulfillmentIdSchema,
    preparationId: fulfillmentIdSchema,
    reservationId: fulfillmentIdSchema,
    reason: fulfillmentTextSchema(500),
  }),
}));
export type FulfillmentRejectBody = z.infer<typeof fulfillmentRejectBodySchema>;

export const fulfillmentHandoffBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({ visit: z.number().int().min(1) }),
  payload: z.strictObject({
    decisionId: fulfillmentIdSchema,
    decisionVersion: z.number().int().min(1),
    labelVersionId: fulfillmentIdSchema,
    releaseId: fulfillmentIdSchema,
    reservationId: fulfillmentIdSchema,
  }),
}));
export type FulfillmentHandoffBody = z.infer<typeof fulfillmentHandoffBodySchema>;

export const snapshotSourceSchema = z.strictObject({
  type: z.enum(["ALLERGY_REVIEW", "INTAKE", "CLINICAL_NOTE", "MEDICATION_DECISION"]),
  id: z.string().min(1),
  occurredAt: z.string().datetime(),
});
export type SnapshotSource = z.infer<typeof snapshotSourceSchema>;

function snapshotFactSchema<T extends z.ZodType>(value: T) {
  return z.union([
    z.strictObject({ state: z.literal("UNKNOWN"), value: z.null(), source: z.null() }),
    z.strictObject({ state: z.literal("VALUE"), value, source: snapshotSourceSchema }),
  ]);
}
export const patientSnapshotSchema = z.strictObject({
  allergy: allergyAssessmentSchema,
  activeProblems: snapshotFactSchema(z.array(z.string().min(1))),
  currentMedicationContext: snapshotFactSchema(z.array(z.string().min(1))),
  latestRelevantPlan: snapshotFactSchema(z.string().min(1)),
  pendingFollowUp: snapshotFactSchema(z.string().min(1)),
  recentVisits: z.array(z.strictObject({
    visitId: z.string().min(1), noteId: z.string().min(1), signedAt: z.string().datetime(),
    diagnoses: z.array(z.string().min(1)), plan: z.string().min(1),
  })).max(5),
});
export type PatientSnapshotDto = z.infer<typeof patientSnapshotSchema>;

export const visitWorkspaceSchema = visitWorkspaceBaseSchema.extend({
  patientSnapshot: patientSnapshotSchema,
  consultationDraft: z.strictObject({
    note: clinicalNoteDraftSchema.nullable(),
    medicationDecision: medicationDecisionDraftSchema.nullable(),
  }),
  signedClinicalNote: signedClinicalNoteSchema.nullable(),
  amendments: z.array(clinicalNoteAmendmentSchema),
  medicationDecision: signedMedicationDecisionSchema.nullable(),
  allowedActions: z.array(z.enum([
    "START_CONSULTATION", "REVIEW_ALLERGY", "SAVE_DRAFT", "FINALIZE_CONSULTATION", "AMEND_NOTE", "REVISE_MEDICATION_DECISION",
  ])),
});
export type VisitWorkspaceDto = z.infer<typeof visitWorkspaceSchema>;

export const signedDecisionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ORDER"),
    items: z.array(medicationDecisionDraftItemInputSchema).min(1).max(20),
  }),
  z.strictObject({ kind: z.literal("NO_MEDICATION"), noMedicationReason: requiredClinicalText(500) }),
]);
export type SignedDecisionInput = z.infer<typeof signedDecisionInputSchema>;

export const signMedicationDecisionRevisionBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({
      visit: z.number().int().min(1),
      patient: z.number().int().min(1),
      medicationDecision: z.number().int().min(1),
    }),
    payload: z.strictObject({
      revisionReason: requiredClinicalText(500),
      decision: signedDecisionInputSchema,
    }),
  }),
);
export type SignMedicationDecisionRevisionBody = z.infer<typeof signMedicationDecisionRevisionBodySchema>;

export const medicationDecisionRevisionResultSchema = z.strictObject({
  visit: visitSummarySchema,
  medicationDecision: signedMedicationDecisionSchema,
});
export type MedicationDecisionRevisionResultDto = z.infer<typeof medicationDecisionRevisionResultSchema>;

export const medicationDecisionRevisionResponseSchema = z.strictObject({
  data: medicationDecisionRevisionResultSchema,
  replayed: z.boolean(),
});
export type MedicationDecisionRevisionResponse = z.infer<typeof medicationDecisionRevisionResponseSchema>;

export const finalizeConsultationBodySchema = rejectOwnPrototypeKeys(
  z.strictObject({
    expectedRevisions: z.strictObject({
      visit: z.number().int().min(1),
      patient: z.number().int().min(1),
      noteDraft: z.number().int().min(1),
      medicationDraft: z.number().int().min(1),
    }),
    payload: z.strictObject({}),
  }),
);
export type FinalizeConsultationBody = z.infer<typeof finalizeConsultationBodySchema>;

export const finalizeConsultationResultSchema = z.strictObject({
  visit: visitSummarySchema,
  clinicalNote: signedClinicalNoteSchema,
  medicationDecision: signedMedicationDecisionSchema,
});
export type FinalizeConsultationResultDto = z.infer<typeof finalizeConsultationResultSchema>;

export const finalizeConsultationResponseSchema = z.strictObject({
  data: finalizeConsultationResultSchema,
  replayed: z.boolean(),
});
export type FinalizeConsultationResponse = z.infer<typeof finalizeConsultationResponseSchema>;

const closurePatientSnapshotSchema = z.strictObject({
  id: financeIdSchema,
  hn: z.string().regex(/^DEMO-[0-9]{6}$/),
  displayName: financeDisplayNameSchema,
  birthDate: z.iso.date(),
  sex: z.enum(["female", "male", "unknown"]),
});

const closureDoctorSnapshotSchema = z.strictObject({
  id: financeIdSchema,
  displayName: financeDisplayNameSchema,
});

export const visitClosureResolutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("PAYMENT"),
    paymentId: financeIdSchema,
  }),
  z.strictObject({
    kind: z.literal("COLLECTION_NOT_REQUIRED"),
    waiverAdjustmentId: financeIdSchema,
  }),
]);
export type VisitClosureResolution = z.infer<typeof visitClosureResolutionSchema>;

export const closeVisitBodySchema = rejectOwnPrototypeKeys(z.strictObject({
  expectedRevisions: z.strictObject({
    visit: z.number().int().safe().min(1),
  }),
  payload: z.strictObject({
    chargeId: financeIdSchema,
    resolution: visitClosureResolutionSchema,
  }),
}));
export type CloseVisitBody = z.infer<typeof closeVisitBodySchema>;

export const visitClosureSchema = z.strictObject({
  id: financeIdSchema,
  visitId: financeIdSchema,
  visitRevision: z.number().int().safe().min(1),
  chargeId: financeIdSchema,
  resolution: visitClosureResolutionSchema,
  clinic: z.strictObject({
    id: financeIdSchema,
    name: z.string().trim().min(1).max(120),
  }),
  patient: closurePatientSnapshotSchema,
  doctor: closureDoctorSnapshotSchema,
  closedAt: z.string().datetime(),
  contentHash: financeContentHashSchema,
  visit: z.strictObject({
    id: financeIdSchema,
    status: z.literal("CLOSED"),
    revision: z.number().int().safe().min(1),
    arrivedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime(),
  }),
});
export type VisitClosureDto = z.infer<typeof visitClosureSchema>;

export const closeVisitResponseSchema = z.strictObject({
  data: visitClosureSchema,
  replayed: z.boolean(),
});
export type CloseVisitResponse = z.infer<typeof closeVisitResponseSchema>;

const opdPaymentResolutionSchema = z.strictObject({
  kind: z.literal("PAYMENT"),
  paymentId: financeIdSchema,
  method: z.enum(["CASH", "PROMPTPAY"]),
  amountBaht: paymentAmountBahtSchema,
  manualReference: z.string().trim().min(1).max(100).nullable(),
  confirmedBy: closureDoctorSnapshotSchema,
  confirmedAt: z.string().datetime(),
  contentHash: financeContentHashSchema,
});

const opdWaiverResolutionSchema = z.strictObject({
  kind: z.literal("COLLECTION_NOT_REQUIRED"),
  waiverAdjustmentId: financeIdSchema,
  amountBaht: z.number().int().safe().min(-100_000_000).max(-1),
  reason: z.string().trim().min(1).max(500),
  approvedBy: closureDoctorSnapshotSchema,
  approvedAt: z.string().datetime(),
  contentHash: financeContentHashSchema,
});

const opdMedicationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ORDER"),
    decision: z.strictObject({
      id: financeIdSchema,
      version: z.number().int().safe().min(1),
      signedAt: z.string().datetime(),
      contentHash: financeContentHashSchema,
    }),
    dispense: z.strictObject({
      id: financeIdSchema,
      handedOffAt: z.string().datetime(),
    }),
    items: z.array(z.strictObject({
      dispenseLineId: financeIdSchema,
      orderItemId: financeIdSchema,
      displayName: financeDescriptionSchema,
      strengthText: z.string().trim().min(1).max(100),
      dosageFormText: z.string().trim().min(1).max(100),
      quantity: z.number().int().safe().min(1).max(999_999),
      unit: z.string().trim().min(1).max(100),
      directionsTh: z.string().trim().min(1).max(500),
      lotNumber: z.string().trim().min(1).max(100),
      expiryDate: z.iso.date(),
    })).min(1).max(20),
  }),
  z.strictObject({
    kind: z.literal("NO_MEDICATION"),
    decision: z.strictObject({
      id: financeIdSchema,
      version: z.number().int().safe().min(1),
      signedAt: z.string().datetime(),
      contentHash: financeContentHashSchema,
    }),
    noMedicationReason: z.string().trim().min(1).max(500),
    items: z.tuple([]),
  }),
]);

export const opdCardSchema = z.strictObject({
  syntheticOnly: z.literal(true),
  closure: visitClosureSchema,
  visit: z.strictObject({
    id: financeIdSchema,
    chiefComplaint: z.string().trim().min(1).max(500),
    arrivedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    closedAt: z.string().datetime(),
    vitals: intakeVitalsSchema,
  }),
  clinicalNote: signedClinicalNoteSchema,
  amendments: z.array(clinicalNoteAmendmentSchema).max(100),
  medication: opdMedicationSchema,
  charge: z.strictObject({
    id: financeIdSchema,
    sourceKind: z.enum(["ORDER", "NO_MEDICATION"]),
    currency: z.literal("THB"),
    lines: z.array(checkoutLineSchema).min(1).max(21),
    grossTotalBaht: chargeGrossTotalBahtSchema,
    adjustmentTotalBaht: z.number().int().safe().min(-100_000_000).max(0),
    netDueBaht: z.number().int().safe().min(0).max(100_000_000),
    resolution: z.discriminatedUnion("kind", [opdPaymentResolutionSchema, opdWaiverResolutionSchema]),
    contentHash: financeContentHashSchema,
  }),
});
export type OpdCardDto = z.infer<typeof opdCardSchema>;

export const opdCardResponseSchema = z.strictObject({ data: opdCardSchema });
export type OpdCardResponse = z.infer<typeof opdCardResponseSchema>;

export type Permission = z.infer<typeof permissionSchema>;

export interface IdempotentEnvelope<T> {
  data: T;
  replayed: boolean;
}

export interface CommandWorkResult<T> {
  statusCode: number;
  data: T;
}

export interface CommandHttpResult<T> {
  statusCode: number;
  body: IdempotentEnvelope<T>;
}

export interface CommandBody<TPayload, TRevisions extends Record<string, number>> {
  expectedRevisions: TRevisions;
  payload: TPayload;
}

export const apiErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "AUTH_REQUIRED",
  "PASSWORD_CHANGE_REQUIRED",
  "PILOT_ACKNOWLEDGEMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_STATE",
  "ARTIFACT_STALE",
  "BARCODE_MISMATCH",
  "LOT_RESERVED",
  "STOCK_WOULD_BE_NEGATIVE",
  "ALLOCATION_ALREADY_CONFIRMED",
  "PREPARATION_INCOMPLETE",
  "LABEL_PRINT_REQUIRED",
  "RESERVATION_NOT_SELLABLE",
  "RELEASE_REQUIRED",
  "HANDOFF_ALREADY_CONFIRMED",
  "REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "ACTIVE_VISIT_EXISTS",
  "SYNTHETIC_ID_EXHAUSTED",
  "FINANCE_NOT_READY",
  "CHARGE_SOURCE_INCOMPLETE",
  "PRICE_SNAPSHOT_MISSING",
  "CHARGE_ALREADY_FINALIZED",
  "WAIVER_NOT_ALLOWED",
  "PAYMENT_AMOUNT_MISMATCH",
  "PAYMENT_ALREADY_RECORDED",
  "VISIT_CLOSE_BLOCKED",
  "OPD_CARD_NOT_READY",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);

export const apiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    messageTh: z.string(),
    requestId: z.string().min(1),
    fieldErrors: z.record(z.string(), z.string()).optional(),
    currentRevisions: z.record(z.string(), z.number().int()).optional(),
  }),
});

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
