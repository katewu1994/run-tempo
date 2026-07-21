import { CircleAlert, ShieldCheck } from "lucide-react";
import type { LibraryCoverageReport } from "../domain/mixTypes";
import type { MultiTrackCopy } from "./multiTrackFormat";

export function LibraryCoveragePanel({
  report,
  copy,
}: {
  report: LibraryCoverageReport;
  copy: MultiTrackCopy["coverage"];
}) {
  const hasMissing = report.missingCadences.length > 0;
  const hasRiskyCadence = report.riskyCadences.length > 0;
  const coverageState = hasMissing
    ? "missing"
    : hasRiskyCadence
      ? "warning"
      : "complete";

  return (
    <div className={`coverage-hero coverage-status ${coverageState}`} role="status">
      <span className="coverage-hero-icon" aria-hidden="true">
        {coverageState === "complete" ? (
          <ShieldCheck size={24} />
        ) : (
          <CircleAlert size={24} />
        )}
      </span>
      <div>
        <strong>
          {hasMissing
            ? copy.notCompatible
            : hasRiskyCadence
              ? copy.adjustmentNeeded
              : copy.compatible}
        </strong>
        <p>
          {hasMissing
            ? copy.missingHint(formatCadenceList(report.missingCadences))
            : hasRiskyCadence
              ? copy.riskyHint(formatCadenceList(report.riskyCadences))
              : copy.completeHint}
        </p>
        {hasMissing ? (
          <small className="coverage-rule-hint">{copy.clickLockedHint}</small>
        ) : null}
      </div>
    </div>
  );
}

function formatCadenceList(cadences: number[]): string {
  return cadences
    .map((cadence) => Number.isInteger(cadence) ? cadence.toString() : cadence.toFixed(1))
    .join(" / ");
}
