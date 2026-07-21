import { AlertTriangle, Download, Layers, Play } from "lucide-react";
import type { ExecutableMixPlan, TrackFeature } from "../domain/mixTypes";
import { formatDuration, formatSeconds } from "../utils/format";
import {
  formatCadenceTarget,
  getLocalizedStretchDecision,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type ExecutableMixPlanViewProps = {
  tracks: TrackFeature[];
  executablePlan: ExecutableMixPlan;
  copy: MultiTrackCopy["executable"];
  isRendering: boolean;
  renderedDurationSec: number | null;
  renderError: string | null;
  onRenderPreview: () => void;
  onExportWav: () => void;
};

export function ExecutableMixPlanView({
  tracks,
  executablePlan,
  copy,
  isRendering,
  renderedDurationSec,
  renderError,
  onRenderPreview,
  onExportWav,
}: ExecutableMixPlanViewProps) {
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
  const warnings = getRenderWarnings(executablePlan, copy);

  return (
    <section className="panel planner-panel" aria-labelledby="executable-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="executable-title">{copy.title}</h2>
        </div>
        <Layers aria-hidden="true" />
      </div>

      <dl className="summary-grid planner-summary">
        <div>
          <dt>{copy.summary.totalDuration}</dt>
          <dd>{formatDuration(executablePlan.totalDurationSec)}</dd>
        </div>
      </dl>

      <ol className="simple-mix-list">
        {executablePlan.blocks.map((block) => (
          <li key={block.blockId}>
            <span>{tracksById.get(block.trackId)?.fileName ?? block.trackId}</span>
            <small>
              {formatDuration(block.mixStartSec)}–{formatDuration(block.mixEndSec)}
            </small>
          </li>
        ))}
      </ol>

      {warnings.length > 0 ? (
        <div className="render-warning-list" role="status">
          {warnings.map((warning) => (
            <p key={warning}>
              <AlertTriangle size={16} aria-hidden="true" />
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <div className="action-grid compact render-actions">
        <button
          type="button"
          className="secondary-action"
          disabled={isRendering}
          onClick={onRenderPreview}
        >
          <Play size={18} aria-hidden="true" />
          {isRendering ? copy.renderingMix : copy.renderPreview}
        </button>
        <button
          type="button"
          className="primary-action"
          disabled={isRendering}
          onClick={onExportWav}
        >
          <Download size={18} aria-hidden="true" />
          {copy.exportWav}
        </button>
      </div>

      {renderedDurationSec !== null ? (
        <p className="planner-status">
          {copy.renderReady(formatDuration(renderedDurationSec))}
        </p>
      ) : null}
      {renderError ? <p className="error-text">{renderError}</p> : null}
    </section>
  );
}

function getRenderWarnings(
  executablePlan: ExecutableMixPlan,
  copy: MultiTrackCopy["executable"],
): string[] {
  const skipStretchCount = executablePlan.blocks.filter(
    (block) => block.stretchDecision === "skip_stretch",
  ).length;
  const coveredDurationSec = getCoveredDurationSec(executablePlan);
  const missingDurationSec = Math.max(
    0,
    executablePlan.totalDurationSec - coveredDurationSec,
  );
  const warnings: string[] = [];

  if (skipStretchCount > 0) {
    warnings.push(copy.warnings.skipStretch(skipStretchCount));
  }

  if (missingDurationSec > 0.05) {
    warnings.push(copy.warnings.unfilledDuration(formatSeconds(missingDurationSec)));
  }

  return warnings;
}

function getCoveredDurationSec(executablePlan: ExecutableMixPlan): number {
  const intervals = executablePlan.blocks
    .map((block) => ({
      start: Math.max(0, Math.min(block.mixStartSec, executablePlan.totalDurationSec)),
      end: Math.max(0, Math.min(block.mixEndSec, executablePlan.totalDurationSec)),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  let coveredDurationSec = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;

  for (const interval of intervals) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
      continue;
    }

    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }

    coveredDurationSec += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }

  if (currentStart !== null) {
    coveredDurationSec += currentEnd - currentStart;
  }

  return coveredDurationSec;
}
