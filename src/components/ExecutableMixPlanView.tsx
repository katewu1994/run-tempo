import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ImagePlus,
  Layers,
  LoaderCircle,
  Palette,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  createGeneratedCoverTheme,
  type GeneratedCoverInput,
} from "../audio/generateCoverArt";
import type { ExecutableMixPlan } from "../domain/mixTypes";
import { formatDuration, formatSeconds } from "../utils/format";
import {
  createMultiTrackDefaultName,
  normalizeMultiTrackWavFileName,
} from "../utils/multiTrackExport";
import { type MultiTrackCopy } from "./multiTrackFormat";

const COVER_COLOR_OPTIONS = [267, 218, 176, 118, 30, 52, 2, 346, 294, 194, 148, 338];

export type ExportRenderPhase = "mix" | "artwork" | "encode";

type ExecutableMixPlanViewProps = {
  executablePlan: ExecutableMixPlan;
  planModeLabel: string;
  planningDirectionLabel: string;
  copy: MultiTrackCopy["executable"];
  isRendering: boolean;
  renderIntent: "export" | null;
  exportRenderPhase: ExportRenderPhase | null;
  renderError: string | null;
  onExportWav: (settings: MultiTrackExportSettings) => void;
};

export type MultiTrackExportSettings = {
  fileName: string;
  artworkFile: File | null;
  generatedCoverInput: GeneratedCoverInput;
};

export function ExecutableMixPlanView({
  executablePlan,
  planModeLabel,
  planningDirectionLabel,
  copy,
  isRendering,
  renderIntent,
  exportRenderPhase,
  renderError,
  onExportWav,
}: ExecutableMixPlanViewProps) {
  const warnings = getRenderWarnings(executablePlan, copy);
  const defaultName = useMemo(
    () =>
      createMultiTrackDefaultName(
        planModeLabel,
        executablePlan.totalDurationSec,
        planningDirectionLabel,
      ),
    [executablePlan.totalDurationSec, planModeLabel, planningDirectionLabel],
  );
  const defaultFileName = `${defaultName}.wav`;
  const [fileName, setFileName] = useState(defaultFileName);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [coverHue, setCoverHue] = useState(218);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const artworkPreviewUrl = useMemo(
    () => (artworkFile ? URL.createObjectURL(artworkFile) : null),
    [artworkFile],
  );
  const resolvedFileName = normalizeMultiTrackWavFileName(
    fileName,
    defaultFileName,
  );
  const coverDurationLabel = useMemo(
    () => formatCoverDuration(executablePlan.totalDurationSec),
    [executablePlan.totalDurationSec],
  );
  const generatedCoverInput = useMemo<GeneratedCoverInput>(
    () => ({
      title: "PLAN MODE",
      artist: "",
      kicker: "RUN TEMPO",
      template: "multi_track_plan",
      durationLabel: coverDurationLabel,
      hue: coverHue,
    }),
    [coverDurationLabel, coverHue],
  );
  const generatedCoverTheme = useMemo(
    () => createGeneratedCoverTheme(generatedCoverInput),
    [generatedCoverInput],
  );
  const exportPhases = ["mix", "artwork", "encode"] as const;
  const activeExportPhaseIndex = exportRenderPhase
    ? exportPhases.indexOf(exportRenderPhase)
    : -1;

  useEffect(() => {
    setFileName(defaultFileName);
    setArtworkFile(null);
    setCoverHue(218);
    setIsColorPickerOpen(false);
  }, [defaultFileName]);

  useEffect(
    () => () => {
      if (artworkPreviewUrl) {
        URL.revokeObjectURL(artworkPreviewUrl);
      }
    },
    [artworkPreviewUrl],
  );

  return (
    <section
      className="panel planner-panel executable-mix-panel"
      aria-labelledby="executable-title"
      aria-busy={isRendering}
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="executable-title">{copy.title}</h2>
        </div>
        <Layers aria-hidden="true" />
      </div>

      <dl className="multi-export-plan-summary">
        <div>
          <dt>{copy.summary.planMode}</dt>
          <dd>{planModeLabel}</dd>
        </div>
        <div>
          <dt>{copy.summary.totalDuration}</dt>
          <dd>{formatDuration(executablePlan.totalDurationSec)}</dd>
        </div>
        <div>
          <dt>{copy.summary.planningDirection}</dt>
          <dd>{planningDirectionLabel}</dd>
        </div>
      </dl>

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

      <section
        className="multi-export-editor"
        aria-label={copy.exportSettingsTitle}
      >
        <div className="multi-export-controls">
          <section className="multi-cover-designer" aria-label={copy.coverTitle}>
            <div className="cover-art-preview multi-cover-preview" aria-live="polite">
              {artworkPreviewUrl ? (
                <img src={artworkPreviewUrl} alt={copy.coverPreviewAlt} />
              ) : (
                <div
                  className="generated-cover-preview multi-plan-cover-preview"
                  style={
                    {
                      background: generatedCoverTheme.background,
                      "--generated-cover-accent": generatedCoverTheme.accent,
                    } as CSSProperties
                  }
                  aria-label={copy.generatedCoverAlt}
                >
                  <span className="generated-cover-kicker">RUN TEMPO</span>
                  <strong>
                    <span>PLAN MODE</span>
                    <span>{coverDurationLabel}</span>
                  </strong>
                </div>
              )}
            </div>

            <div className="multi-cover-controls">
              <div className="cover-art-actions">
                <label
                  className={`secondary-action cover-upload-action${
                    isRendering ? " is-disabled" : ""
                  }`}
                >
                  <ImagePlus size={16} aria-hidden="true" />
                  {artworkFile ? copy.replaceCover : copy.uploadCover}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png"
                    disabled={isRendering}
                    onChange={(event) => {
                      setArtworkFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {!artworkFile ? (
                  <div className="cover-color-control">
                    <button
                      type="button"
                      className="secondary-action cover-color-trigger"
                      aria-expanded={isColorPickerOpen}
                      aria-controls="multi-cover-color-palette"
                      aria-label={copy.coverColor}
                      title={copy.coverColor}
                      disabled={isRendering}
                      style={{ "--swatch-hue": coverHue } as CSSProperties}
                      onClick={() => setIsColorPickerOpen((isOpen) => !isOpen)}
                    >
                      <Palette size={16} aria-hidden="true" />
                    </button>
                    {isColorPickerOpen ? (
                      <div
                        id="multi-cover-color-palette"
                        className="cover-color-palette"
                        role="group"
                        aria-label={copy.colorPickerLabel}
                      >
                        <span>{copy.colorPickerLabel}</span>
                        <div>
                          {COVER_COLOR_OPTIONS.map((hue) => (
                            <button
                              key={hue}
                              type="button"
                              className={coverHue === hue ? "selected" : ""}
                              style={{ "--swatch-hue": hue } as CSSProperties}
                              aria-label={copy.coverColorOption(hue)}
                              aria-pressed={coverHue === hue}
                              onClick={() => {
                                setCoverHue(hue);
                                setIsColorPickerOpen(false);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={isRendering}
                    onClick={() => {
                      setArtworkFile(null);
                      setIsColorPickerOpen(false);
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                    {copy.removeCover}
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="multi-export-file-panel">
            <label className="export-field multi-export-file-name">
              <span>{copy.fileNameLabel}</span>
              <input
                type="text"
                value={fileName}
                maxLength={160}
                disabled={isRendering}
                placeholder={copy.fileNamePlaceholder}
                onChange={(event) => setFileName(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <div
        className={`export-ready-card multi-export-ready-card${
          isRendering ? " is-processing" : ""
        }`}
        role={isRendering ? "status" : undefined}
        aria-live={isRendering ? "polite" : undefined}
      >
        <div className="export-ready-icon">
          {isRendering ? (
            <span className="output-processing-glyph" aria-hidden="true">
              <LoaderCircle size={23} />
              <i />
              <i />
              <i />
            </span>
          ) : (
            <CheckCircle2 size={22} aria-hidden="true" />
          )}
        </div>
        <div className="export-target">
          <span>{isRendering ? copy.processingOutput : copy.output}</span>
          <strong>{resolvedFileName}</strong>
          {isRendering && exportRenderPhase ? (
            <div className="output-processing-stages" aria-label={copy.processingStagesLabel}>
              {exportPhases.map((phase, index) => (
                <span
                  key={phase}
                  className={
                    index < activeExportPhaseIndex
                      ? "is-complete"
                      : index === activeExportPhaseIndex
                        ? "is-current"
                        : ""
                  }
                >
                  <i aria-hidden="true" />
                  {copy.renderPhases[phase]}
                </span>
              ))}
            </div>
          ) : (
            <small>{copy.outputHint}</small>
          )}
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={isRendering}
          onClick={() =>
            onExportWav({
              fileName: resolvedFileName,
              artworkFile,
              generatedCoverInput,
            })
          }
        >
          {renderIntent === "export" ? (
            <LoaderCircle className="action-spinner" size={18} aria-hidden="true" />
          ) : (
            <Download size={18} aria-hidden="true" />
          )}
          {renderIntent === "export" ? copy.renderingExport : copy.exportWav}
        </button>
      </div>

      {renderError ? <p className="error-text">{renderError}</p> : null}
    </section>
  );
}

function formatCoverDuration(totalDurationSec: number): string {
  const minutes = Math.round((totalDurationSec / 60) * 10) / 10;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
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
