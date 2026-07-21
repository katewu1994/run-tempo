import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  FileAudio,
  HardDrive,
  Link,
  ShieldCheck,
  Upload,
  Youtube,
} from "lucide-react";
import type { LoadedAudio } from "../audio/types";
import { importYoutubeAudio } from "../audio/youtubeImportClient";
import type { AppCopy } from "../i18n";
import { formatDuration } from "../utils/format";

type UploadPanelProps = {
  loadedAudio: LoadedAudio | null;
  isLoading: boolean;
  error: string | null;
  copy: AppCopy["upload"];
  locale: string;
  onFileSelect: (file: File) => Promise<void>;
};

type ImportSource = "youtube" | "local";

export function UploadPanel({
  loadedAudio,
  isLoading,
  error,
  copy,
  locale,
  onFileSelect,
}: UploadPanelProps) {
  const importAbortRef = useRef<AbortController | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [isImportingYoutube, setIsImportingYoutube] = useState(false);
  const [activeSource, setActiveSource] = useState<ImportSource>("youtube");

  useEffect(
    () => () => {
      importAbortRef.current?.abort();
    },
    [],
  );

  const handleYoutubeImport = async () => {
    if (!youtubeUrl.trim() || isImportingYoutube || isLoading) {
      return;
    }

    importAbortRef.current?.abort();
    const controller = new AbortController();
    importAbortRef.current = controller;
    setYoutubeError(null);
    setIsImportingYoutube(true);

    try {
      const file = await importYoutubeAudio(youtubeUrl.trim(), controller.signal);
      await onFileSelect(file);
    } catch (importError) {
      if (importError instanceof DOMException && importError.name === "AbortError") {
        return;
      }
      setYoutubeError(
        importError instanceof Error ? importError.message : copy.youtube.failed,
      );
    } finally {
      if (importAbortRef.current === controller) {
        importAbortRef.current = null;
        setIsImportingYoutube(false);
      }
    }
  };

  return (
    <section className="panel upload-panel" aria-labelledby="upload-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="upload-title">{copy.title}</h2>
        </div>
        <FileAudio aria-hidden="true" />
      </div>

      <div className="source-tabs" role="tablist" aria-label={copy.sourceAria}>
        <button
          id="youtube-source-tab"
          type="button"
          role="tab"
          aria-selected={activeSource === "youtube"}
          aria-controls="youtube-source-panel"
          className={activeSource === "youtube" ? "active" : ""}
          onClick={() => setActiveSource("youtube")}
        >
          <span className="source-tab-icon youtube" aria-hidden="true">
            <Youtube size={20} />
          </span>
          <span>
            <strong>{copy.tabs.youtube}</strong>
            <small>{copy.tabs.youtubeHint}</small>
          </span>
        </button>
        <button
          id="local-source-tab"
          type="button"
          role="tab"
          aria-selected={activeSource === "local"}
          aria-controls="local-source-panel"
          className={activeSource === "local" ? "active" : ""}
          onClick={() => setActiveSource("local")}
        >
          <span className="source-tab-icon local" aria-hidden="true">
            <HardDrive size={19} />
          </span>
          <span>
            <strong>{copy.tabs.local}</strong>
            <small>{copy.tabs.localHint}</small>
          </span>
        </button>
      </div>

      {activeSource === "youtube" ? (
        <div
          id="youtube-source-panel"
          className="source-workspace youtube-source-workspace"
          role="tabpanel"
          aria-labelledby="youtube-source-tab"
        >
          <div className="source-method-intro">
            <div>
              <span className="source-method-kicker">{copy.youtube.kicker}</span>
              <h3>{copy.youtube.title}</h3>
              <p>{copy.youtube.hint}</p>
            </div>
            <span className="youtube-hero-mark" aria-hidden="true">
              <Youtube size={29} />
            </span>
          </div>
          <form
            className="youtube-import-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleYoutubeImport();
            }}
          >
            <label className="sr-only" htmlFor="youtube-url">
              {copy.youtube.urlLabel}
            </label>
            <div className="youtube-url-field">
              <Link size={18} aria-hidden="true" />
              <input
                id="youtube-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder={copy.youtube.placeholder}
                value={youtubeUrl}
                disabled={isImportingYoutube || isLoading}
                onChange={(event) => {
                  setYoutubeUrl(event.target.value);
                  setYoutubeError(null);
                }}
              />
            </div>
            <button
              type="submit"
              className="youtube-import-button"
              disabled={!youtubeUrl.trim() || isImportingYoutube || isLoading}
            >
              {isImportingYoutube ? copy.youtube.importing : copy.youtube.action}
              {!isImportingYoutube ? <ArrowRight size={17} aria-hidden="true" /> : null}
            </button>
          </form>
          <div className="import-trust-row">
            <span>
              <ShieldCheck size={15} aria-hidden="true" />
              {copy.youtube.permissionNote}
            </span>
            <small>{copy.youtube.supportedLinks}</small>
          </div>
        </div>
      ) : (
        <div
          id="local-source-panel"
          className="source-workspace local-source-workspace"
          role="tabpanel"
          aria-labelledby="local-source-tab"
        >
          <div className="source-method-intro local-source-intro">
            <div>
              <span className="source-method-kicker">{copy.local.kicker}</span>
              <h3>{copy.local.title}</h3>
              <p>{copy.local.hint}</p>
            </div>
          </div>
          <label className="drop-zone compact-drop-zone">
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.aac"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onFileSelect(file);
                }
              }}
            />
            <span className="drop-icon">
              <Upload size={25} aria-hidden="true" />
            </span>
            <span className="drop-copy">
              <strong>{isLoading ? copy.loading : copy.chooseAudio}</strong>
              <small>{copy.local.dropHint}</small>
            </span>
          </label>
          <div className="format-row" aria-label={copy.local.formatsAria}>
            <span>MP3</span>
            <span>WAV</span>
            <span>M4A</span>
            <span>AAC</span>
          </div>
        </div>
      )}

      {error ? <p className="error-text">{error}</p> : null}
      {youtubeError ? <p className="error-text">{youtubeError}</p> : null}

      {loadedAudio ? (
        <div className="loaded-audio-summary">
          <div className="loaded-audio-heading">
            <span className="loaded-audio-icon" aria-hidden="true">
              <FileAudio size={19} />
            </span>
            <div>
              <span>{copy.loadedLabel}</span>
              <strong>{loadedAudio.fileName}</strong>
            </div>
          </div>
          <dl className="meta-grid">
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
        </div>
      ) : null}
    </section>
  );
}
