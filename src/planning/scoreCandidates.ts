import type {
  CandidateScore,
  RunSegment,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";

export function scoreTrackForSegment(
  track: TrackFeature,
  segment: RunSegment,
): CandidateScore | null {
  const bestCandidate = track.bpmCandidates
    .filter((candidate) => Number.isFinite(candidate.bpm))
    .reduce<TrackFeature["bpmCandidates"][number] | null>((best, candidate) => {
      if (!best) {
        return candidate;
      }

      const currentDiff = Math.abs(candidate.bpm - segment.targetCadence);
      const bestDiff = Math.abs(best.bpm - segment.targetCadence);
      return currentDiff < bestDiff ? candidate : best;
    }, null);

  if (!bestCandidate) {
    return null;
  }

  // Finished tracks already contain a cadence click. Playing them at a
  // different cadence would make the embedded click disagree with the plan,
  // so they are intentionally an exact-match library.
  if (
    track.sourceKind === "standardized" &&
    Math.abs(bestCandidate.bpm - segment.targetCadence) > 0.05
  ) {
    return null;
  }

  const cadenceDiff = Math.abs(bestCandidate.bpm - segment.targetCadence);
  const cadenceFitScore = clampScore(100 - cadenceDiff * 8);
  const energyFitScore = getEnergyFitScore(
    track.normalizedEnergyScore ?? 50,
    segment.targetEnergyRange,
  );
  const stabilityScore = clampScore(
    track.sourceKind === "standardized"
      ? 100
      : (track.tempoStability ?? track.beatConfidence ?? 0.5) * 100,
  );
  const stretchRatio = segment.targetCadence / bestCandidate.bpm;
  const requiredStretchPercent = Math.abs(stretchRatio - 1) * 100;

  const stretchRiskScore =
    requiredStretchPercent <= 3
      ? 100
      : requiredStretchPercent <= segment.maxStretchPercent
        ? 75
        : 20;
  const totalScore =
    cadenceFitScore * 0.45 +
    energyFitScore * 0.25 +
    stabilityScore * 0.2 +
    stretchRiskScore * 0.1;

  return {
    segmentId: segment.segmentId,
    trackId: track.trackId,
    bestCandidateBpm: bestCandidate.bpm,
    interpretation: bestCandidate.interpretation,
    cadenceFitScore,
    energyFitScore,
    stabilityScore,
    stretchRiskScore,
    totalScore,
    requiredStretchPercent,
  };
}

export function getTopCandidatesBySegment(
  tracks: TrackFeature[],
  runningPlan: RunningPlan,
  topN: number,
): Array<{
  segmentId: string;
  topCandidates: CandidateScore[];
}> {
  return runningPlan.segments.map((segment) => ({
    segmentId: segment.segmentId,
    topCandidates: tracks
      .map((track) => scoreTrackForSegment(track, segment))
      .filter((score): score is CandidateScore => score !== null)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, Math.max(0, topN)),
  }));
}

function getEnergyFitScore(
  energy: number,
  range: { min: number; max: number },
): number {
  if (energy >= range.min && energy <= range.max) {
    return 100;
  }

  const distance =
    energy < range.min ? range.min - energy : energy - range.max;
  return clampScore(100 - distance);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}
