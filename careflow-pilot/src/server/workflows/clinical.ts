import type {
  Actor,
  AllergyReviewResultDto,
  ReviewAllergyBody,
} from "../../shared/contracts.js";
import type { PatientService } from "../modules/patient/index.js";
import type { AuditedTransaction } from "../modules/platform/index.js";
import type { VisitService } from "../modules/visit/index.js";

export interface ClinicalWorkflow {
  reviewAllergy(
    tx: AuditedTransaction,
    actor: Actor,
    patientId: string,
    body: ReviewAllergyBody,
  ): AllergyReviewResultDto;
}

export function createClinicalWorkflow(input: {
  patients: PatientService;
  visits: VisitService;
}): ClinicalWorkflow {
  return {
    reviewAllergy(tx, actor, patientId, body) {
      const visit = input.visits.assertAllergyReviewVisit(tx, actor, patientId, body);
      const { patient, allergy } = input.patients.reviewAllergy(
        tx,
        actor,
        patientId,
        body.expectedRevisions.patient,
        body.payload,
      );
      return { patient, allergy, visit };
    },
  };
}
