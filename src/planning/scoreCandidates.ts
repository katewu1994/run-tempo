import type {
  CandidateScore,
  RunSegment,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";

export const MAX_EMBEDDED_CLICK_STRETCH_PERCENT = 5;
export const FREE_STRETCH_WARNING_PERCENT = 15;

export function scoreTrackForSegment(
  track: TrackFeature,
  segment: RunSegment,
): CandidateScore | null {
  const hasEmbeddedClick = trackHasEmbeddedClick(track);
  const bestCandidate = track.bpmCandidates
    .filter((candidate) =>
      Number.isFinite(candidate.bpm) &&
      (!hasEmbeddedClick || candidate.interpretation === "1:1"),
    )
    .reduce<TrackFeature["bpmCandidates"][number] | null>((best, candidate) => {
      if (!best) {
        return candidate;
      }

      const currentDiff = Math.abs(segment.targetCadence / candidate.bpm - 1);
      const bestDiff = Math.abs(segment.targetCadence / best.bpm - 1);
      return currentDiff < bestDiff ? candidate : best;
    }, null);

  if (!bestCandidate) {
    return null;
  }

  const stretchRatio = segment.targetCadence / bestCandidate.bpm;
  const requiredStretchPercent = Math.abs(stretchRatio - 1) * 100;

  if (
    hasEmbeddedClick &&
    requiredStretchPercent > MAX_EMBEDDED_CLICK_STRETCH_PERCENT
  ) {
    return null;
  }

  const cadenceFitScore = getCadenceFitScore(requiredStretchPercent);
  const energyFitScore = getEnergyFitScore(
    track.normalizedEnergyScore ?? 50,
    segment.targetEnergyRange,
  );
  const structureFitScore = getStructureFitScore(track, segment);
  const moodFitScore = getMoodFitScore(track, segment);
  const stabilityScore = clampScore(
    track.sourceKind === "standardized"
      ? 100
      : (track.tempoStability ?? track.beatConfidence ?? 0.5) * 100,
  );
  const stretchRiskScore = requiredStretchPercent <= 3
    ? 100
    : requiredStretchPercent <= 10
      ? 75
      : requiredStretchPercent <= FREE_STRETCH_WARNING_PERCENT
        ? 50
        : 15;
  const totalScore =
    cadenceFitScore * 0.35 +
    energyFitScore * 0.2 +
    structureFitScore * 0.15 +
    moodFitScore * 0.2 +
    stretchRiskScore * 0.1;

  return {
    segmentId: segment.segmentId,
    trackId: track.trackId,
    bestCandidateBpm: bestCandidate.bpm,
    interpretation: bestCandidate.interpretation,
    cadenceFitScore,
    energyFitScore,
    structureFitScore,
    moodFitScore,
    stabilityScore,
    stretchRiskScore,
    totalScore,
    requiredStretchPercent,
  };
}

function getCadenceFitScore(requiredStretchPercent: number): number {
  if (requiredStretchPercent <= 1) return 100;
  if (requiredStretchPercent <= 5) {
    return 100 - (requiredStretchPercent - 1) * 5;
  }
  if (requiredStretchPercent <= FREE_STRETCH_WARNING_PERCENT) {
    return 80 - (requiredStretchPercent - 5) * 3;
  }

  return clampScore(50 - (requiredStretchPercent - FREE_STRETCH_WARNING_PERCENT) * 2);
}

export function trackHasEmbeddedClick(track: TrackFeature): boolean {
  return track.sourceKind === "standardized" || track.embeddedClickStatus === "confirmed";
}

function getStructureFitScore(track: TrackFeature, segment: RunSegment): number {
  const structure = track.energyStructure;
  if (!structure) return 50;
  const shapeTargets: Partial<Record<RunSegment["name"], typeof structure.shape[]>> = {
    warmup: ["build", "arc"],
    steady: ["flat", "arc"],
    tempo: ["peak", "arc", "build"],
    recovery: ["release", "flat"],
    finish: ["peak", "build"],
    cooldown: ["release", "arc"],
  };
  const desiredShapes = shapeTargets[segment.name] ?? ["flat", "arc"];
  const shapeScore = desiredShapes.includes(structure.shape) ? 100 : 55;
  const regionEnergy = segment.name === "warmup"
    ? 100 - structure.openingEnergy
    : segment.name === "cooldown" || segment.name === "recovery"
      ? 100 - structure.closingEnergy
      : segment.name === "finish"
        ? structure.closingEnergy
        : structure.middleEnergy;
  return clampScore(shapeScore * 0.6 + regionEnergy * 0.4);
}

function getMoodFitScore(track: TrackFeature, segment: RunSegment): number {
  const scores = track.mood?.scores;
  if (!scores) return 50;
  switch (segment.name) {
    case "warmup":
    case "cooldown":
      return scores.calm * 0.65 + scores.focused * 0.35;
    case "recovery":
      return scores.calm * 0.55 + scores.focused * 0.45;
    case "tempo":
    case "finish":
      return scores.intense * 0.55 + scores.uplifting * 0.45;
    default:
      return scores.focused * 0.55 + scores.uplifting * 0.45;
  }
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
