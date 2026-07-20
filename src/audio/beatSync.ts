const MIN_TARGET_BPM = 40;
const MAX_TARGET_BPM = 720;

export function getFirstBeatOffsetMs(
  firstBeatSourceSec: number,
  tempoRatio: number,
  targetBpm: number,
): number {
  const safeTempoRatio = Number.isFinite(tempoRatio) && tempoRatio > 0 ? tempoRatio : 1;
  const safeTargetBpm = Math.max(
    MIN_TARGET_BPM,
    Math.min(MAX_TARGET_BPM, targetBpm),
  );
  const beatIntervalSec = 60 / safeTargetBpm;
  const adjustedFirstBeatSec = Math.max(0, firstBeatSourceSec / safeTempoRatio);
  let phaseSec = adjustedFirstBeatSec % beatIntervalSec;

  if (phaseSec > beatIntervalSec / 2) {
    phaseSec -= beatIntervalSec;
  }

  return Math.round(phaseSec * 1000);
}
