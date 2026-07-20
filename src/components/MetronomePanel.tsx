import { Pause, Play, SlidersHorizontal } from "lucide-react";
import type { AccentEvery, ClickStyle, MetronomeSettings } from "../audio/types";
import type { AppCopy } from "../i18n";

type MetronomePanelProps = {
  settings: MetronomeSettings;
  isPlaying: boolean;
  disabled: boolean;
  copy: AppCopy["metronome"];
  onSettingsChange: (settings: MetronomeSettings) => void;
  onPreview: () => void;
};

const CLICK_STYLES: ClickStyle[] = ["soft", "sharp", "wood"];
const ACCENTS: AccentEvery[] = [0, 2, 4];

export function MetronomePanel({
  settings,
  isPlaying,
  disabled,
  copy,
  onSettingsChange,
  onPreview,
}: MetronomePanelProps) {
  return (
    <section className="panel" aria-labelledby="metronome-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="metronome-title">{copy.title}</h2>
        </div>
        <SlidersHorizontal aria-hidden="true" />
      </div>

      <div className="field-group">
        <label>{copy.clickStyleLabel}</label>
        <div className="segmented">
          {CLICK_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={settings.clickStyle === style ? "active" : ""}
              onClick={() => onSettingsChange({ ...settings, clickStyle: style })}
            >
              {copy.clickStyleLabels[style]}
            </button>
          ))}
        </div>
      </div>

      <p className="field-hint">{copy.accentHint}</p>

      <div className="field-group">
        <label>{copy.accentLabel}</label>
        <div className="segmented">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              className={settings.accentEvery === accent ? "active" : ""}
              onClick={() => onSettingsChange({ ...settings, accentEvery: accent })}
            >
              {accent === 0 ? copy.noAccent : copy.everyAccent(accent)}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="primary-action" disabled={disabled} onClick={onPreview}>
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
        {isPlaying ? copy.stopMetronome : copy.playMetronome}
      </button>
    </section>
  );
}
