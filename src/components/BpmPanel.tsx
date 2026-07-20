import { useEffect, useState } from "react";
import { Activity, Check, LoaderCircle, Pause, PencilLine, Play } from "lucide-react";
import type {
  BpmCandidateSource,
  ClickTempoOption,
  ClickTempoRelation,
  TempoDetectorOption,
} from "../audio/bpmCandidates";
import type { AppCopy } from "../i18n";
import { formatBpm } from "../utils/format";

type AnalysisStatus = "idle" | "loading" | "analyzing" | "complete" | "failed";

type BpmPanelProps = {
  status: AnalysisStatus;
  detectors: TempoDetectorOption[];
  selectedDetector: BpmCandidateSource | null;
  baseDetectedBpm: number | null;
  clickOptions: ClickTempoOption[];
  selectedRelation: ClickTempoRelation;
  clickBpm: number | null;
  targetBpm: number;
  tempoRatio: number;
  copy: AppCopy["bpm"];
  isAuditioning: boolean;
  onDetectorChange: (source: BpmCandidateSource) => void;
  onRelationChange: (relation: ClickTempoRelation) => void;
  onTargetBpmChange: (value: number) => void;
  onAudition: () => void;
};

const TARGET_PRESETS = [170, 175, 180, 185, 190, 195];
const MIN_TARGET_BPM = 40;
const MAX_TARGET_BPM = 240;

export function BpmPanel({
  status,
  detectors,
  selectedDetector,
  baseDetectedBpm,
  clickOptions,
  selectedRelation,
  clickBpm,
  targetBpm,
  tempoRatio,
  copy,
  isAuditioning,
  onDetectorChange,
  onRelationChange,
  onTargetBpmChange,
  onAudition,
}: BpmPanelProps) {
  const [targetDraft, setTargetDraft] = useState(String(targetBpm));
  const basicOptions = clickOptions.filter((option) => !option.advanced);
  const advancedOptions = clickOptions.filter((option) => option.advanced);
  const isMatching = status === "loading" || status === "analyzing";
  const isAutoMatched =
    clickOptions.find((option) => option.relation === selectedRelation)
      ?.recommended ?? false;
  const tempoSpeedLabel = getTempoSpeedLabel(tempoRatio, copy);

  useEffect(() => {
    setTargetDraft(String(targetBpm));
  }, [targetBpm]);

  const commitTargetDraft = () => {
    if (targetDraft === "" || targetDraft === ".") {
      setTargetDraft(String(targetBpm));
      return;
    }

    const value = Number(targetDraft);
    if (!Number.isFinite(value)) {
      setTargetDraft(String(targetBpm));
      return;
    }

    const clamped = Math.max(MIN_TARGET_BPM, Math.min(MAX_TARGET_BPM, value));
    onTargetBpmChange(clamped);
    setTargetDraft(String(clamped));
  };

  const renderRatioOptions = (options: ClickTempoOption[]) => (
    <div className="segmented click-ratio-options">
      {options.map((option) => (
        <button
          key={option.relation}
          type="button"
          className={option.relation === selectedRelation ? "active" : ""}
          onClick={() => onRelationChange(option.relation)}
        >
          {option.relation === selectedRelation ? <Check size={15} /> : null}
          <span>{option.relation}</span>
          <small>{copy.relationshipDescriptions[option.relation]}</small>
        </button>
      ))}
    </div>
  );

  return (
    <section className="panel" aria-labelledby="bpm-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="bpm-title">{copy.title}</h2>
        </div>
        <Activity aria-hidden="true" />
      </div>

      <div className="pace-decision-grid">
        <section className="pace-target-card" aria-label={copy.targetLabel}>
          <div className="pace-target-heading">
            <span>{copy.targetLabel}</span>
            <output className="pace-target-readout">
              <strong>{targetBpm}</strong>
              <small>BPM</small>
            </output>
          </div>
          <div className="segmented pace-target-options">
            {TARGET_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={targetBpm === preset ? "active" : ""}
                onClick={() => onTargetBpmChange(preset)}
              >
                {preset}
              </button>
            ))}
            <label className="custom-cadence-input">
              <span>
                <PencilLine size={14} aria-hidden="true" />
                {copy.customCadenceLabel}
              </span>
              <input
                aria-label={copy.customTargetAria}
                type="text"
                inputMode="decimal"
                placeholder="183"
                value={targetDraft}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  if (!/^\d*\.?\d*$/.test(rawValue)) {
                    return;
                  }

                  setTargetDraft(rawValue);
                  if (rawValue === "" || rawValue === "." || rawValue.endsWith(".")) {
                    return;
                  }

                  const value = Number(rawValue);
                  if (
                    Number.isFinite(value) &&
                    value >= MIN_TARGET_BPM &&
                    value <= MAX_TARGET_BPM
                  ) {
                    onTargetBpmChange(value);
                  }
                }}
                onBlur={commitTargetDraft}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              <small>BPM</small>
            </label>
          </div>
          <p className="field-hint">{copy.targetRecommendationHint}</p>
        </section>

        <div
          className={`matched-setup ${isMatching ? "is-matching" : ""}`}
          aria-live="polite"
          aria-busy={isMatching}
        >
          <div className="matched-setup-heading">
            <span>{copy.setupLabel}</span>
            {!isMatching && detectors.length > 0 ? (
              <div className="matched-setup-controls">
                {isAutoMatched && clickBpm !== null ? (
                  <span className="candidate-recommended">{copy.autoMatchedLabel}</span>
                ) : null}
                <label className="matched-model-select">
                  <span>{copy.modelLabel}</span>
                  <select
                    value={selectedDetector ?? ""}
                    onChange={(event) =>
                      onDetectorChange(event.target.value as BpmCandidateSource)
                    }
                  >
                    {detectors.map((detector) => (
                      <option key={detector.source} value={detector.source}>
                        {copy.candidateSources[detector.source]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
          {isMatching ? (
            <div className="matched-loading">
              <LoaderCircle className="matched-loading-icon" aria-hidden="true" />
              <div>
                <strong>{copy.matchingLabel}</strong>
                <p>{copy.matchingHint}</p>
              </div>
              <div className="matched-analysis-list">
                <span>{copy.analysisModels.essentia}</span>
                <em>{copy.analysisModels.checking}</em>
                <span>{copy.analysisModels.tempocnn}</span>
                <em>{copy.analysisModels.checking}</em>
              </div>
            </div>
          ) : detectors.length > 0 && clickBpm !== null ? (
            <div className="setup-metrics">
              <div>
                <small>{copy.summary.detected}</small>
                <strong>{formatBpm(baseDetectedBpm)}</strong>
              </div>
              <div>
                <small>{copy.musicSpeedLabel}</small>
                <strong className="tempo-speed-value">
                  {tempoSpeedLabel.value}
                  {tempoSpeedLabel.qualifier ? (
                    <small>{tempoSpeedLabel.qualifier}</small>
                  ) : null}
                </strong>
              </div>
              <div>
                <small>{copy.summary.relationship}</small>
                <strong>{selectedRelation}</strong>
                <em>{copy.relationshipDescriptions[selectedRelation]}</em>
              </div>
            </div>
          ) : (
            <strong>{copy.noCandidates}</strong>
          )}
          {!isMatching && detectors.length > 0 && clickBpm !== null ? (
            <>
              <p>{copy.songUnchangedHint}</p>
              <div className="candidate-audition">
                <button
                  type="button"
                  className="primary-action"
                  onClick={onAudition}
                >
                  {isAuditioning ? <Pause size={17} /> : <Play size={17} />}
                  {isAuditioning
                    ? copy.stopAudition
                    : copy.auditionMatchedTarget(formatBpm(clickBpm))}
                </button>
                <small>{copy.auditionHint}</small>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {detectors.length > 0 ? (
        <details className="setup-adjustments">
          <summary>{copy.adjustSetupLabel}</summary>
          <div className="setup-adjustments-content">
            <div className="field-group">
              <label>{copy.clickRatioLabel}</label>
              {renderRatioOptions(basicOptions)}
              {advancedOptions.length > 0 ? (
                <details className="advanced-ratios">
                  <summary>{copy.advancedRatiosLabel}</summary>
                  <p>{copy.advancedRatiosHint}</p>
                  {renderRatioOptions(advancedOptions)}
                </details>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}

    </section>
  );
}

function getTempoSpeedLabel(
  tempoRatio: number,
  copy: AppCopy["bpm"],
): { value: string; qualifier: string | null } {
  const percentage = Math.round(Math.abs(tempoRatio - 1) * 100);
  if (percentage < 1) {
    return { value: copy.originalSpeedLabel, qualifier: null };
  }

  return tempoRatio > 1
    ? {
        value: copy.speedUpAmount(percentage),
        qualifier: copy.speedUpQualifier,
      }
    : {
        value: copy.slowDownAmount(percentage),
        qualifier: copy.slowDownQualifier,
      };
}
