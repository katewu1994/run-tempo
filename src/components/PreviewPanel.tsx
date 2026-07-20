import {
  AudioLines,
  Headphones,
  Pause,
  Play,
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { AccentEvery, ClickStyle, MetronomeSettings } from "../audio/types";
import type { AppCopy } from "../i18n";
import { formatPercent } from "../utils/format";

type PlaybackMode = "idle" | "mix";
const CLICK_STYLES: ClickStyle[] = ["soft", "sharp", "wood"];
const ACCENTS: AccentEvery[] = [0, 2, 4];

type PreviewPanelProps = {
  playbackMode: PlaybackMode;
  disabled: boolean;
  masterGain: number;
  metronomeVolume: number;
  copy: AppCopy["preview"];
  metronomeCopy: AppCopy["metronome"];
  metronomeSettings: MetronomeSettings;
  onMasterGainChange: (value: number) => void;
  onClickVolumeChange: (value: number) => void;
  onMetronomeSettingsChange: (settings: MetronomeSettings) => void;
  onPlayMixPreview: () => void;
  onStop: () => void;
};

export function PreviewPanel({
  playbackMode,
  disabled,
  masterGain,
  metronomeVolume,
  copy,
  metronomeCopy,
  metronomeSettings,
  onMasterGainChange,
  onClickVolumeChange,
  onMetronomeSettingsChange,
  onPlayMixPreview,
  onStop,
}: PreviewPanelProps) {
  const isMixPlaying = playbackMode === "mix";

  return (
    <section className="panel" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="preview-title">{copy.title}</h2>
        </div>
        <Headphones aria-hidden="true" />
      </div>

      <details
        className={`metronome-settings-card${isMixPlaying ? " is-locked" : ""}`}
        aria-disabled={isMixPlaying}
      >
        <summary
          onClick={(event) => {
            if (isMixPlaying) {
              event.preventDefault();
            }
          }}
        >
          <span className="settings-summary-icon" aria-hidden="true">
            <AudioLines size={18} />
          </span>
          <span className="settings-summary-copy">
            <strong>{metronomeCopy.title}</strong>
            <small>
              {metronomeCopy.clickStyleLabels[metronomeSettings.clickStyle]}
              <span aria-hidden="true"> · </span>
              {metronomeSettings.accentEvery === 0
                ? metronomeCopy.noAccent
                : metronomeCopy.everyAccent(metronomeSettings.accentEvery)}
            </small>
          </span>
          <span className="settings-summary-action">
            {isMixPlaying ? copy.stopPreviewToEdit : copy.customizeLabel}
          </span>
        </summary>
        <div className="metronome-settings-content">
          <div className="field-group">
            <label>{metronomeCopy.clickStyleLabel}</label>
            <div className="segmented">
              {CLICK_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  disabled={disabled || isMixPlaying}
                  className={metronomeSettings.clickStyle === style ? "active" : ""}
                  onClick={() =>
                    onMetronomeSettingsChange({ ...metronomeSettings, clickStyle: style })
                  }
                >
                  {metronomeCopy.clickStyleLabels[style]}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label>{metronomeCopy.accentLabel}</label>
            <div className="segmented">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  disabled={disabled || isMixPlaying}
                  className={metronomeSettings.accentEvery === accent ? "active" : ""}
                  onClick={() =>
                    onMetronomeSettingsChange({ ...metronomeSettings, accentEvery: accent })
                  }
                >
                  {accent === 0
                    ? metronomeCopy.noAccent
                    : metronomeCopy.everyAccent(accent)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <section className="volume-mixer" aria-labelledby="mix-balance-title">
        <div className="volume-mixer-heading">
          <span className="volume-mixer-icon" aria-hidden="true">
            <SlidersHorizontal size={18} />
          </span>
          <div>
            <h3 id="mix-balance-title">{copy.volumeTitle}</h3>
            <p>{copy.volumeHint}</p>
          </div>
        </div>

        <label className="mixer-channel volume-control">
          <span className="mixer-channel-heading">
            <span className="channel-icon metronome-channel-icon" aria-hidden="true">
              <AudioLines size={17} />
            </span>
            <span className="channel-copy">
              <strong>{copy.metronomeVolumeLabel}</strong>
              <small>{copy.metronomeVolumeHint}</small>
            </span>
            <output className="metronome-relative-output">
              {copy.metronomeRelativeValue(metronomeVolume)}
            </output>
          </span>
          <span className="relative-volume-range">
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={metronomeVolume}
              aria-valuetext={copy.metronomeRelativeValue(metronomeVolume)}
              style={{
                "--range-value": `${metronomeVolume * 50}%`,
              } as CSSProperties}
              onChange={(event) => onClickVolumeChange(Number(event.target.value))}
            />
            <span className="relative-volume-scale" aria-hidden="true">
              <span>{copy.relativeVolumeMin}</span>
              <span>{copy.relativeVolumeReference}</span>
              <span>{copy.relativeVolumeMax}</span>
            </span>
          </span>
        </label>

        <label className="mixer-channel volume-control master-channel">
          <span className="mixer-channel-heading">
            <span className="channel-icon master-channel-icon" aria-hidden="true">
              <Volume2 size={17} />
            </span>
            <span className="channel-copy">
              <strong>{copy.overallVolumeLabel}</strong>
              <small>{copy.overallVolumeHint}</small>
            </span>
            <output>{formatPercent(masterGain)}</output>
          </span>
          <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={masterGain}
              aria-valuetext={copy.overallRelativeValue(masterGain)}
              style={{
                "--range-value": `${masterGain * 50}%`,
              } as CSSProperties}
              onChange={(event) => onMasterGainChange(Number(event.target.value))}
            />
            <span className="relative-volume-scale" aria-hidden="true">
              <span>{copy.relativeVolumeMin}</span>
              <span>{copy.overallVolumeReference}</span>
              <span>{copy.relativeVolumeMax}</span>
            </span>
        </label>
      </section>

      <p className="field-hint">{copy.beatHint}</p>

      <div className="preview-launch">
        <div className="preview-launch-copy">
          <span>{copy.readyLabel}</span>
          <strong>{copy.previewPrompt}</strong>
          <small>{copy.previewBalance(metronomeVolume, masterGain)}</small>
        </div>
        <button
          type="button"
          className="primary-action preview-action"
          disabled={disabled}
          onClick={isMixPlaying ? onStop : onPlayMixPreview}
        >
          {isMixPlaying ? <Pause size={18} /> : <Play size={18} />}
          {isMixPlaying ? copy.stopPreview : copy.preview30}
        </button>
      </div>
    </section>
  );
}
