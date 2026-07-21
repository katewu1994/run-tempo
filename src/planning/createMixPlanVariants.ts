import type {
  CandidateScore,
  GlobalSequenceRules,
  MixPlanStrategy,
  MixPlanVariant,
  OpenAISelectionPlan,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";

const STRATEGIES: MixPlanStrategy[] = ["balanced", "energy", "variety"];
const ESTIMATED_CROSSFADE_SEC = 6;
const BEAM_WIDTH = 24;

export function createMixPlanVariants(args: {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  rules: GlobalSequenceRules;
  preferredSelectionPlan?: OpenAISelectionPlan | null;
}): MixPlanVariant[] {
  return STRATEGIES.map((strategy) =>
    createVariant({ ...args, strategy }),
  );
}

function createVariant(args: {
  strategy: MixPlanStrategy;
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  rules: GlobalSequenceRules;
  preferredSelectionPlan?: OpenAISelectionPlan | null;
}): MixPlanVariant {
  const tracksById = new Map(args.tracks.map((track) => [track.trackId, track]));
  const candidatesBySegmentId = new Map(
    args.candidateGroups.map((group) => [group.segmentId, group.topCandidates]),
  );
  const preferredRank = createPreferredRank(args.preferredSelectionPlan);
  const slots = args.runningPlan.segments.flatMap((segment) => {
    const candidates = candidatesBySegmentId.get(segment.segmentId) ?? [];
    const targetCount = getDurationAwareTrackCount({
      segment,
      candidates,
      tracksById,
      maxTracksPerSegment: args.rules.maxTracksPerSegment,
    });
    return Array.from({ length: targetCount }, () => ({ segment, candidates }));
  });
  const bestState = buildBestSequence({
    slots,
    strategy: args.strategy,
    tracksById,
    preferredRank,
    rules: args.rules,
  });
  const segmentPlans = args.runningPlan.segments.map((segment) => ({
    segmentId: segment.segmentId,
    rankedTrackSelections: bestState.selections
      .filter((item) => item.segmentId === segment.segmentId)
      .map(({ candidate }) => ({
        trackId: candidate.trackId,
        selectedBpmInterpretation: candidate.interpretation,
        metronomePreference: {
          clickStyle: "sharp_beep" as const,
          clickVolume:
            segment.name === "tempo" || segment.name === "finish" ? 0.38 : 0.3,
          accentEvery: 4 as const,
        },
        reason: createReason(args.strategy, candidate),
      })),
  }));
  const selectedScores = bestState.selections.map((item) => item.candidate.totalScore);
  const usageCount = bestState.usageCount;

  const selectionCount = segmentPlans.reduce(
    (total, plan) => total + plan.rankedTrackSelections.length,
    0,
  );
  const uniqueTrackCount = usageCount.size;

  return {
    variantId: args.strategy,
    selectionPlan: {
      mixTitle: `${args.runningPlan.title} · ${capitalize(args.strategy)}`,
      segmentPlans,
    },
    summary: {
      uniqueTrackCount,
      selectionCount,
      repeatCount: Math.max(0, selectionCount - uniqueTrackCount),
      averageCandidateScore:
        selectedScores.length > 0
          ? selectedScores.reduce((total, score) => total + score, 0) /
            selectedScores.length
          : 0,
    },
  };
}

type SequenceSlot = {
  segment: RunningPlan["segments"][number];
  candidates: CandidateScore[];
};

type SequenceState = {
  selections: Array<{ segmentId: string; candidate: CandidateScore }>;
  usageCount: Map<string, number>;
  score: number;
};

function buildBestSequence(args: {
  slots: SequenceSlot[];
  strategy: MixPlanStrategy;
  tracksById: Map<string, TrackFeature>;
  preferredRank: Map<string, number>;
  rules: GlobalSequenceRules;
}): SequenceState {
  let states: SequenceState[] = [{ selections: [], usageCount: new Map(), score: 0 }];

  for (const slot of args.slots) {
    const expanded: SequenceState[] = [];

    for (const state of states) {
      const selectedInSegment = new Set(
        state.selections
          .filter((item) => item.segmentId === slot.segment.segmentId)
          .map((item) => item.candidate.trackId),
      );
      const remaining = slot.candidates.filter(
        (candidate) => !selectedInSegment.has(candidate.trackId),
      );
      const recentTrackIds = state.selections.map((item) => item.candidate.trackId);
      const repeatSafe = remaining.filter(
        (candidate) =>
          !recentTrackIds
            .slice(-Math.max(0, args.rules.minRepeatGapTracks))
            .includes(candidate.trackId),
      );
      const pool = repeatSafe.length > 0 ? repeatSafe : remaining;
      const previousTrackId = recentTrackIds[recentTrackIds.length - 1];

      for (const candidate of pool) {
        const nextUsageCount = new Map(state.usageCount);
        nextUsageCount.set(
          candidate.trackId,
          (nextUsageCount.get(candidate.trackId) ?? 0) + 1,
        );
        expanded.push({
          selections: [
            ...state.selections,
            { segmentId: slot.segment.segmentId, candidate },
          ],
          usageCount: nextUsageCount,
          score:
            state.score +
            getStrategyScore({
              candidate,
              strategy: args.strategy,
              segmentName: slot.segment.name,
              track: args.tracksById.get(candidate.trackId),
              useCount: state.usageCount.get(candidate.trackId) ?? 0,
              preferredRank: args.preferredRank.get(
                `${slot.segment.segmentId}:${candidate.trackId}`,
              ),
              previousTrack: args.tracksById.get(previousTrackId ?? ""),
              preferFolderVariety: args.rules.preferFolderVariety,
            }),
        });
      }
    }

    if (expanded.length === 0) break;
    states = expanded.sort((left, right) => right.score - left.score).slice(0, BEAM_WIDTH);
  }

  return states[0] ?? { selections: [], usageCount: new Map(), score: 0 };
}

function getDurationAwareTrackCount(args: {
  segment: RunningPlan["segments"][number];
  candidates: CandidateScore[];
  tracksById: Map<string, TrackFeature>;
  maxTracksPerSegment: number;
}): number {
  if (args.candidates.length === 0) return 0;
  const adjustedDurations = args.candidates
    .map((candidate) => {
      const durationSec = args.tracksById.get(candidate.trackId)?.durationSec;
      if (!durationSec) return null;
      const stretchRatio = args.segment.targetCadence / candidate.bestCandidateBpm;
      return durationSec / Math.max(0.25, stretchRatio);
    })
    .filter((duration): duration is number => duration !== null && duration > 0)
    .sort((left, right) => left - right);
  const typicalDuration = adjustedDurations.length > 0
    ? adjustedDurations[Math.floor(adjustedDurations.length / 2)]
    : 180;
  const segmentDuration = args.segment.endSec - args.segment.startSec;
  const effectiveTrackDuration = Math.max(
    1,
    typicalDuration - ESTIMATED_CROSSFADE_SEC,
  );
  const requiredCount = Math.max(
    1,
    Math.ceil(
      (segmentDuration - ESTIMATED_CROSSFADE_SEC) / effectiveTrackDuration,
    ),
  );

  return Math.min(
    requiredCount,
    Math.max(1, args.maxTracksPerSegment),
    args.candidates.length,
  );
}

function getStrategyScore(args: {
  candidate: CandidateScore;
  strategy: MixPlanStrategy;
  segmentName: RunningPlan["segments"][number]["name"];
  track: TrackFeature | undefined;
  previousTrack: TrackFeature | undefined;
  useCount: number;
  preferredRank: number | undefined;
  preferFolderVariety: boolean;
}): number {
  const preferredBonus = args.preferredRank === undefined
    ? 0
    : Math.max(
        0,
        (args.strategy === "balanced" ? 14 : 7) - args.preferredRank * 2,
      );
  const noveltyBonus = args.strategy === "variety" ? 24 / (args.useCount + 1) : 0;
  const energy = args.track?.normalizedEnergyScore ?? 50;
  const isHighEnergySegment =
    args.segmentName === "tempo" || args.segmentName === "finish";
  const energyDirectionScore = isHighEnergySegment ? energy : 100 - energy;
  const energyBonus =
    args.strategy === "energy"
      ? args.candidate.energyFitScore * 0.25 + energyDirectionScore * 0.15
      : 0;
  const folderBonus =
    args.preferFolderVariety &&
    args.previousTrack?.relativePath &&
    args.track?.relativePath &&
    getParentPath(args.previousTrack.relativePath) !== getParentPath(args.track.relativePath)
      ? 5
      : 0;
  const transitionBonus = getTransitionBonus(
    args.previousTrack,
    args.track,
    args.strategy,
  );

  return (
    args.candidate.totalScore +
    preferredBonus +
    noveltyBonus +
    energyBonus +
    folderBonus +
    transitionBonus -
    args.useCount * (args.strategy === "variety" ? 18 : 8)
  );
}

function getTransitionBonus(
  previous: TrackFeature | undefined,
  next: TrackFeature | undefined,
  strategy: MixPlanStrategy,
): number {
  if (!previous || !next) return 0;
  const keyScore = getKeyCompatibilityScore(
    previous.musicalKey ?? null,
    next.musicalKey ?? null,
  );
  const structureScore = previous.energyStructure && next.energyStructure
    ? 100 - Math.abs(
        previous.energyStructure.closingEnergy - next.energyStructure.openingEnergy,
      )
    : 50;
  const moodScore = getMoodContinuityScore(previous, next);
  const energyScore = previous.normalizedEnergyScore !== null &&
      next.normalizedEnergyScore !== null
    ? 100 - Math.abs(previous.normalizedEnergyScore - next.normalizedEnergyScore)
    : 50;
  const weight = strategy === "balanced" ? 0.1 : 0.07;

  return (
    (keyScore - 50) * weight +
    (structureScore - 50) * 0.06 +
    (moodScore - 50) * 0.05 +
    (energyScore - 50) * 0.04
  );
}

function getMoodContinuityScore(
  previous: TrackFeature,
  next: TrackFeature,
): number {
  const left = previous.mood?.scores;
  const right = next.mood?.scores;
  if (!left || !right) return 50;
  const labels = ["calm", "focused", "uplifting", "intense"] as const;
  const meanDifference = labels.reduce(
    (total, label) => total + Math.abs(left[label] - right[label]),
    0,
  ) / labels.length;
  return Math.max(0, 100 - meanDifference);
}

function createPreferredRank(
  selectionPlan: OpenAISelectionPlan | null | undefined,
): Map<string, number> {
  const result = new Map<string, number>();

  for (const segmentPlan of selectionPlan?.segmentPlans ?? []) {
    segmentPlan.rankedTrackSelections.forEach((selection, index) => {
      result.set(`${segmentPlan.segmentId}:${selection.trackId}`, index);
    });
  }

  return result;
}

function createReason(strategy: MixPlanStrategy, candidate: CandidateScore): string {
  return `${capitalize(strategy)} sequence · score ${Math.round(candidate.totalScore)} · cadence ${Math.round(candidate.cadenceFitScore)} · energy ${Math.round(candidate.energyFitScore)} · structure ${Math.round(candidate.structureFitScore)} · mood ${Math.round(candidate.moodFitScore)} · stretch ${candidate.requiredStretchPercent.toFixed(1)}%`;
}

export function getKeyCompatibilityScore(
  previous: TrackFeature["musicalKey"] | null,
  next: TrackFeature["musicalKey"] | null,
): number {
  if (!previous || !next) return 50;
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const left = names.indexOf(previous.tonic);
  const right = names.indexOf(next.tonic);
  if (left < 0 || right < 0) return 50;
  if (left === right && previous.mode === next.mode) return 100;
  if (previous.mode !== next.mode) {
    const major = previous.mode === "major" ? left : right;
    const minor = previous.mode === "minor" ? left : right;
    if ((major + 9) % 12 === minor) return 95;
  }
  const distance = Math.min((right - left + 12) % 12, (left - right + 12) % 12);
  if (distance === 5) return previous.mode === next.mode ? 88 : 78;
  if (distance <= 2) return 72;
  return 45;
}

function getParentPath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
