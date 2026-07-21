import type { BpmCandidate, TrackSourceKind } from "../domain/mixTypes";
import type { RunTempoWavMetadata } from "./exportWav";

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  "aac",
  "m4a",
  "mp3",
  "wav",
]);
const MIN_CADENCE_BPM = 40;
const MAX_CADENCE_BPM = 240;
const STANDARDIZED_FILE_PATTERN =
  /_([0-9]+(?:\.[0-9]+)?)bpm\.(?:aac|m4a|mp3|wav)$/i;

export function getSupportedAudioFiles(files: FileList | File[]): File[] {
  return Array.from(files)
    .filter(isSupportedAudioFile)
    .sort((left, right) =>
      getTrackRelativePath(left).localeCompare(
        getTrackRelativePath(right),
        undefined,
        { numeric: true, sensitivity: "base" },
      ),
    );
}

export function isSupportedAudioFile(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_AUDIO_EXTENSIONS.has(extension);
}

export function parseStandardizedTrackCadence(
  fileName: string,
): number | null {
  const match = fileName.match(STANDARDIZED_FILE_PATTERN);

  if (!match) {
    return null;
  }

  const cadence = Number(match[1]);

  if (
    !Number.isFinite(cadence) ||
    cadence < MIN_CADENCE_BPM ||
    cadence > MAX_CADENCE_BPM
  ) {
    return null;
  }

  return Math.round(cadence * 10) / 10;
}

export async function readRunTempoWavMetadata(
  file: File,
): Promise<RunTempoWavMetadata | null> {
  if (!file.name.toLowerCase().endsWith(".wav")) {
    return null;
  }

  const bytes = await file.arrayBuffer();

  if (bytes.byteLength < 12) {
    return null;
  }

  const view = new DataView(bytes);
  const decoder = new TextDecoder();
  const readId = (offset: number) =>
    decoder.decode(new Uint8Array(bytes, offset, 4));

  if (readId(0) !== "RIFF" || readId(8) !== "WAVE") {
    return null;
  }

  let offset = 12;

  while (offset + 8 <= bytes.byteLength) {
    const id = readId(offset);
    const size = view.getUint32(offset + 4, true);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + size;

    if (payloadEnd > bytes.byteLength) {
      return null;
    }

    if (id === "rtmp") {
      try {
        const parsed = JSON.parse(
          decoder.decode(new Uint8Array(bytes, payloadStart, size)),
        ) as Partial<RunTempoWavMetadata>;

        if (
          parsed.version === 1 &&
          parsed.clickEmbedded === true &&
          Number.isFinite(parsed.cadenceBpm) &&
          (parsed.cadenceBpm ?? 0) >= MIN_CADENCE_BPM &&
          (parsed.cadenceBpm ?? 0) <= MAX_CADENCE_BPM
        ) {
          return parsed as RunTempoWavMetadata;
        }
      } catch {
        return null;
      }
    }

    offset = payloadEnd + (size % 2);
  }

  return null;
}

export function createStandardizedBpmCandidates(
  cadenceBpm: number,
): BpmCandidate[] {
  return [{ bpm: cadenceBpm, interpretation: "1:1" }];
}

export function getTrackRelativePath(file: File): string {
  return file.webkitRelativePath || file.name;
}

export function createTrackImportKey(
  file: File,
  sourceKind: TrackSourceKind,
): string {
  return [
    sourceKind,
    normalizeFileName(file.name),
    file.size,
    file.lastModified,
  ].join(":");
}

function normalizeFileName(fileName: string): string {
  return fileName.normalize("NFKC").toLowerCase();
}
