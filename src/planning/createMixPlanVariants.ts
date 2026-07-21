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
  const recentTrackIds: string[] = [];
  const usageCount = new Map<string, number>();
  const selectedScores: number[] = [];
  const segmentPlans: OpenAISelectionPlan["segmentPlans"] = [];

  for (const segment of args.runningPlan.segments) {
    const candidates = candidatesBySegmentId.get(segment.segmentId) ?? [];
    const selections: OpenAISelectionPlan["segmentPlans"][number]["rankedTrackSelections"] = [];
    const selectedInSegment = new Set<string>();
    const targetCount = Math.min(
      Math.max(1, args.rules.maxTracksPerSegment),
      candidates.length,
    );

    while (selections.length < targetCount) {
      const remaining = candidates.filter(
        (candidate) => !selectedInSegment.has(candidate.trackId),
      );

      if (remaining.length === 0) {
        break;
      }

      const repeatSafe = remaining.filter(
        (candidate) =>
          !recentTrackIds
            .slice(-Math.max(0, args.rules.minRepeatGapTracks))
            .includes(candidate.trackId),
      );
      const pool = repeatSafe.length > 0 ? repeatSafe : remaining;
      const candidate = [...pool].sort(
        (left, right) =>
          getStrategyScore({
            candidate: right,
            strategy: args.strategy,
            segmentName: segment.name,
            track: tracksById.get(right.trackId),
            useCount: usageCount.get(right.trackId) ?? 0,
            preferredRank: preferredRank.get(`${segment.segmentId}:${right.trackId}`),
            previousTrack: tracksById.get(
              recentTrackIds[recentTrackIds.length - 1] ?? "",
            ),
            preferFolderVariety: args.rules.preferFolderVariety,
          }) -
          getStrategyScore({
            candidate: left,
            strategy: args.strategy,
            segmentName: segment.name,
            track: tracksById.get(left.trackId),
            useCount: usageCount.get(left.trackId) ?? 0,
            preferredRank: preferredRank.get(`${segment.segmentId}:${left.trackId}`),
            previousTrack: tracksById.get(
              recentTrackIds[recentTrackIds.length - 1] ?? "",
            ),
            preferFolderVariety: args.rules.preferFolderVariety,
          }),
      )[0];

      selections.push({
        trackId: candidate.trackId,
        selectedBpmInterpretation: candidate.interpretation,
        metronomePreference: {
          clickStyle: "sharp_beep",
          clickVolume:
            segment.name === "tempo" || segment.name === "finish" ? 0.38 : 0.3,
          accentEvery: 4,
        },
        reason: createReason(args.strategy, candidate),
      });
      selectedScores.push(candidate.totalScore);
      selectedInSegment.add(candidate.trackId);
      recentTrackIds.push(candidate.trackId);
      usageCount.set(candidate.trackId, (usageCount.get(candidate.trackId) ?? 0) + 1);
    }

    segmentPlans.push({
      segmentId: segment.segmentId,
      rankedTrackSelections: selections,
    });
  }

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
  const preferredBonus =
    args.strategy === "balanced" && args.preferredRank !== undefined
      ? Math.max(0, 12 - args.preferredRank * 3)
      : 0;
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

  return (
    args.candidate.totalScore +
    preferredBonus +
    noveltyBonus +
    energyBonus +
    folderBonus -
    args.useCount * (args.strategy === "variety" ? 18 : 8)
  );
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
  return `${capitalize(strategy)} sequence · score ${Math.round(candidate.totalScore)} · cadence ${Math.round(candidate.cadenceFitScore)} · energy ${Math.round(candidate.energyFitScore)} · stretch ${candidate.requiredStretchPercent.toFixed(1)}%`;
}

function getParentPath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
