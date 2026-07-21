import type {
  CandidateScore,
  MixPlanVariant,
  OpenAISelectionPlan,
} from "../domain/mixTypes";

type CandidateGroup = {
  segmentId: string;
  topCandidates: CandidateScore[];
};

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
