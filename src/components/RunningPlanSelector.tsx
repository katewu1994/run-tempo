import { Gauge, Plus, Repeat2, Route, SlidersHorizontal, Trash2 } from "lucide-react";
import type { LibraryCoverageReport, RunningPlan, RunSegmentName } from "../domain/mixTypes";
import {
  MAX_RUNNING_BPM,
  MIN_RUNNING_BPM,
  type RunningPlanMode,
  type RunningPlanSettings,
} from "../domain/runningPlanBuilder";
import { formatDuration } from "../utils/format";
import {
  formatSegmentCadence,
  getLocalizedSegmentName,
  type MultiTrackCopy,
} from "./multiTrackFormat";
import { LibraryCoveragePanel } from "./LibraryCoveragePanel";

type RunningPlanSelectorProps = {
  plan: RunningPlan;
  settings: RunningPlanSettings;
  copy: MultiTrackCopy["runningPlan"];
  coverageReport?: LibraryCoverageReport | null;
  coverageCopy?: MultiTrackCopy["coverage"];
  onChange: (settings: RunningPlanSettings) => void;
};

const MODES: RunningPlanMode[] = ["constant", "interval", "custom"];
const CUSTOM_SEGMENT_TYPES: RunSegmentName[] = [
  "warmup", "steady", "tempo", "recovery", "finish", "cooldown",
];

export function RunningPlanSelector({
  plan,
  settings,
  copy,
  coverageReport,
  coverageCopy,
  onChange,
}: RunningPlanSelectorProps) {
  const updateMode = (mode: RunningPlanMode) => {
    onChange({ ...settings, mode });
  };

  const updateConstant = (
    key: keyof RunningPlanSettings["constant"],
    value: number,
  ) => {
    onChange({
      ...settings,
      constant: {
        ...settings.constant,
        [key]: value,
      },
    });
  };

  const updateInterval = (
    key: keyof RunningPlanSettings["interval"],
    value: number,
  ) => {
    onChange({
      ...settings,
      interval: {
        ...settings.interval,
        [key]: value,
      },
    });
  };

  const updateDuration = (durationMin: number) => {
    updateConstant("durationMin", durationMin);
  };

  const updateCustomPart = (
    partId: string,
    change: Partial<RunningPlanSettings["custom"]["parts"][number]>,
  ) => {
    onChange({
      ...settings,
      custom: {
        parts: settings.custom.parts.map((part) =>
          part.partId === partId ? { ...part, ...change } : part,
        ),
      },
    });
  };

  const addCustomPart = () => {
    const previous = settings.custom.parts[settings.custom.parts.length - 1];
    onChange({
      ...settings,
      custom: {
        parts: [
          ...settings.custom.parts,
          {
            partId: `custom-${Date.now()}`,
            name: "steady",
            durationMin: 5,
            bpm: previous?.bpm ?? 180,
          },
        ],
      },
    });
  };

  const removeCustomPart = (partId: string) => {
    if (settings.custom.parts.length <= 1) return;
    onChange({
      ...settings,
      custom: { parts: settings.custom.parts.filter((part) => part.partId !== partId) },
    });
  };

  return (
    <section className="panel planner-panel running-plan-builder" aria-labelledby="plan-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="plan-title">{copy.title}</h2>
        </div>
        <Route aria-hidden="true" />
      </div>

      <div className="plan-mode-group">
        <span className="plan-section-label">{copy.modeLabel}</span>
        <div className="plan-mode-options" role="list">
          {MODES.map((mode) => {
            const Icon = getModeIcon(mode);

            return (
              <button
                type="button"
                role="listitem"
                key={mode}
                data-plan-mode={mode}
                className={`plan-mode-option ${settings.mode === mode ? "active" : ""}`}
                aria-pressed={settings.mode === mode}
                onClick={() => updateMode(mode)}
              >
                <span className="plan-mode-icon"><Icon size={17} aria-hidden="true" /></span>
                <span className="plan-mode-copy">
                  <strong>{copy.modes[mode]}</strong>
                  <small>{copy.modeDescriptions[mode]}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`plan-settings-card mode-${settings.mode}`}>
        <div className="plan-settings-heading">
          <div>
            <span>{copy.settingsLabel}</span>
            <strong>{copy.modes[settings.mode]}</strong>
          </div>
        </div>
        <div className="plan-fields">
          {settings.mode === "constant" ? (
            <>
              <NumberField
                label={copy.fields.duration}
                value={settings.constant.durationMin}
                min={1}
                max={240}
                step={1}
                suffix={copy.units.minutes}
                onChange={(value) => updateConstant("durationMin", value)}
              />
              <NumberField
                label={copy.fields.bpm}
                value={settings.constant.bpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateConstant("bpm", value)}
              />
            </>
          ) : null}

          {settings.mode === "interval" ? (
            <>
              <NumberField
                label={copy.fields.fastBpm}
                value={settings.interval.fastBpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateInterval("fastBpm", value)}
              />
              <NumberField
                label={copy.fields.slowBpm}
                value={settings.interval.slowBpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateInterval("slowBpm", value)}
              />
              <NumberField
                label={copy.fields.fastDuration}
                value={settings.interval.fastMin}
                min={0.5}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateInterval("fastMin", value)}
              />
              <NumberField
                label={copy.fields.slowDuration}
                value={settings.interval.slowMin}
                min={0.5}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateInterval("slowMin", value)}
              />
              <NumberField
                label={copy.fields.repeats}
                value={settings.interval.repeats}
                min={1}
                max={30}
                step={1}
                suffix={copy.units.repeats}
                onChange={(value) => updateInterval("repeats", value)}
              />
              <NumberField
                label={copy.fields.warmup}
                value={settings.interval.warmupMin}
                min={0}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateInterval("warmupMin", value)}
              />
              <NumberField
                label={copy.fields.cooldown}
                value={settings.interval.cooldownMin}
                min={0}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateInterval("cooldownMin", value)}
              />
            </>
          ) : null}

          {settings.mode === "custom" ? (
            <div className="custom-plan-editor">
              {settings.custom.parts.map((part, index) => (
                <div className={`custom-plan-part ${part.name}`} key={part.partId}>
                  <span className="custom-plan-part-number">{index + 1}</span>
                  <label className="plan-field custom-plan-type">
                    <span>{copy.fields.partType}</span>
                    <div className="plan-input-wrap">
                      <select
                        value={part.name}
                        onChange={(event) => updateCustomPart(part.partId, {
                          name: event.target.value as RunSegmentName,
                        })}
                      >
                        {CUSTOM_SEGMENT_TYPES.map((name) => (
                          <option value={name} key={name}>
                            {getLocalizedSegmentName(copy.segmentNames, name)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <NumberField
                    label={copy.fields.partDuration}
                    value={part.durationMin}
                    min={0.5}
                    max={60}
                    step={0.5}
                    suffix={copy.units.minutes}
                    onChange={(value) => updateCustomPart(part.partId, { durationMin: value })}
                  />
                  <NumberField
                    label={copy.fields.bpm}
                    value={part.bpm}
                    min={MIN_RUNNING_BPM}
                    max={MAX_RUNNING_BPM}
                    step={1}
                    suffix={copy.units.bpm}
                    onChange={(value) => updateCustomPart(part.partId, { bpm: value })}
                  />
                  <button
                    type="button"
                    className="icon-action custom-plan-remove"
                    aria-label={copy.removePart}
                    disabled={settings.custom.parts.length <= 1}
                    onClick={() => removeCustomPart(part.partId)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="secondary-button custom-plan-add" onClick={addCustomPart}>
                <Plus size={15} aria-hidden="true" />
                {copy.addPart}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="plan-preview-card">
        <div className="plan-preview-heading">
          <span>{copy.previewLabel}</span>
          <strong>{formatDuration(plan.totalDurationSec)}</strong>
        </div>
        <div className="plan-timeline" aria-label={copy.timelineLabel}>
          {plan.segments.map((segment) => (
            <div
              key={segment.segmentId}
              className={`plan-timeline-segment ${segment.name}`}
              style={{ flexGrow: segment.endSec - segment.startSec }}
              title={`${getLocalizedSegmentName(
                copy.segmentNames,
                segment.name,
              )}: ${formatSegmentCadence(segment)}`}
            >
              <span>{getLocalizedSegmentName(copy.segmentNames, segment.name)}</span>
              <strong>{formatSegmentCadence(segment)}</strong>
            </div>
          ))}
        </div>

        {coverageReport && coverageCopy ? (
          <div className="plan-coverage">
            <LibraryCoveragePanel report={coverageReport} copy={coverageCopy} />
          </div>
        ) : null}
      </div>

    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="plan-field">
      <span>{label}</span>
      <div className="plan-input-wrap">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            if (event.target.value === "") {
              onChange(min);
              return;
            }

            const nextValue = Number(event.target.value);
            if (Number.isFinite(nextValue)) {
              onChange(nextValue);
            }
          }}
          onBlur={(event) =>
            onChange(
              normalizeInputValue(Number(event.currentTarget.value), min, max, step),
            )
          }
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
}

function getModeIcon(mode: RunningPlanMode) {
  if (mode === "interval") {
    return Repeat2;
  }

  if (mode === "custom") {
    return SlidersHorizontal;
  }

  return Gauge;
}

function formatCadence(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function normalizeInputValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  const clamped = Math.max(min, Math.min(max, value));
  const stepped = Math.round(clamped / step) * step;
  return Number(stepped.toFixed(getStepDecimals(step)));
}

function getStepDecimals(step: number): number {
  const decimalPart = step.toString().split(".")[1];
  return decimalPart ? decimalPart.length : 0;
}
