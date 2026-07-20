import { Sparkles } from "lucide-react";
import type {
  BpmInterpretation,
  CandidateScore,
  OpenAISelectionPlan,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import {
  getLocalizedBpmInterpretation,
  getLocalizedSegmentName,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type OpenAISelectionPlanViewProps = {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  selectionPlan: OpenAISelectionPlan;
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  planTitle: string;
  copy: MultiTrackCopy["selection"];
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"];
  interpretations: MultiTrackCopy["candidates"]["interpretations"];
};

export function OpenAISelectionPlanView({
  runningPlan,
  tracks,
  selectionPlan,
  candidateGroups,
  planTitle,
  copy,
  segmentNames,
  interpretations,
}: OpenAISelectionPlanViewProps) {
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
  const segmentsById = new Map(
    runningPlan.segments.map((segment) => [segment.segmentId, segment]),
  );
  const candidatesBySelectionKey = new Map<string, CandidateScore>();

  for (const group of candidateGroups) {
    for (const candidate of group.topCandidates) {
      candidatesBySelectionKey.set(
        getSelectionKey(
          group.segmentId,
          candidate.trackId,
          candidate.interpretation,
        ),
        candidate,
      );
    }
  }

  return (
    <section className="panel planner-panel" aria-labelledby="openai-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="openai-title">
            {copy.title(selectionPlan.mixTitle || planTitle)}
          </h2>
        </div>
        <Sparkles aria-hidden="true" />
      </div>

      <div className="selection-list">
        {selectionPlan.segmentPlans.map((segmentPlan) => {
          const segment = segmentsById.get(segmentPlan.segmentId);

          return (
            <div className="selection-group" key={segmentPlan.segmentId}>
              <h3>
                {segment
                  ? getLocalizedSegmentName(segmentNames, segment.name)
                  : segmentPlan.segmentId}
              </h3>
              {segmentPlan.rankedTrackSelections.length > 0 ? (
                <ol>
                  {segmentPlan.rankedTrackSelections.map((selection) => {
                    const candidate = candidatesBySelectionKey.get(
                      getSelectionKey(
                        segmentPlan.segmentId,
                        selection.trackId,
                        selection.selectedBpmInterpretation,
                      ),
                    );

                    return (
                      <li key={`${segmentPlan.segmentId}-${selection.trackId}`}>
                        <strong>
                          {tracksById.get(selection.trackId)?.fileName ??
                            selection.trackId}
                        </strong>
                        <span>
                          {getLocalizedBpmInterpretation(
                            interpretations,
                            selection.selectedBpmInterpretation,
                          )}{" "}
                          {copy.clickVolume(
                            selection.metronomePreference.clickVolume,
                          )}
                        </span>
                        <p>
                          {candidate
                            ? copy.reason(
                                formatScore(candidate.totalScore),
                                formatScore(candidate.cadenceFitScore),
                                candidate.bestCandidateBpm.toFixed(1),
                                formatScore(candidate.energyFitScore),
                                candidate.requiredStretchPercent.toFixed(1),
                              )
                            : selection.reason}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="empty-state">{copy.noSelection}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getSelectionKey(
  segmentId: string,
  trackId: string,
  interpretation: BpmInterpretation,
): string {
  return `${segmentId}:${trackId}:${interpretation}`;
}

function formatScore(value: number): string {
  return Math.round(value).toString();
}
