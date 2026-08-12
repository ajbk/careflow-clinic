import { Ban, CheckCircle2, CircleDot, Clock3, SkipForward } from "lucide-react";
import type { ComponentType, ReactElement } from "react";
import type { JourneyStepDto } from "../../../shared/contracts";

const statePresentation: Record<JourneyStepDto["state"], { label: string; Icon: ComponentType<{ "aria-hidden"?: boolean; size?: number }> }> = {
  COMPLETE: { label: "เสร็จแล้ว", Icon: CheckCircle2 },
  CURRENT: { label: "กำลังดำเนินการ", Icon: CircleDot },
  UPCOMING: { label: "รอขั้นตอน", Icon: Clock3 },
  SKIPPED: { label: "ข้ามขั้นตอน", Icon: SkipForward },
  BLOCKED: { label: "ติดขัด", Icon: Ban },
};

function semanticCurrentStep(steps: readonly JourneyStepDto[]): JourneyStepDto | undefined {
  const explicitCurrent = steps.find((step) => step.state === "CURRENT");
  if (explicitCurrent) return explicitCurrent;
  // Server derivation can replace its operational current step with BLOCKED
  // (for example, PREPARATION during a stock shortage). The final blocked
  // step is the furthest server-provided progress context without changing
  // any visual state. Closure is present in every valid Journey contract.
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.state === "BLOCKED") return steps[index];
  }
  return steps.find((step) => step.code === "CLOSURE");
}

export function VisitJourneyRibbon({ steps }: { steps: readonly JourneyStepDto[] }): ReactElement {
  const accessibleCurrent = semanticCurrentStep(steps)?.code;
  return (
    <nav className="visit-journey-ribbon" aria-label="เส้นทางผู้ป่วย">
      <ol className="visit-journey-ribbon-list">
        {steps.map((step) => {
          const presentation = statePresentation[step.state];
          const Icon = presentation.Icon;
          return (
            <li
              className={`visit-journey-ribbon-step is-${step.state.toLowerCase()}`}
              key={step.code}
              aria-current={step.code === accessibleCurrent ? "step" : undefined}
            >
              <span className="visit-journey-ribbon-icon"><Icon aria-hidden size={18} /></span>
              <span className="visit-journey-ribbon-copy">
                <span className="visit-journey-ribbon-label">{step.labelTh}</span>
                <span className="visit-journey-ribbon-state">{presentation.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
