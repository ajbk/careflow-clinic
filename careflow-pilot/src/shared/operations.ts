import type { Permission } from "./contracts.js";

/** Fixed operation names and permission mapping; never use clinical URLs in breadcrumbs. */
export const operationPermissions: Readonly<Record<string, Permission>> = {
  legacy: "clinical:sign",
  "patient.create-synthetic.v1": "patient:create-synthetic",
  "visit.submit-intake.v2": "visit:submit-intake",
  "visit.start-consultation.v1": "visit:start-consultation",
  "patient.review-allergy.v1": "patient:update-allergy",
  "clinical.amend-note.v1": "clinical:amend",
  "medication.revise-decision.v1": "medication:sign-decision",
  "clinical.save-draft.v1": "clinical:save-draft",
  "clinical.finalize-consultation.v1": "clinical:sign",
  "inventory.receive": "inventory:receive",
  "inventory.quarantine": "inventory:quarantine",
  "inventory.unquarantine": "inventory:release-quarantine",
  "inventory.adjust": "inventory:adjust",
  "fulfillment.start-preparation.v1": "fulfillment:prepare",
  "fulfillment.print-label.v1": "label:print",
  "fulfillment.confirm-allocation.v1": "fulfillment:prepare",
  "fulfillment.complete-preparation.v1": "fulfillment:prepare",
  "fulfillment.abandon-preparation.v1": "fulfillment:prepare",
  "fulfillment.release.v1": "fulfillment:release",
  "fulfillment.reject.v1": "fulfillment:release",
  "fulfillment.handoff.v1": "fulfillment:handoff",
  "finance.finalize-charge.v1": "finance:finalize-charge",
  "finance.approve-waiver.v1": "finance:waive",
  "finance.record-cash.v1": "finance:record-cash",
  "finance.confirm-promptpay.v1": "finance:confirm-promptpay",
  "visit.close.v1": "visit:close",
};

const routes: Readonly<Record<string, string>> = {
  "/api/patients/synthetic": "patient.create-synthetic.v1",
  "/api/visits/intake": "visit.submit-intake.v2",
  "/api/visits/:id/start-consultation": "visit.start-consultation.v1",
  "/api/patients/:id/allergy-revisions": "patient.review-allergy.v1",
  "/api/clinical-notes/:id/amendments": "clinical.amend-note.v1",
  "/api/visits/:id/medication-decision-revisions": "medication.revise-decision.v1",
  "/api/visits/:id/consultation-draft": "clinical.save-draft.v1",
  "/api/visits/:id/finalize-consultation": "clinical.finalize-consultation.v1",
  "/api/inventory/receipts": "inventory.receive",
  "/api/inventory/lots/:id/quarantine": "inventory.quarantine",
  "/api/inventory/lots/:id/unquarantine": "inventory.unquarantine",
  "/api/inventory/lots/:id/adjustments": "inventory.adjust",
  "/api/dispensing/:id/reservations": "fulfillment.start-preparation.v1",
  "/api/dispensing/:id/labels/:version/print-events": "fulfillment.print-label.v1",
  "/api/dispensing/:id/preparation-confirmations": "fulfillment.confirm-allocation.v1",
  "/api/dispensing/:id/complete-preparation": "fulfillment.complete-preparation.v1",
  "/api/dispensing/:id/reservation-release": "fulfillment.abandon-preparation.v1",
  "/api/dispensing/:id/release": "fulfillment.release.v1",
  "/api/dispensing/:id/reject": "fulfillment.reject.v1",
  "/api/dispensing/:id/handoff": "fulfillment.handoff.v1",
  "/api/checkout/:id/charge-finalizations": "finance.finalize-charge.v1",
  "/api/checkout/:id/waivers": "finance.approve-waiver.v1",
  "/api/checkout/:id/payments/cash": "finance.record-cash.v1",
  "/api/checkout/:id/payments/promptpay": "finance.confirm-promptpay.v1",
  "/api/visits/:id/close": "visit.close.v1",
};

export function operationForPath(path: string): string | undefined {
  const parts = path.split("/");
  return Object.entries(routes).find(([template]) => {
    const expected = template.split("/");
    return expected.length === parts.length && expected.every((part, i) => part.startsWith(":") ? Boolean(parts[i]) : part === parts[i]);
  })?.[1];
}
