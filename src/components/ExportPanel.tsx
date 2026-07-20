import {
  CheckCircle2,
  Download,
  ImagePlus,
  Music2,
  Palette,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  lookupCoverArt,
  type CoverArtCandidate,
} from "../audio/coverArtClient";
import { createWavFileName, type WavMetadata } from "../audio/exportWav";
import {
  createGeneratedCoverTheme,
  generateCoverArtwork,
  type GeneratedCoverInput,
} from "../audio/generateCoverArt";
import type { AppCopy } from "../i18n";

type ExportPanelProps = {
  disabled: boolean;
  defaultTitle: string;
  targetBpm: number;
  copy: AppCopy["exportPanel"];
  onExport: (metadata: WavMetadata) => Promise<void>;
};

const COVER_COLOR_OPTIONS = [
  { hue: 267, key: "purple" },
  { hue: 218, key: "blue" },
  { hue: 176, key: "teal" },
  { hue: 118, key: "green" },
  { hue: 30, key: "orange" },
  { hue: 52, key: "yellow" },
  { hue: 2, key: "red" },
  { hue: 346, key: "pink" },
  { hue: 294, key: "violet" },
  { hue: 194, key: "sky" },
  { hue: 148, key: "mint" },
  { hue: 338, key: "rose" },
] as const;

export function ExportPanel({
  disabled,
  defaultTitle,
  targetBpm,
  copy,
  onExport,
}: ExportPanelProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [candidates, setCandidates] = useState<CoverArtCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] =
    useState<CoverArtCandidate | null>(null);
  const [customArtwork, setCustomArtwork] = useState<File | null>(null);
  const [coverHue, setCoverHue] = useState(267);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<
    "idle" | "searching" | "found" | "empty" | "error"
  >("idle");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const customArtworkUrl = useMemo(
    () => (customArtwork ? URL.createObjectURL(customArtwork) : null),
    [customArtwork],
  );

  useEffect(() => {
    setTitle(defaultTitle);
    setArtist("");
    setAlbum("");
    setCandidates([]);
    setSelectedCandidate(null);
    setCustomArtwork(null);
    setCoverHue(267);
    setIsColorPickerOpen(false);
    setLookupStatus("idle");
    setExportError(null);
  }, [defaultTitle]);

  useEffect(
    () => () => {
      if (customArtworkUrl) {
        URL.revokeObjectURL(customArtworkUrl);
      }
    },
    [customArtworkUrl],
  );

  useEffect(() => {
    const normalizedArtist = artist.trim();
    const normalizedAlbum = album.trim();

    if (!normalizedArtist || !normalizedAlbum || customArtwork) {
      setLookupStatus("idle");
      setCandidates([]);
      setSelectedCandidate(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLookupStatus("searching");
      setCandidates([]);
      setSelectedCandidate(null);

      try {
        const matches = await lookupCoverArt(
          normalizedArtist,
          normalizedAlbum,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        setCandidates(matches);
        setSelectedCandidate(matches[0] ?? null);
        setLookupStatus(matches.length > 0 ? "found" : "empty");
      } catch (error) {
        if (!controller.signal.aborted) {
          setLookupStatus("error");
        }
      }
    }, 700);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [album, artist, customArtwork]);

  const artworkPreviewUrl = customArtworkUrl ?? selectedCandidate?.imageUrl ?? null;
  const lookupMessage = getLookupMessage(lookupStatus, copy);
  const resolvedTitle = title.trim() || defaultTitle;
  const outputFileName = resolvedTitle
    ? createWavFileName(resolvedTitle, targetBpm)
    : null;
  const generatedCoverInput = useMemo<GeneratedCoverInput>(
    () => ({
      title: resolvedTitle || copy.untitled,
      artist: artist.trim(),
      bpm: targetBpm,
      hue: coverHue,
    }),
    [artist, copy.untitled, coverHue, resolvedTitle, targetBpm],
  );
  const generatedCoverTheme = useMemo(
    () => createGeneratedCoverTheme(generatedCoverInput),
    [generatedCoverInput],
  );

  const handleExport = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      const artwork = await loadArtwork(
        customArtwork,
        selectedCandidate,
        generatedCoverInput,
      );
      await onExport({
        title: resolvedTitle,
        artist: artist.trim() || undefined,
        album: album.trim() || undefined,
        artwork,
      });
    } catch {
      setExportError(copy.exportFailed);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <section className="panel export-panel" aria-labelledby="export-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.stepLabel}</span>
          <h2 id="export-title">{copy.title}</h2>
        </div>
        <Download aria-hidden="true" />
      </div>

      <div className="export-editor">
        <section className="export-artwork-section" aria-labelledby="artwork-title">
          <div className="export-section-heading">
            <span>{copy.artworkEyebrow}</span>
            <h3 id="artwork-title">{copy.artworkTitle}</h3>
            <p>{copy.artworkHint}</p>
          </div>

          <div className="cover-art-preview" aria-live="polite">
            {artworkPreviewUrl ? (
              <img src={artworkPreviewUrl} alt={copy.coverPreviewAlt} />
            ) : (
              <div
                className="generated-cover-preview"
                style={
                  {
                    background: generatedCoverTheme.background,
                    "--generated-cover-accent": generatedCoverTheme.accent,
                  } as CSSProperties
                }
                aria-label={copy.generatedCoverAlt}
              >
                <span className="generated-cover-kicker">RUN TEMPO</span>
                <strong>{generatedCoverInput.title}</strong>
                <div className="generated-cover-meta">
                  <span>{generatedCoverInput.artist}</span>
                  <b>{formatBpm(targetBpm)} BPM</b>
                </div>
              </div>
            )}
          </div>

          <div className="cover-art-actions">
            <label className="secondary-action cover-upload-action">
              <ImagePlus size={16} aria-hidden="true" />
              {copy.uploadCover}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setCustomArtwork(file);
                  setExportError(null);
                }}
              />
            </label>
            {!artworkPreviewUrl ? (
              <div className="cover-color-control">
                <button
                  type="button"
                  className="secondary-action cover-color-trigger"
                  aria-expanded={isColorPickerOpen}
                  aria-controls="cover-color-palette"
                  aria-label={copy.coverColor}
                  title={copy.coverColor}
                  style={{ "--swatch-hue": coverHue } as CSSProperties}
                  onClick={() => setIsColorPickerOpen((isOpen) => !isOpen)}
                >
                  <Palette size={16} aria-hidden="true" />
                </button>
                {isColorPickerOpen ? (
                  <div
                    id="cover-color-palette"
                    className="cover-color-palette"
                    role="group"
                    aria-label={copy.colorPickerLabel}
                  >
                    <span>{copy.colorPickerLabel}</span>
                    <div>
                      {COVER_COLOR_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={coverHue === option.hue ? "selected" : ""}
                          style={{ "--swatch-hue": option.hue } as CSSProperties}
                          aria-label={copy.coverColors[option.key]}
                          aria-pressed={coverHue === option.hue}
                          title={copy.coverColors[option.key]}
                          onClick={() => {
                            setCoverHue(option.hue);
                            setIsColorPickerOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {artworkPreviewUrl ? (
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setCustomArtwork(null);
                  setSelectedCandidate(null);
                  setCandidates([]);
                  setLookupStatus("idle");
                }}
              >
                <X size={16} aria-hidden="true" />
                {copy.removeCover}
              </button>
            ) : null}
          </div>
        </section>

        <section className="export-details-section" aria-labelledby="details-title">
          <div className="export-section-heading">
            <span>{copy.detailsEyebrow}</span>
            <h3 id="details-title">{copy.detailsTitle}</h3>
            <p>{copy.detailsHint}</p>
          </div>

          <div className="export-metadata-fields">
            <label className="export-field">
              <span>{copy.songTitle}</span>
              <input
                type="text"
                value={title}
                maxLength={200}
                placeholder={copy.songTitlePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="export-field">
              <span>{copy.artist}</span>
              <input
                type="text"
                value={artist}
                maxLength={200}
                placeholder={copy.artistPlaceholder}
                onChange={(event) => setArtist(event.target.value)}
              />
            </label>
            <label className="export-field">
              <span>{copy.album}</span>
              <input
                type="text"
                value={album}
                maxLength={200}
                placeholder={copy.albumPlaceholder}
                onChange={(event) => setAlbum(event.target.value)}
              />
            </label>
          </div>

          <div className="cover-match-note">
            {lookupStatus === "searching" ? (
              <RefreshCw size={15} aria-hidden="true" />
            ) : (
              <Music2 size={15} aria-hidden="true" />
            )}
            <div>
              <strong>{copy.autoCoverTitle}</strong>
              <span className={`cover-lookup-status ${lookupStatus}`}>
                {lookupMessage ?? copy.autoCoverHint}
              </span>
            </div>
          </div>
        </section>
      </div>

      {candidates.length > 1 && !customArtwork ? (
        <div className="cover-candidates" aria-label={copy.candidateLabel}>
          {candidates.map((candidate) => (
            <button
              key={candidate.releaseGroupId}
              type="button"
              className={
                candidate.releaseGroupId === selectedCandidate?.releaseGroupId
                  ? "cover-candidate selected"
                  : "cover-candidate"
              }
              aria-pressed={
                candidate.releaseGroupId === selectedCandidate?.releaseGroupId
              }
              onClick={() => setSelectedCandidate(candidate)}
            >
              <img src={candidate.imageUrl} alt="" />
              <span>
                {candidate.title}
                {candidate.firstReleaseDate
                  ? ` · ${candidate.firstReleaseDate.slice(0, 4)}`
                  : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="export-ready-card">
        <div className="export-ready-icon">
          <CheckCircle2 size={22} aria-hidden="true" />
        </div>
        <div className="export-target">
          <span>{copy.output}</span>
          <strong>{outputFileName ?? copy.loadAudioFirst}</strong>
          <small>{copy.outputHint}</small>
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={disabled || isExporting}
          onClick={() => void handleExport()}
        >
          <Download size={18} />
          {isExporting ? copy.exporting : copy.action}
        </button>
      </div>
      {exportError ? <p className="error-text">{exportError}</p> : null}
    </section>
  );
}

function getLookupMessage(
  status: "idle" | "searching" | "found" | "empty" | "error",
  copy: AppCopy["exportPanel"],
): string | null {
  if (status === "searching") return copy.coverSearching;
  if (status === "found") return copy.coverFound;
  if (status === "empty") return copy.coverNotFound;
  if (status === "error") return copy.coverLookupFailed;
  return null;
}

async function loadArtwork(
  customArtwork: File | null,
  candidate: CoverArtCandidate | null,
  generatedCoverInput: GeneratedCoverInput,
): Promise<WavMetadata["artwork"]> {
  if (customArtwork) {
    return {
      data: new Uint8Array(await customArtwork.arrayBuffer()),
      mimeType: customArtwork.type || "image/jpeg",
    };
  }

  if (!candidate) {
    return generateCoverArtwork(generatedCoverInput);
  }

  try {
    const response = await fetch(candidate.imageUrl);

    if (!response.ok) {
      throw new Error("Unable to download selected cover art.");
    }

    const blob = await response.blob();
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || "image/jpeg",
    };
  } catch {
    return generateCoverArtwork(generatedCoverInput);
  }
}

function formatBpm(value: number): string {
  return String(Math.round(value * 10) / 10);
}
