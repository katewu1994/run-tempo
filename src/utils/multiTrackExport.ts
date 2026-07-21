export function createMultiTrackDefaultName(
  planModeLabel: string,
  totalDurationSec: number,
  planningDirectionLabel: string,
): string {
  return [
    sanitizeDefaultNamePart(planModeLabel) || "Plan",
    formatDurationForFileName(totalDurationSec),
    sanitizeDefaultNamePart(planningDirectionLabel) || "Balanced",
  ].join("_");
}

export function normalizeMultiTrackWavFileName(
  value: string,
  fallback: string,
): string {
  const withoutExtension = value.trim().replace(/\.wav$/i, "");
  const fallbackWithoutExtension = fallback.replace(/\.wav$/i, "");
  const safeName =
    sanitizeFileNameStem(withoutExtension) ||
    sanitizeFileNameStem(fallbackWithoutExtension) ||
    "Plan_0min_Balanced";

  return `${safeName}.wav`;
}

function formatDurationForFileName(totalDurationSec: number): string {
  const roundedSeconds = Number.isFinite(totalDurationSec)
    ? Math.max(0, Math.round(totalDurationSec))
    : 0;
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;

  return seconds === 0 ? `${minutes}min` : `${minutes}m${seconds}s`;
}

function sanitizeDefaultNamePart(value: string): string {
  return sanitizeFileNameStem(value).replace(/\s+/g, "-");
}

function sanitizeFileNameStem(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[._ ]+$/g, "")
    .slice(0, 150);
}
