import { Gauge, Repeat2, Route, TrendingUp } from "lucide-react";
import type { RunningPlan } from "../domain/mixTypes";
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

type RunningPlanSelectorProps = {
  plan: RunningPlan;
  settings: RunningPlanSettings;
  copy: MultiTrackCopy["runningPlan"];
  onChange: (settings: RunningPlanSettings) => void;
};

const MODES: RunningPlanMode[] = ["constant", "progressive", "interval"];

export function RunningPlanSelector({
  plan,
  settings,
  copy,
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

  const updateProgressive = (
    key: keyof RunningPlanSettings["progressive"],
    value: number,
  ) => {
    onChange({
      ...settings,
      progressive: {
        ...settings.progressive,
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

  const updateMaxStretchPercent = (value: number) => {
    onChange({
      ...settings,
      maxStretchPercent: value,
    });
  };

  return (
    <section className="panel planner-panel" aria-labelledby="plan-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="plan-title">{copy.title}</h2>
        </div>
        <Route aria-hidden="true" />
      </div>

      <div className="plan-builder-grid">
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
                  className={`plan-mode-option ${
                    settings.mode === mode ? "active" : ""
                  }`}
                  aria-pressed={settings.mode === mode}
                  onClick={() => updateMode(mode)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{copy.modes[mode]}</span>
                  <small>{copy.modeDescriptions[mode]}</small>
                </button>
              );
            })}
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

          {settings.mode === "progressive" ? (
            <>
              <NumberField
                label={copy.fields.startBpm}
                value={settings.progressive.startBpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateProgressive("startBpm", value)}
              />
              <NumberField
                label={copy.fields.peakBpm}
                value={settings.progressive.peakBpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateProgressive("peakBpm", value)}
              />
              <NumberField
                label={copy.fields.endBpm}
                value={settings.progressive.endBpm}
                min={MIN_RUNNING_BPM}
                max={MAX_RUNNING_BPM}
                step={1}
                suffix={copy.units.bpm}
                onChange={(value) => updateProgressive("endBpm", value)}
              />
              <NumberField
                label={copy.fields.warmup}
                value={settings.progressive.warmupMin}
                min={0}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateProgressive("warmupMin", value)}
              />
              <NumberField
                label={copy.fields.build}
                value={settings.progressive.buildMin}
                min={1}
                max={180}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateProgressive("buildMin", value)}
              />
              <NumberField
                label={copy.fields.hold}
                value={settings.progressive.holdMin}
                min={0}
                max={120}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateProgressive("holdMin", value)}
              />
              <NumberField
                label={copy.fields.cooldown}
                value={settings.progressive.cooldownMin}
                min={0}
                max={60}
                step={0.5}
                suffix={copy.units.minutes}
                onChange={(value) => updateProgressive("cooldownMin", value)}
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

          <NumberField
            label={copy.fields.maxStretch}
            value={settings.maxStretchPercent}
            min={0}
            max={30}
            step={0.5}
            suffix={copy.units.percent}
            onChange={updateMaxStretchPercent}
          />
        </div>
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

      <div className="table-wrap compact-table">
        <table className="planner-table">
          <thead>
            <tr>
              <th scope="col">{copy.headers.segment}</th>
              <th scope="col">{copy.headers.time}</th>
              <th scope="col">{copy.headers.cadence}</th>
              <th scope="col">{copy.headers.energy}</th>
              <th scope="col">{copy.headers.maxStretch}</th>
            </tr>
          </thead>
          <tbody>
            {plan.segments.map((segment) => (
              <tr key={segment.segmentId}>
                <td>{getLocalizedSegmentName(copy.segmentNames, segment.name)}</td>
                <td>
                  {formatDuration(segment.startSec)}-{formatDuration(segment.endSec)}
                </td>
                <td>{formatSegmentCadence(segment)}</td>
                <td>
                  {segment.targetEnergyRange.min}-{segment.targetEnergyRange.max}
                </td>
                <td>{segment.maxStretchPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  if (mode === "progressive") {
    return TrendingUp;
  }

  if (mode === "interval") {
    return Repeat2;
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
