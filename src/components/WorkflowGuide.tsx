import { Check } from "lucide-react";

export type FlowStepState = "complete" | "current" | "ready" | "locked";

export type FlowStep = {
  number: number;
  label: string;
  status: string;
  state: FlowStepState;
};

type WorkflowGuideProps = {
  steps: FlowStep[];
  currentStep: number;
  ariaLabel: string;
  onSelect: (stepNumber: number) => void;
};

export function WorkflowGuide({
  steps,
  currentStep,
  ariaLabel,
  onSelect,
}: WorkflowGuideProps) {
  return (
    <nav className="stepper" aria-label={ariaLabel}>
      <ol className="stepper-marks" aria-label={ariaLabel}>
        {steps.map((step) => {
          const isActive = step.number === currentStep;
          const isLocked = step.state === "locked";

          return (
            <li
              key={step.number}
              className={`stepper-item ${step.state}${isActive ? " active" : ""}`}
            >
              <button
                type="button"
                className="stepper-mark"
                disabled={isLocked}
                aria-current={isActive ? "step" : undefined}
                onClick={() => onSelect(step.number)}
              >
                <span className="stepper-num" aria-hidden="true">
                  {step.state === "complete" ? <Check size={15} strokeWidth={2.6} /> : step.number}
                </span>
                <span className="stepper-copy">
                  <span className="stepper-label">{step.label}</span>
                  <span className="workflow-status">{step.status}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
