import { FileAudio, Upload } from "lucide-react";
import type { LoadedAudio } from "../audio/types";
import type { AppCopy } from "../i18n";
import { formatDuration } from "../utils/format";

type UploadPanelProps = {
  loadedAudio: LoadedAudio | null;
  isLoading: boolean;
  error: string | null;
  copy: AppCopy["upload"];
  locale: string;
  onFileSelect: (file: File) => void;
};

export function UploadPanel({
  loadedAudio,
  isLoading,
  error,
  copy,
  locale,
  onFileSelect,
}: UploadPanelProps) {
  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="upload-title">{copy.title}</h2>
        </div>
        <FileAudio aria-hidden="true" />
      </div>

      <label className="drop-zone">
        <input
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelect(file);
            }
          }}
        />
        <span className="drop-icon">
          <Upload size={28} aria-hidden="true" />
        </span>
        <span>{isLoading ? copy.loading : copy.chooseAudio}</span>
      </label>

      <p className="field-hint">{copy.hint}</p>

      {error ? <p className="error-text">{error}</p> : null}

      {loadedAudio ? (
        <dl className="meta-grid">
          <div>
            <dt>{copy.meta.file}</dt>
            <dd>{loadedAudio.fileName}</dd>
          </div>
          <div>
            <dt>{copy.meta.duration}</dt>
            <dd>{formatDuration(loadedAudio.durationSec)}</dd>
          </div>
          <div>
            <dt>{copy.meta.sampleRate}</dt>
            <dd>{loadedAudio.sampleRate.toLocaleString(locale)} Hz</dd>
          </div>
          <div>
            <dt>{copy.meta.channels}</dt>
            <dd>{loadedAudio.numberOfChannels}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
