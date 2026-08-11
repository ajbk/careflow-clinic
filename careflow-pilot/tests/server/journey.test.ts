import { afterEach, describe, expect, it } from "vitest";
import * as contracts from "../../src/shared/contracts.js";
import type { VisitStatus } from "../../src/shared/contracts.js";
import { cookieFrom, login, seedAccount } from "./helpers/auth.js";
import { createTestApp } from "./helpers/database.js";

const cleanups: Array<() => Promise<void>> = [];

function sequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type SafeParser = { safeParse(value: unknown): { success: boolean } };
type JourneyAction =
  | "START_CONSULTATION" | "REVIEW_ALLERGY" | "OPEN_CONSULTATION"
  | "START_PREPARATION" | "PRINT_LABEL" | "CONFIRM_ALLOCATION"
  | "COMPLETE_PREPARATION" | "RELEASE_MEDICATION" | "HANDOFF_MEDICATION"
  | "FINALIZE_CHARGE" | "RECORD_CASH" | "RECORD_PROMPTPAY"
  | "APPROVE_FULL_WAIVER" | "CLOSE_VISIT" | "OPEN_OPD_CARD" | "RECEIVE_STOCK";

type JourneyResponse = {
  data: {
    visit: { id: string; status: string; revision: number };
    steps: Array<{ code: string; labelTh: string; state: string }>;
    nextTask: null | {
      action: JourneyAction;
      labelTh: string;
      primaryRole: "assistant" | "doctor";
      permittedRoles: Array<"assistant" | "doctor">;
      availability: "AVAILABLE" | "WAITING_FOR_ROLE" | "BLOCKED";
    };
    blockers: Array<{
      code: string;
      titleTh: string;
      detailTh: string;
      recoveryAction: JourneyAction | null;
      medication: null | { medicationId: string; required: number; available: number; shortfall: number; unitSnapshot: string };
    }>;
    allowedActions: JourneyAction[];
    refreshedAt: string;
  };
};

const stepLabels = [
  ["INTAKE", "รับผู้ป่วย"],
  ["SCREENING", "คัดกรอง"],
  ["CONSULTATION", "ตรวจรักษา"],
  ["MEDICATION_DECISION", "ตัดสินใจเรื่องยา"],
  ["PREPARATION", "เตรียมยา"],
  ["HANDOFF", "ส่งมอบยา"],
  ["PAYMENT", "ชำระเงิน"],
  ["CLOSURE", "ปิด Visit"],
] as const;

function validJourney() {
  return {
    visit: { id: "visit-001", status: "WAITING", revision: 1 },
    steps: stepLabels.map(([code, labelTh], index) => ({
      code,
      labelTh,
      state: index < 2 ? "COMPLETE" : index === 2 ? "CURRENT" : "UPCOMING",
    })),
    nextTask: {
      action: "START_CONSULTATION",
      labelTh: "เริ่มตรวจ",
      primaryRole: "doctor",
      permittedRoles: ["doctor"],
      availability: "AVAILABLE",
    },
    blockers: [],
    allowedActions: ["START_CONSULTATION"],
    refreshedAt: "2026-08-11T00:00:00.000Z",
  };
}

function assertNoForbiddenKeys(value: unknown, path = "response"): void {
  const forbidden = new Set([
    "subjective", "objective", "assessment", "plan", "diagnoses", "phone",
    "contentHash", "clinicalNote", "opd",
  ]);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    expect(forbidden.has(key), `${path}.${key} must not be sent to Assistant`).toBe(false);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

async function fixture() {
  const test = await createTestApp({ idFactory: sequence("journey") });
  cleanups.push(test.cleanup);
  const assistant = await seedAccount(test.database, {
    id: "journey-assistant", username: "journey-assistant", role: "assistant",
    displayName: "ผู้ช่วย Journey", mustChangePassword: false,
  });
  const doctor = await seedAccount(test.database, {
    id: "journey-doctor", username: "journey-doctor", role: "doctor",
    displayName: "พญ. Journey", mustChangePassword: false,
  });
  return {
    ...test,
    assistant,
    doctor,
    assistantCookie: cookieFrom(await login(test.app, assistant.username, assistant.password)),
    doctorCookie: cookieFrom(await login(test.app, doctor.username, doctor.password)),
  };
}

async function createWaitingVisit(test: Awaited<ReturnType<typeof fixture>>, key = "journey") {
  const patient = await test.app.inject({
    method: "POST",
    url: "/api/patients/synthetic",
    headers: { cookie: test.assistantCookie, "idempotency-key": `${key}-patient` },
    payload: { expectedRevisions: {}, payload: {} },
  });
  expect(patient.statusCode).toBe(201);
  const intake = await test.app.inject({
    method: "POST",
    url: "/api/visits/intake",
    headers: { cookie: test.assistantCookie, "idempotency-key": `${key}-intake` },
    payload: {
      expectedRevisions: { patient: 1 },
      payload: {
        patientId: patient.json().data.id,
        chiefComplaint: "ทดสอบ Journey",
        vitals: {
          weightKg: null, heightCm: null, temperatureC: null, systolicMmhg: null,
          diastolicMmhg: null, heartRateBpm: null, spo2Percent: null,
        },
        allergy: { answer: "NO", items: [], changeReason: null },
      },
    },
  });
  expect(intake.statusCode).toBe(201);
  return intake;
}

function snapshotDomainTables(sqlite: Awaited<ReturnType<typeof fixture>>["database"]["sqlite"]): string {
  const tables = sqlite.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).pluck().all() as string[];
  return JSON.stringify(Object.fromEntries(tables.map((table) => [
    table,
    sqlite.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all(),
  ])));
}

let seedNumber = 100_000;

function seedJourneyVisit(
  test: Awaited<ReturnType<typeof fixture>>,
  input: {
    status: VisitStatus;
    allergy?: "UNKNOWN" | "NONE_KNOWN" | "PRESENT";
    decision?: "ORDER" | "NO_MEDICATION";
  },
) {
  const number = ++seedNumber;
  const suffix = String(number).padStart(6, "0");
  const patientId = `journey-patient-${suffix}`;
  const visitId = `journey-visit-${suffix}`;
  const decisionId = `journey-decision-${suffix}`;
  const now = "2026-08-11T00:00:00.000Z";
  const allergy = input.allergy ?? "NONE_KNOWN";
  test.database.sqlite.prepare(`
    INSERT INTO patients (
      id, clinic_id, hn, display_name, phone, birth_date, sex, revision, created_at, updated_at
    ) VALUES (?, 'clinic', ?, ?, ?, '1990-01-01', 'unknown', 1, ?, ?)
  `).run(patientId, `DEMO-${suffix}`, `ผู้ป่วยทดสอบ ${suffix}`, `000000${suffix.slice(-4)}`, now, now);
  if (allergy !== "UNKNOWN") {
    test.database.sqlite.prepare(`
      INSERT INTO patient_allergy_revisions (
        id, patient_id, revision, state, source_text, reason, reviewed_by, reviewed_at
      ) VALUES (?, ?, 1, ?, 'Journey synthetic evidence', 'Journey synthetic evidence', ?, ?)
    `).run(`journey-allergy-${suffix}`, patientId, allergy, test.doctor.actor.id, now);
  }
  test.database.sqlite.prepare(`
    INSERT INTO visits (
      id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, closed_at, created_by
    ) VALUES (?, 'clinic', ?, ?, 'Journey synthetic evidence', 7, ?, ?, ?, ?)
  `).run(
    visitId,
    patientId,
    input.status,
    now,
    input.status === "WAITING" ? null : now,
    input.status === "CLOSED" ? now : null,
    test.doctor.actor.id,
  );
  if (input.decision) {
    test.database.sqlite.prepare(`
      INSERT INTO medication_decisions (
        id, visit_id, version, kind, no_medication_reason, revision_reason, supersedes_id,
        signed_by, signed_by_display_name, signed_at, content_hash
      ) VALUES (?, ?, 1, ?, ?, NULL, NULL, ?, ?, ?, ?)
    `).run(
      decisionId,
      visitId,
      input.decision,
      input.decision === "NO_MEDICATION" ? "ไม่มีข้อบ่งใช้ยา" : null,
      test.doctor.actor.id,
      test.doctor.actor.displayName,
      now,
      "a".repeat(64),
    );
  }
  return { visitId, patientId, decisionId, suffix, now };
}

function seedPreparingEvidence(
  test: Awaited<ReturnType<typeof fixture>>,
  minimumPrintSequence = 1,
) {
  const seeded = seedJourneyVisit(test, { status: "PREPARING", decision: "ORDER" });
  const ids = {
    item: `${seeded.visitId}-item`,
    lot: `${seeded.visitId}-lot`,
    reservation: `${seeded.visitId}-reservation`,
    allocation: `${seeded.visitId}-allocation`,
    label: `${seeded.visitId}-label`,
    labelItem: `${seeded.visitId}-label-item`,
    preparation: `${seeded.visitId}-preparation`,
  };
  test.database.sqlite.exec(`
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th
    ) VALUES (
      '${ids.item}', '${seeded.decisionId}', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 3, 'รับประทานตามคำสั่ง'
    );
    INSERT INTO inventory_lots (
      id, clinic_id, medication_id, medication_revision, revision, display_name_snapshot,
      strength_snapshot, dosage_form_snapshot, unit_snapshot, lot_number, expiry_date,
      supplier_name, status, created_at, created_by
    ) VALUES (
      '${ids.lot}', 'clinic', 'DEMO-MED-001', 1, 1, '[DEMO] ยาทดสอบชนิด A',
      '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', '${seeded.suffix}-LOT', '2027-08-11',
      'Journey supplier', 'AVAILABLE', '${seeded.now}', '${test.doctor.actor.id}'
    );
    INSERT INTO inventory_reservations (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, status, created_at, created_by
    ) VALUES (
      '${ids.reservation}', 'clinic', '${seeded.visitId}', '${seeded.decisionId}', 1, 'ACTIVE',
      '${seeded.now}', '${test.doctor.actor.id}'
    );
    INSERT INTO inventory_reservation_allocations (
      id, reservation_id, medication_order_item_id, lot_id, position, quantity,
      medication_id, lot_number_snapshot, expiry_date_snapshot, unit_snapshot, allocated_at
    ) VALUES (
      '${ids.allocation}', '${ids.reservation}', '${ids.item}', '${ids.lot}', 0, 3,
      'DEMO-MED-001', '${seeded.suffix}-LOT', '2027-08-11', 'เม็ด', '${seeded.now}'
    );
    INSERT INTO fulfillment_label_versions (
      id, clinic_id, visit_id, medication_decision_id, medication_decision_version, version,
      created_at, created_by, patient_hn_snapshot, patient_display_name_snapshot, clinic_name_snapshot
    ) VALUES (
      '${ids.label}', 'clinic', '${seeded.visitId}', '${seeded.decisionId}', 1, 1,
      '${seeded.now}', '${test.doctor.actor.id}', 'DEMO-${seeded.suffix}', 'ผู้ป่วยทดสอบ ${seeded.suffix}',
      'คลินิกชนบท CareFlow Pilot'
    );
    INSERT INTO fulfillment_label_items (
      id, label_version_id, medication_order_item_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, quantity, unit_snapshot,
      directions_th_snapshot, internal_barcode_snapshot
    ) VALUES (
      '${ids.labelItem}', '${ids.label}', '${ids.item}', 0, 'DEMO-MED-001', 1,
      '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 3, 'เม็ด',
      'รับประทานตามคำสั่ง', 'CF-DEMO-001'
    );
    INSERT INTO fulfillment_preparations (
      id, clinic_id, visit_id, reservation_id, medication_decision_id, medication_decision_version,
      label_version_id, revision, status, minimum_print_sequence, created_at, created_by, completed_at, completed_by
    ) VALUES (
      '${ids.preparation}', 'clinic', '${seeded.visitId}', '${ids.reservation}', '${seeded.decisionId}', 1,
      '${ids.label}', 1, 'ACTIVE', ${minimumPrintSequence}, '${seeded.now}', '${test.doctor.actor.id}', NULL, NULL
    );
  `);
  return { ...seeded, ...ids };
}

function addPrint(
  test: Awaited<ReturnType<typeof fixture>>,
  evidence: ReturnType<typeof seedPreparingEvidence>,
): void {
  test.database.sqlite.prepare(`
    INSERT INTO fulfillment_label_print_events (
      id, label_version_id, sequence, requested_at, requested_by, renderer_version, media_size_snapshot
    ) VALUES (?, ?, 1, ?, ?, 'Journey renderer', '80x100mm')
  `).run(`${evidence.visitId}-print`, evidence.label, evidence.now, test.assistant.actor.id);
}

function addConfirmation(
  test: Awaited<ReturnType<typeof fixture>>,
  evidence: ReturnType<typeof seedPreparingEvidence>,
): void {
  test.database.sqlite.prepare(`
    INSERT INTO fulfillment_preparation_confirmations (
      id, preparation_id, reservation_allocation_id, medication_order_item_id, medication_id, lot_id,
      quantity, method, barcode_snapshot, manual_reason, confirmed_at, confirmed_by
    ) VALUES (?, ?, ?, ?, 'DEMO-MED-001', ?, 3, 'BARCODE', 'CF-DEMO-001', NULL, ?, ?)
  `).run(
    `${evidence.visitId}-confirmation`, evidence.preparation, evidence.allocation, evidence.item,
    evidence.lot, evidence.now, test.assistant.actor.id,
  );
}

function seedStockShortage(test: Awaited<ReturnType<typeof fixture>>) {
  const seeded = seedJourneyVisit(test, { status: "AWAITING_PREPARATION", decision: "ORDER" });
  test.database.sqlite.exec(`
    INSERT INTO medication_order_items (
      id, medication_decision_id, position, medication_id, medication_revision,
      display_name_snapshot, strength_snapshot, dosage_form_snapshot, unit_snapshot, quantity, directions_th
    ) VALUES
      ('${seeded.visitId}-item-a', '${seeded.decisionId}', 0, 'DEMO-MED-001', 1,
       '[DEMO] ยาทดสอบชนิด A', '500 หน่วยทดสอบ', 'เม็ดทดสอบ', 'เม็ด', 3, 'รับประทานตามคำสั่ง'),
      ('${seeded.visitId}-item-b', '${seeded.decisionId}', 1, 'DEMO-MED-002', 1,
       '[DEMO] ยาทดสอบชนิด B', '250 หน่วยทดสอบ', 'แคปซูลทดสอบ', 'แคปซูล', 2, 'รับประทานตามคำสั่ง');
  `);
  return seeded;
}

async function seedResolvedFinance(
  test: Awaited<ReturnType<typeof fixture>>,
  resolution: "CASH" | "PROMPTPAY" | "WAIVER",
  status: "READY_TO_CLOSE" | "CLOSED" = "READY_TO_CLOSE",
) {
  const seeded = seedJourneyVisit(test, { status: "AWAITING_CHARGE", decision: "NO_MEDICATION" });
  test.database.sqlite.exec(`
    INSERT INTO clinical_notes (
      id, visit_id, version, subjective, objective, assessment, plan, source_draft_revision,
      signed_by, signed_by_display_name, signed_at, content_hash
    ) VALUES (
      '${seeded.visitId}-note', '${seeded.visitId}', 1, 'Journey subjective', 'Journey objective',
      'Journey assessment', 'Journey plan', 1, '${test.doctor.actor.id}', '${test.doctor.actor.displayName}',
      '${seeded.now}', '${"f".repeat(64)}'
    );
    INSERT INTO clinical_note_diagnoses (id, clinical_note_id, position, diagnosis_text)
    VALUES ('${seeded.visitId}-diagnosis', '${seeded.visitId}-note', 0, 'Journey diagnosis');
  `);
  const finalization = await test.app.inject({
    method: "POST",
    url: `/api/checkout/${seeded.visitId}/charge-finalizations`,
    headers: { cookie: test.doctorCookie, "idempotency-key": `${seeded.suffix}-charge` },
    payload: {
      expectedRevisions: { visit: 7, clinicPricing: 1 },
      payload: resolution === "WAIVER"
        ? { settlementIntent: "FULL_WAIVER", waiverReason: "Journey waiver" }
        : { settlementIntent: "COLLECT" },
    },
  });
  expect(finalization.statusCode, finalization.body).toBe(201);
  const finalized = finalization.json().data as {
    charge: { id: string } | null;
    netDueBaht: number;
    visit: { revision: number };
    resolution: { kind: string; adjustmentId?: string };
  };
  if (!finalized.charge) throw new Error("Journey finance fixture did not create Charge");
  if (resolution === "WAIVER") {
    if (finalized.resolution.kind !== "COLLECTION_NOT_REQUIRED" || !finalized.resolution.adjustmentId) {
      throw new Error("Journey finance fixture did not create waiver evidence");
    }
    return {
      ...seeded,
      chargeId: finalized.charge.id,
      paymentId: null,
      waiverId: finalized.resolution.adjustmentId,
      readyVisitRevision: finalized.visit.revision,
      targetStatus: status,
    };
  }
  const collection = await test.app.inject({
    method: "POST",
    url: resolution === "CASH"
      ? `/api/checkout/${seeded.visitId}/payments/cash`
      : `/api/checkout/${seeded.visitId}/payments/promptpay`,
    headers: {
      cookie: resolution === "CASH" ? test.assistantCookie : test.doctorCookie,
      "idempotency-key": `${seeded.suffix}-${resolution.toLowerCase()}`,
    },
    payload: {
      expectedRevisions: { visit: finalized.visit.revision },
      payload: resolution === "CASH"
        ? { chargeId: finalized.charge.id, amountBaht: finalized.netDueBaht }
        : { chargeId: finalized.charge.id, amountBaht: finalized.netDueBaht, manualReference: "JOURNEY-PP-001" },
    },
  });
  expect(collection.statusCode).toBe(201);
  const collected = collection.json().data as { visit: { revision: number } };
  const paymentId = test.database.sqlite.prepare(
    "SELECT id FROM finance_payments WHERE visit_id = ?",
  ).pluck().get(seeded.visitId);
  if (typeof paymentId !== "string") throw new Error("Journey finance fixture did not create Payment");
  return {
    ...seeded,
    chargeId: finalized.charge.id,
    paymentId,
    waiverId: null,
    readyVisitRevision: collected.visit.revision,
    targetStatus: status,
  };
}

function addClosure(
  test: Awaited<ReturnType<typeof fixture>>,
  evidence: Awaited<ReturnType<typeof seedResolvedFinance>>,
): void {
  if (!evidence.paymentId) throw new Error("Closure fixture requires a payment");
  test.database.sqlite.prepare(`
    INSERT INTO visit_closures (
      id, clinic_id, visit_id, visit_revision, charge_id, payment_id, waiver_adjustment_id,
      clinic_name_snapshot, patient_id_snapshot, patient_hn_snapshot, patient_display_name_snapshot,
      patient_birth_date_snapshot, patient_sex_snapshot, doctor_id_snapshot, doctor_display_name_snapshot,
      closed_at, content_hash
    ) VALUES (?, 'clinic', ?, ?, ?, ?, NULL, 'คลินิกชนบท CareFlow Pilot', ?, ?, ?,
      '1990-01-01', 'unknown', ?, ?, ?, ?)
  `).run(
    `${evidence.visitId}-closure`, evidence.visitId, evidence.readyVisitRevision, evidence.chargeId, evidence.paymentId,
    evidence.patientId, `DEMO-${evidence.suffix}`, `ผู้ป่วยทดสอบ ${evidence.suffix}`,
    test.doctor.actor.id, test.doctor.actor.displayName, evidence.now, "e".repeat(64),
  );
  if (evidence.targetStatus === "CLOSED") {
    test.database.sqlite.prepare(`
      UPDATE visits SET status = 'CLOSED', revision = ?, closed_at = ? WHERE id = ?
    `).run(evidence.readyVisitRevision + 1, evidence.now, evidence.visitId);
  }
}

describe("Journey contracts", () => {
  it("rejects unknown and own-prototype fields instead of widening the Journey or Queue wire contracts", () => {
    // Break caught: relaxing a Journey/Queue schema would let clients invent authority fields.
    const values = contracts as Record<string, unknown>;
    const journey = values.visitJourneyResponseSchema as SafeParser | undefined;
    const queue = values.queueResponseSchema as SafeParser | undefined;
    expect(journey).toBeDefined();
    expect(queue).toBeDefined();
    if (!journey || !queue) return;

    const response = { data: validJourney() };
    expect(journey.safeParse(response).success).toBe(true);
    expect(journey.safeParse({ ...response, unexpected: true }).success).toBe(false);
    expect(journey.safeParse({ data: { ...validJourney(), visit: { ...validJourney().visit, closedAt: "forged" } } }).success).toBe(false);
    expect(journey.safeParse({ data: { ...validJourney(), nextTask: { ...validJourney().nextTask, unexpected: true } } }).success).toBe(false);
    expect(journey.safeParse({ data: { ...validJourney(), blockers: [{
      code: "ALLERGY_UNKNOWN", titleTh: "x", detailTh: "x", primaryRole: "assistant", recoveryAction: "REVIEW_ALLERGY", medication: null, forged: true,
    }] } }).success).toBe(false);
    const duplicateStep = validJourney();
    duplicateStep.steps[1] = { ...duplicateStep.steps[1]!, code: "INTAKE" };
    expect(journey.safeParse({ data: duplicateStep }).success).toBe(false);
    expect(journey.safeParse({ data: { ...validJourney(), allowedActions: ["START_CONSULTATION", "START_CONSULTATION"] } }).success).toBe(false);
    expect(journey.safeParse({ data: {
      ...validJourney(),
      nextTask: { ...validJourney().nextTask!, permittedRoles: ["doctor", "doctor"] },
    } }).success).toBe(false);

    const ownPrototype = { data: validJourney() } as Record<string, unknown>;
    Object.defineProperty(ownPrototype.data as object, "__proto__", {
      value: { polluted: true }, enumerable: true,
    });
    expect(journey.safeParse(ownPrototype).success).toBe(false);

    const parsers = values as Record<string, SafeParser | undefined>;
    const expectedEnums: Array<[string, readonly string[]]> = [
      ["journeyStepCodeSchema", ["INTAKE", "SCREENING", "CONSULTATION", "MEDICATION_DECISION", "PREPARATION", "HANDOFF", "PAYMENT", "CLOSURE"]],
      ["journeyStepStateSchema", ["COMPLETE", "CURRENT", "UPCOMING", "SKIPPED", "BLOCKED"]],
      ["journeyActionSchema", [
        "START_CONSULTATION", "REVIEW_ALLERGY", "OPEN_CONSULTATION", "START_PREPARATION", "PRINT_LABEL",
        "CONFIRM_ALLOCATION", "COMPLETE_PREPARATION", "RELEASE_MEDICATION", "HANDOFF_MEDICATION", "FINALIZE_CHARGE",
        "RECORD_CASH", "RECORD_PROMPTPAY", "APPROVE_FULL_WAIVER", "CLOSE_VISIT", "OPEN_OPD_CARD", "RECEIVE_STOCK",
      ]],
      ["journeyBlockerCodeSchema", ["ALLERGY_UNKNOWN", "STOCK_SHORTAGE", "EVIDENCE_INCONSISTENT"]],
    ];
    for (const [name, members] of expectedEnums) {
      const parser = parsers[name];
      expect(parser, `${name} must be exported`).toBeDefined();
      if (!parser) continue;
      for (const member of members) expect(parser.safeParse(member).success, `${name}:${member}`).toBe(true);
      expect(parser.safeParse("FORGED_ENUM").success, `${name} rejects forged values`).toBe(false);
    }

    const baseQueueItem = {
      visit: { id: "visit-001", status: "WAITING", revision: 1, arrivedAt: "2026-08-11T00:00:00.000Z", startedAt: null },
      patient: { id: "patient-001", hn: "DEMO-000001", displayName: "ผู้ป่วยทดสอบ", birthDate: "1990-01-01", sex: "unknown", revision: 1 },
      allergy: { id: null, revision: 0, state: "UNKNOWN", items: [], sourceText: null, reason: null, reviewedBy: null, reviewedAt: null },
      chiefComplaint: "ทดสอบ", vitals: { weightKg: null, heightCm: null, temperatureC: null, systolicMmhg: null, diastolicMmhg: null, heartRateBpm: null, spo2Percent: null },
      allowedActions: [],
      journeySummary: (({ visit: _visit, refreshedAt: _refreshedAt, ...summary }) => {
        void _visit;
        void _refreshedAt;
        return summary;
      })(validJourney()),
    };
    expect(queue.safeParse({ data: [baseQueueItem] }).success).toBe(true);
    expect(queue.safeParse({ data: [{ ...baseQueueItem, journeySummary: { ...baseQueueItem.journeySummary, forged: true } }] }).success).toBe(false);
  });
});

describe("privacy-safe server Visit Journey", () => {
  it("derives the exact eight-step waiting Journey and embeds its same summary in Intake and Queue", async () => {
    // Break caught: removing the shared Journey builder lets Intake/Queue drift from the endpoint.
    const test = await fixture();
    const intake = await createWaitingVisit(test, "journey-waiting");
    const visitId = intake.json().data.visit.id as string;

    const journey = await test.app.inject({
      method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    expect(journey.statusCode).toBe(200);
    const body = journey.json() as JourneyResponse;
    expect(body.data.steps.map((step) => [step.code, step.labelTh])).toEqual(stepLabels);
    expect(body.data.steps.find((step) => step.state === "CURRENT")?.code).toBe("CONSULTATION");
    expect(body.data.nextTask).toMatchObject({
      action: "START_CONSULTATION",
      availability: "WAITING_FOR_ROLE",
      labelTh: "รอแพทย์ตรวจและสั่งการรักษา",
    });

    const intakeSummary = intake.json().data.journeySummary;
    const { visit: _visit, refreshedAt: _refreshedAt, ...expectedSummary } = body.data;
    void _visit;
    void _refreshedAt;
    expect(intakeSummary).toEqual(expectedSummary);

    const queue = await test.app.inject({ method: "GET", url: "/api/queue", headers: { cookie: test.assistantCookie } });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.find((item: { visit: { id: string } }) => item.visit.id === visitId).journeySummary)
      .toEqual(expectedSummary);
  });

  it("keeps Journey reads zero-write, authenticates before evidence, and never leaks clinical fields to Assistant", async () => {
    // Break caught: a reader write, authentication-order regression, or returning a clinical DTO leaks/changes authority.
    const test = await fixture();
    const intake = await createWaitingVisit(test, "journey-private");
    const visitId = intake.json().data.visit.id as string;
    const started = await test.app.inject({
      method: "POST", url: `/api/visits/${visitId}/start-consultation`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "journey-private-start" },
      payload: { expectedRevisions: { visit: 1 }, payload: {} },
    });
    expect(started.statusCode).toBe(200);
    const draft = await test.app.inject({
      method: "POST", url: `/api/visits/${visitId}/consultation-draft`,
      headers: { cookie: test.doctorCookie, "idempotency-key": "journey-private-draft" },
      payload: {
        expectedRevisions: { visit: 2, noteDraft: 0, medicationDraft: 0 },
        payload: {
          note: {
            subjective: "PRIVATE-SUBJECTIVE", objective: "PRIVATE-OBJECTIVE",
            assessment: "PRIVATE-ASSESSMENT", plan: "PRIVATE-PLAN", diagnoses: ["PRIVATE-DIAGNOSIS"],
          },
          medicationDecision: { kind: "NO_MEDICATION", noMedicationReason: "PRIVATE-NO-MEDICATION" },
        },
      },
    });
    expect(draft.statusCode).toBe(200);

    const before = snapshotDomainTables(test.database.sqlite);
    const anonymous = await test.app.inject({ method: "GET", url: `/api/visits/${visitId}/journey` });
    expect(anonymous.statusCode).toBe(401);
    const assistant = await test.app.inject({
      method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    const doctor = await test.app.inject({
      method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    const queue = await test.app.inject({ method: "GET", url: "/api/queue", headers: { cookie: test.assistantCookie } });
    expect(assistant.statusCode).toBe(200);
    expect(doctor.statusCode).toBe(200);
    expect(queue.statusCode).toBe(200);
    assertNoForbiddenKeys(assistant.json());
    expect(JSON.stringify(assistant.json())).not.toContain("PRIVATE-");
    expect(snapshotDomainTables(test.database.sqlite)).toBe(before);
  });

  it("prioritizes an UNKNOWN allergy blocker without removing the Doctor consultation action", async () => {
    // Break caught: treating UNKNOWN as a silent state lets finalization proceed without an explicit safety recovery.
    const test = await fixture();
    const patient = await test.app.inject({
      method: "POST", url: "/api/patients/synthetic",
      headers: { cookie: test.assistantCookie, "idempotency-key": "journey-unknown-patient" },
      payload: { expectedRevisions: {}, payload: {} },
    });
    const patientId = patient.json().data.id as string;
    test.database.sqlite.prepare("UPDATE patients SET revision = 1 WHERE id = ?").run(patientId);
    test.database.sqlite.prepare(`
      INSERT INTO visits (id, clinic_id, patient_id, status, chief_complaint, revision, arrived_at, started_at, closed_at, created_by)
      VALUES ('journey-unknown-visit', 'clinic', ?, 'WAITING', 'ทดสอบ allergy UNKNOWN', 1, '2026-08-11T00:00:00.000Z', NULL, NULL, ?)
    `).run(patientId, test.assistant.actor.id);
    test.database.sqlite.prepare(`
      INSERT INTO intake_observations (id, visit_id, recorded_by, recorded_at)
      VALUES ('journey-unknown-observation', 'journey-unknown-visit', ?, '2026-08-11T00:00:00.000Z')
    `).run(test.assistant.actor.id);
    const journey = await test.app.inject({
      method: "GET", url: "/api/visits/journey-unknown-visit/journey", headers: { cookie: test.doctorCookie },
    });
    expect(journey.statusCode).toBe(200);
    const data = (journey.json() as JourneyResponse).data;
    expect(data.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ALLERGY_UNKNOWN",
        titleTh: "ยังไม่ได้ถามประวัติแพ้ยา",
        recoveryAction: "REVIEW_ALLERGY",
      }),
    ]));
    expect(data.allowedActions).toEqual(expect.arrayContaining(["START_CONSULTATION", "REVIEW_ALLERGY"]));
  });

  it("projects a clinically-active Allergy recovery from domain evidence before applying actor permissions", async () => {
    // Break caught: role-specific domain inference can hide a permitted Allergy recovery from Assistant.
    const test = await fixture();
    const seeded = seedJourneyVisit(test, { status: "CONSULTING", allergy: "UNKNOWN" });
    const assistant = await test.app.inject({
      method: "GET", url: `/api/visits/${seeded.visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    expect(assistant.statusCode).toBe(200);
    expect((assistant.json() as JourneyResponse).data).toMatchObject({
      nextTask: { action: "REVIEW_ALLERGY", availability: "AVAILABLE" },
      allowedActions: ["REVIEW_ALLERGY"],
    });
  });
});

describe("Journey truth table and evidence branches", () => {
  const cases = [
    { status: "WAITING", current: "CONSULTATION", next: "START_CONSULTATION" },
    { status: "CONSULTING", current: "CONSULTATION", next: "OPEN_CONSULTATION" },
    { status: "AWAITING_ORDER_REVISION", current: "MEDICATION_DECISION", next: "OPEN_CONSULTATION" },
    { status: "AWAITING_PREPARATION", current: "PREPARATION", next: "START_PREPARATION" },
    { status: "PREPARING", current: "PREPARATION", next: "PRINT_LABEL" },
    { status: "AWAITING_RELEASE", current: "PREPARATION", next: "RELEASE_MEDICATION" },
    { status: "AWAITING_HANDOFF", current: "HANDOFF", next: "HANDOFF_MEDICATION" },
    { status: "AWAITING_CHARGE", current: "PAYMENT", next: "FINALIZE_CHARGE" },
    { status: "AWAITING_PAYMENT", current: "PAYMENT", next: "RECORD_CASH" },
    { status: "READY_TO_CLOSE", current: "CLOSURE", next: "CLOSE_VISIT" },
  ] as const satisfies ReadonlyArray<{
    status: VisitStatus;
    current: string;
    next: JourneyAction;
  }>;

  it.each(cases)("maps $status to $current and $next without client status inference", async ({ status, current, next }) => {
    // Break caught: changing a raw Visit status must update the sole server Journey map, not every client.
    const test = await fixture();
    const seeded = seedJourneyVisit(test, { status });
    const response = await test.app.inject({
      method: "GET", url: `/api/visits/${seeded.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    expect(response.statusCode).toBe(200);
    const data = (response.json() as JourneyResponse).data;
    expect(data.steps.map((step) => [step.code, step.labelTh])).toEqual(stepLabels);
    expect(data.steps.filter((step) => step.state === "CURRENT").map((step) => step.code)).toEqual([current]);
    expect(data.nextTask?.action).toBe(next);
  });

  it("offers only the evidence-ready PREPARING action: print, confirm, then complete", async () => {
    // Break caught: exposing all preparation mutations lets the UI claim an incomplete command is allowed.
    const test = await fixture();
    const evidence = seedPreparingEvidence(test);
    const read = async () => test.app.inject({
      method: "GET", url: `/api/visits/${evidence.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });

    let response = await read();
    expect(response.statusCode).toBe(200);
    let data = (response.json() as JourneyResponse).data;
    expect(data.nextTask).toMatchObject({ action: "PRINT_LABEL" });
    expect(data.allowedActions).toEqual(expect.arrayContaining(["PRINT_LABEL"]));
    expect(data.allowedActions).not.toEqual(expect.arrayContaining(["CONFIRM_ALLOCATION", "COMPLETE_PREPARATION"]));

    addPrint(test, evidence);
    response = await read();
    data = (response.json() as JourneyResponse).data;
    expect(data.nextTask).toMatchObject({ action: "CONFIRM_ALLOCATION" });
    expect(data.allowedActions).toEqual(expect.arrayContaining(["CONFIRM_ALLOCATION"]));
    expect(data.allowedActions).not.toEqual(expect.arrayContaining(["PRINT_LABEL", "COMPLETE_PREPARATION"]));

    addConfirmation(test, evidence);
    response = await read();
    data = (response.json() as JourneyResponse).data;
    expect(data.nextTask).toMatchObject({ action: "COMPLETE_PREPARATION" });
    expect(data.allowedActions).toEqual(expect.arrayContaining(["COMPLETE_PREPARATION"]));
    expect(data.allowedActions).not.toEqual(expect.arrayContaining(["PRINT_LABEL", "CONFIRM_ALLOCATION"]));

    const stalePrintEvidence = seedPreparingEvidence(test, 2);
    addPrint(test, stalePrintEvidence);
    response = await test.app.inject({
      method: "GET", url: `/api/visits/${stalePrintEvidence.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    data = (response.json() as JourneyResponse).data;
    expect(data.nextTask).toMatchObject({ action: "PRINT_LABEL" });
    expect(data.allowedActions).toEqual(expect.arrayContaining(["PRINT_LABEL"]));
  });

  it("blocks preparation per short medication and exposes only the permitted stock recovery", async () => {
    // Break caught: a stock-short Journey must not advertise START_PREPARATION before the advisory recovery.
    const test = await fixture();
    const { visitId } = seedStockShortage(test);
    const assistant = await test.app.inject({
      method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    const doctor = await test.app.inject({
      method: "GET", url: `/api/visits/${visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    expect(assistant.statusCode).toBe(200);
    expect(doctor.statusCode).toBe(200);
    const assistantData = (assistant.json() as JourneyResponse).data;
    expect(assistantData.steps.find((step) => step.code === "PREPARATION")?.state).toBe("BLOCKED");
    expect(assistantData.blockers).toEqual([
      expect.objectContaining({
        code: "STOCK_SHORTAGE", titleTh: "จัดยายังไม่ได้", recoveryAction: "RECEIVE_STOCK",
        medication: expect.objectContaining({ medicationId: "DEMO-MED-001", required: 3, available: 0, shortfall: 3, unitSnapshot: "เม็ด" }),
      }),
      expect.objectContaining({
        code: "STOCK_SHORTAGE", titleTh: "จัดยายังไม่ได้", recoveryAction: "RECEIVE_STOCK",
        medication: expect.objectContaining({ medicationId: "DEMO-MED-002", required: 2, available: 0, shortfall: 2, unitSnapshot: "แคปซูล" }),
      }),
    ]);
    expect(assistantData.nextTask).toMatchObject({ action: "RECEIVE_STOCK", primaryRole: "assistant", availability: "AVAILABLE" });
    expect(assistantData.allowedActions).toEqual(["RECEIVE_STOCK"]);
    expect((doctor.json() as JourneyResponse).data.allowedActions).toEqual(expect.arrayContaining(["RECEIVE_STOCK"]));
    expect((doctor.json() as JourneyResponse).data.allowedActions).not.toContain("START_PREPARATION");
  });

  it("keeps an UNKNOWN allergy recovery ahead of charge finalization while preserving Doctor consultation access", async () => {
    // Break caught: a legacy UNKNOWN must not become a path around the server allergy finalization guard.
    const test = await fixture();
    const charge = seedJourneyVisit(test, { status: "AWAITING_CHARGE", allergy: "UNKNOWN", decision: "NO_MEDICATION" });
    const waiting = seedJourneyVisit(test, { status: "WAITING", allergy: "UNKNOWN" });
    const chargeResponse = await test.app.inject({
      method: "GET", url: `/api/visits/${charge.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    const waitingResponse = await test.app.inject({
      method: "GET", url: `/api/visits/${waiting.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    const chargeData = (chargeResponse.json() as JourneyResponse).data;
    expect(chargeData.blockers[0]).toMatchObject({ code: "ALLERGY_UNKNOWN", recoveryAction: "REVIEW_ALLERGY" });
    expect(chargeData.nextTask).toMatchObject({ action: "REVIEW_ALLERGY" });
    expect(chargeData.allowedActions).toEqual([]);
    expect(chargeData.allowedActions).not.toContain("FINALIZE_CHARGE");
    expect((waitingResponse.json() as JourneyResponse).data.allowedActions)
      .toEqual(expect.arrayContaining(["START_CONSULTATION", "REVIEW_ALLERGY"]));
  });

  it("skips dispensing for NO_MEDICATION and marks terminal cash, PromptPay, and waiver evidence truthfully", async () => {
    // Break caught: a terminal financial projection must derive skip/completion from committed evidence, not client intent.
    const test = await fixture();
    const noMedication = seedJourneyVisit(test, { status: "AWAITING_CHARGE", decision: "NO_MEDICATION" });
    const noMedicationResponse = await test.app.inject({
      method: "GET", url: `/api/visits/${noMedication.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    const noMedicationSteps = (noMedicationResponse.json() as JourneyResponse).data.steps;
    expect(noMedicationSteps.find((step) => step.code === "PREPARATION")?.state).toBe("SKIPPED");
    expect(noMedicationSteps.find((step) => step.code === "HANDOFF")?.state).toBe("SKIPPED");

    for (const resolution of ["CASH", "PROMPTPAY", "WAIVER"] as const) {
      const finance = await seedResolvedFinance(test, resolution);
      const response = await test.app.inject({
        method: "GET", url: `/api/visits/${finance.visitId}/journey`, headers: { cookie: test.doctorCookie },
      });
      const data = (response.json() as JourneyResponse).data;
      expect(data.nextTask).toMatchObject({ action: "CLOSE_VISIT" });
      expect(data.allowedActions).toEqual(["CLOSE_VISIT"]);
      expect(data.steps.find((step) => step.code === "PAYMENT")?.state)
        .toBe(resolution === "WAIVER" ? "SKIPPED" : "COMPLETE");
    }
  });

  it("treats CLOSED without Closure as opaque inconsistent evidence, but a Closure authorizes only Doctor OPD", async () => {
    // Break caught: a closed status alone must neither grant OPD nor expose the missing clinical chain.
    const test = await fixture();
    // A legacy/corrupt CLOSED row is not normally insertable; simulate precisely that historical evidence hole.
    test.database.sqlite.exec("DROP TRIGGER visits_closed_insert_guard");
    const missingClosure = seedJourneyVisit(test, { status: "CLOSED", decision: "NO_MEDICATION" });
    const missingResponse = await test.app.inject({
      method: "GET", url: `/api/visits/${missingClosure.visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    const missing = (missingResponse.json() as JourneyResponse).data;
    expect(missing.blockers).toEqual([expect.objectContaining({ code: "EVIDENCE_INCONSISTENT", recoveryAction: null })]);
    expect(missing.allowedActions).toEqual([]);
    expect(missing.nextTask).toBeNull();
    assertNoForbiddenKeys(missing);

    const closed = await seedResolvedFinance(test, "CASH", "CLOSED");
    addClosure(test, closed);
    const doctor = await test.app.inject({
      method: "GET", url: `/api/visits/${closed.visitId}/journey`, headers: { cookie: test.doctorCookie },
    });
    const assistant = await test.app.inject({
      method: "GET", url: `/api/visits/${closed.visitId}/journey`, headers: { cookie: test.assistantCookie },
    });
    const doctorData = (doctor.json() as JourneyResponse).data;
    expect(doctorData.blockers).toEqual([]);
    expect(doctorData.nextTask).toMatchObject({ action: "OPEN_OPD_CARD", availability: "AVAILABLE" });
    expect(doctorData.allowedActions).toEqual(["OPEN_OPD_CARD"]);
    expect((assistant.json() as JourneyResponse).data).toMatchObject({ blockers: [], nextTask: null, allowedActions: [] });
  });
});
