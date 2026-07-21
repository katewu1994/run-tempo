import type {
  CandidateScore,
  MixPlanVariant,
  OpenAISelectionPlan,
} from "../domain/mixTypes";

type CandidateGroup = {
  segmentId: string;
  topCandidates: CandidateScore[];
};

export function getLockedSelectionKey(segmentId: string, trackId: string): string {
  return `${segmentId}:${trackId}`;
}

export function mergeLockedSelections(args: {
  targetPlan: OpenAISelectionPlan;
  currentPlan: OpenAISelectionPlan;
  lockedSelectionKeys: Set<string>;
}): OpenAISelectionPlan {
  const currentBySegmentId = new Map(
    args.currentPlan.segmentPlans.map((segmentPlan) => [
      segmentPlan.segmentId,
      segmentPlan.rankedTrackSelections,
    ]),
  );

  return {
    ...args.targetPlan,
    segmentPlans: args.targetPlan.segmentPlans.map((targetSegmentPlan) => {
      const currentSelections = currentBySegmentId.get(targetSegmentPlan.segmentId) ?? [];
      const selections = [...targetSegmentPlan.rankedTrackSelections];

      currentSelections.forEach((selection, currentIndex) => {
        if (
          !args.lockedSelectionKeys.has(
            getLockedSelectionKey(targetSegmentPlan.segmentId, selection.trackId),
          )
        ) {
          return;
        }

        const existingIndex = selections.findIndex(
          (item) => item.trackId === selection.trackId,
        );

        if (existingIndex >= 0) {
          selections.splice(existingIndex, 1);
        }

        selections.splice(Math.min(currentIndex, selections.length), 0, selection);
      });

      return {
        ...targetSegmentPlan,
        rankedTrackSelections: selections.slice(
          0,
          targetSegmentPlan.rankedTrackSelections.length,
        ),
      };
    }),
  };
}

export function summarizeSelectionPlan(
  plan: OpenAISelectionPlan,
  candidateGroups: CandidateGroup[],
): MixPlanVariant["summary"] {
  const candidateScoreByKey = new Map<string, number>();

  for (const group of candidateGroups) {
    for (const candidate of group.topCandidates) {
      candidateScoreByKey.set(
        `${group.segmentId}:${candidate.trackId}`,
        candidate.totalScore,
      );
    }
  }

  const trackIds: string[] = [];
  const scores: number[] = [];

  for (const segmentPlan of plan.segmentPlans) {
    for (const selection of segmentPlan.rankedTrackSelections) {
      trackIds.push(selection.trackId);
      const score = candidateScoreByKey.get(
        `${segmentPlan.segmentId}:${selection.trackId}`,
      );

      if (score !== undefined) {
        scores.push(score);
      }
    }
  }

  const uniqueTrackCount = new Set(trackIds).size;

  return {
    uniqueTrackCount,
    selectionCount: trackIds.length,
    repeatCount: Math.max(0, trackIds.length - uniqueTrackCount),
    averageCandidateScore:
      scores.length > 0
        ? scores.reduce((total, score) => total + score, 0) / scores.length
        : 0,
  };
}

export function replaceSelection(
  plan: OpenAISelectionPlan,
  segmentId: string,
  index: number,
  candidate: CandidateScore,
): OpenAISelectionPlan {
  return {
    ...plan,
    segmentPlans: plan.segmentPlans.map((segmentPlan) =>
      segmentPlan.segmentId !== segmentId
        ? segmentPlan
        : {
            ...segmentPlan,
            rankedTrackSelections: segmentPlan.rankedTrackSelections.map(
              (selection, selectionIndex) =>
                selectionIndex === index
                  ? {
                      ...selection,
                      trackId: candidate.trackId,
                      selectedBpmInterpretation: candidate.interpretation,
                      reason: `Manual replacement · score ${Math.round(candidate.totalScore)} · cadence ${Math.round(candidate.cadenceFitScore)} · energy ${Math.round(candidate.energyFitScore)}`,
                    }
                  : selection,
            ),
          },
    ),
  };
}

export function moveSelection(
  plan: OpenAISelectionPlan,
  segmentId: string,
  fromIndex: number,
  toIndex: number,
): OpenAISelectionPlan {
  return {
    ...plan,
    segmentPlans: plan.segmentPlans.map((segmentPlan) => {
      if (segmentPlan.segmentId !== segmentId) {
        return segmentPlan;
      }

      const selections = [...segmentPlan.rankedTrackSelections];

      if (
        fromIndex < 0 ||
        fromIndex >= selections.length ||
        toIndex < 0 ||
        toIndex >= selections.length
      ) {
        return segmentPlan;
      }

      const [moved] = selections.splice(fromIndex, 1);
      selections.splice(toIndex, 0, moved);

      return { ...segmentPlan, rankedTrackSelections: selections };
    }),
  };
}
