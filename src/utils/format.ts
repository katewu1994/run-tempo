export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) {
    return "--:--";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatBpm(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "--";
  }

  return value.toFixed(1);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return `${value.toFixed(2)}s`;
}
