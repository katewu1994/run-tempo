import {
  Crosshair,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  TimerReset,
  Volume2,
} from "lucide-react";
import type { AppCopy } from "../i18n";
import { formatPercent } from "../utils/format";

type PlaybackMode = "idle" | "original" | "metronome" | "mix";
type SyncMode = "none" | "auto" | "manual";

type PreviewPanelProps = {
  playbackMode: PlaybackMode;
  disabled: boolean;
  songGain: number;
  clickVolume: number;
  firstBeatSourceSec: number | null;
  offsetMs: number;
  syncMode: SyncMode;
  canMarkFirstBeat: boolean;
  copy: AppCopy["preview"];
  onSongGainChange: (value: number) => void;
  onClickVolumeChange: (value: number) => void;
  onPlayOriginal: () => void;
  onPlayMixPreview: () => void;
  onStop: () => void;
  onAutoBeatSync: () => void;
  onMarkFirstBeat: () => void;
  onClearFirstBeat: () => void;
  onOffsetMsChange: (offsetMs: number) => void;
};

export function PreviewPanel({
  playbackMode,
  disabled,
  songGain,
  clickVolume,
  firstBeatSourceSec,
  offsetMs,
  syncMode,
  canMarkFirstBeat,
  copy,
  onSongGainChange,
  onClickVolumeChange,
  onPlayOriginal,
  onPlayMixPreview,
  onStop,
  onAutoBeatSync,
  onMarkFirstBeat,
  onClearFirstBeat,
  onOffsetMsChange,
}: PreviewPanelProps) {
  const isOriginalPlaying = playbackMode === "original";
  const isMixPlaying = playbackMode === "mix";
  const setOffsetMs = (nextOffsetMs: number) => {
    onOffsetMsChange(Math.max(-1500, Math.min(1500, Math.round(nextOffsetMs))));
  };

  return (
    <section className="panel" aria-labelledby="preview-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="preview-title">{copy.title}</h2>
        </div>
        <TimerReset aria-hidden="true" />
      </div>

      <label className="range-field">
        <span>
          <Volume2 size={16} aria-hidden="true" />
          {copy.songVolumeLabel}
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={songGain}
          onChange={(event) => onSongGainChange(Number(event.target.value))}
        />
        <output>{formatPercent(songGain)}</output>
      </label>

      <label className="range-field">
        <span>
          <Volume2 size={16} aria-hidden="true" />
          {copy.clickVolumeLabel}
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={clickVolume}
          onChange={(event) => onClickVolumeChange(Number(event.target.value))}
        />
        <output>{formatPercent(clickVolume)}</output>
      </label>

      <div className="action-grid">
        <button
          type="button"
          className="secondary-action"
          disabled={disabled}
          onClick={isOriginalPlaying ? onStop : onPlayOriginal}
        >
          {isOriginalPlaying ? <Pause size={18} /> : <Play size={18} />}
          {isOriginalPlaying ? copy.stopSong : copy.playSong}
        </button>

        <button
          type="button"
          className="primary-action"
          disabled={disabled}
          onClick={isMixPlaying ? onStop : onPlayMixPreview}
        >
          {isMixPlaying ? <Pause size={18} /> : <Play size={18} />}
          {isMixPlaying ? copy.stopPreview : copy.preview30}
        </button>
      </div>

      <p className="field-hint">{copy.beatHint}</p>

      <div className="sync-box">
        <div className="sync-readout">
          <span>{copy.syncLabel}</span>
          <strong>{getSyncLabel(copy, syncMode)}</strong>
        </div>
        <div className="sync-actions">
          <button
            type="button"
            className="primary-action"
            disabled={disabled}
            onClick={onAutoBeatSync}
          >
            <TimerReset size={18} />
            {copy.autoSync}
          </button>
        </div>

        <details className="advanced-sync">
          <summary>{copy.advancedSyncLabel}</summary>
          <div className="advanced-sync-content">
            <p className="field-hint">{copy.advancedSyncHint}</p>
            <div className="sync-actions">
              <button
                type="button"
                className="secondary-action"
                disabled={disabled || !canMarkFirstBeat}
                onClick={onMarkFirstBeat}
              >
                <Crosshair size={18} />
                {copy.markBeat}
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={firstBeatSourceSec === null}
                onClick={onClearFirstBeat}
              >
                <RotateCcw size={18} />
                {copy.clearSync}
              </button>
            </div>

            <div className="offset-controls">
              <label className="field">
                <span>{copy.offsetLabel}</span>
                <input
                  type="number"
                  min="-1500"
                  max="1500"
                  step="5"
                  value={offsetMs}
                  disabled={disabled}
                  onChange={(event) => setOffsetMs(Number(event.target.value))}
                />
              </label>
              <p className="field-hint">{copy.offsetHint}</p>
              <div className="nudge-row">
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled}
                  onClick={() => setOffsetMs(offsetMs - 25)}
                >
                  <Minus size={16} />
                  25 ms
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled}
                  onClick={() => setOffsetMs(0)}
                >
                  <RotateCcw size={16} />
                  {copy.zero}
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  disabled={disabled}
                  onClick={() => setOffsetMs(offsetMs + 25)}
                >
                  <Plus size={16} />
                  25 ms
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}

function getSyncLabel(
  copy: AppCopy["preview"],
  syncMode: SyncMode,
): string {
  if (syncMode === "auto") {
    return copy.syncStatusAuto;
  }

  if (syncMode === "manual") {
    return copy.syncStatusManual;
  }

  return copy.syncStatusNone;
}
