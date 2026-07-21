import { CircleAlert, LibraryBig, ShieldCheck } from "lucide-react";
import type { LibraryCoverageReport } from "../domain/mixTypes";
import type { MultiTrackCopy } from "./multiTrackFormat";

export function LibraryCoveragePanel({
  report,
  copy,
}: {
  report: LibraryCoverageReport;
  copy: MultiTrackCopy["coverage"];
}) {
  const isComplete = report.missingCadences.length === 0;

  return (
    <section className="panel planner-panel coverage-panel" aria-labelledby="coverage-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="coverage-title">{copy.title}</h2>
        </div>
        <LibraryBig aria-hidden="true" />
      </div>

      <div className={`coverage-hero ${isComplete ? "complete" : "missing"}`}>
        <span className="coverage-hero-icon" aria-hidden="true">
          {isComplete ? <ShieldCheck size={24} /> : <CircleAlert size={24} />}
        </span>
        <div>
          <strong>{copy.percent(report.coveragePercent)}</strong>
          <p>
            {isComplete
              ? copy.completeHint
              : copy.missingHint(report.missingCadences.length)}
          </p>
        </div>
      </div>

      <div className="coverage-cadence-grid">
        {report.items.map((item) => (
          <div className={`coverage-cadence ${item.status}`} key={item.targetCadence}>
            <strong>{item.targetCadence} BPM</strong>
            <span>{copy.status[item.status]}</span>
            <small>
              {copy.trackBreakdown(
                item.finishedTrackCount,
                item.rawTrackCount,
              )}
            </small>
          </div>
        ))}
      </div>

      {report.missingCadences.length > 0 ? (
        <p className="coverage-recommendation">
          {copy.makeInSingle(report.missingCadences.join(", "))}
        </p>
      ) : report.thinCadences.length > 0 ? (
        <p className="coverage-recommendation warning">
          {copy.thinRecommendation(report.thinCadences.join(", "))}
        </p>
      ) : null}
    </section>
  );
}
