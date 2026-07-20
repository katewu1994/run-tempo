import { ListChecks } from "lucide-react";
import type { CandidateScore, RunningPlan, TrackFeature } from "../domain/mixTypes";
import { formatBpm } from "../utils/format";
import {
  formatSegmentCadence,
  getLocalizedBpmInterpretation,
  getLocalizedSegmentName,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type CandidateScoreTableProps = {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  copy: MultiTrackCopy["candidates"];
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"];
};

export function CandidateScoreTable({
  runningPlan,
  tracks,
  candidateGroups,
  copy,
  segmentNames,
}: CandidateScoreTableProps) {
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
  const segmentsById = new Map(
    runningPlan.segments.map((segment) => [segment.segmentId, segment]),
  );

  return (
    <section className="panel planner-panel" aria-labelledby="scores-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="scores-title">{copy.title}</h2>
        </div>
        <ListChecks aria-hidden="true" />
      </div>

      <div className="candidate-groups">
        {candidateGroups.map((group) => {
          const segment = segmentsById.get(group.segmentId);

          return (
            <div className="candidate-group" key={group.segmentId}>
              <h3>
                {segment
                  ? getLocalizedSegmentName(segmentNames, segment.name)
                  : group.segmentId}
                {segment ? <span>{formatSegmentCadence(segment)}</span> : null}
              </h3>
              {group.topCandidates.length > 0 ? (
                <div className="table-wrap compact-table">
                  <table className="planner-table">
                    <thead>
                      <tr>
                        <th scope="col">{copy.headers.track}</th>
                        <th scope="col">{copy.headers.bpm}</th>
                        <th scope="col">{copy.headers.total}</th>
                        <th scope="col">{copy.headers.cadence}</th>
                        <th scope="col">{copy.headers.energy}</th>
                        <th scope="col">{copy.headers.stretch}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.topCandidates.map((candidate) => (
                        <tr key={`${group.segmentId}-${candidate.trackId}`}>
                          <td>
                            {tracksById.get(candidate.trackId)?.fileName ??
                              candidate.trackId}
                          </td>
                          <td>
                            {formatBpm(candidate.bestCandidateBpm)}{" "}
                            {getLocalizedBpmInterpretation(
                              copy.interpretations,
                              candidate.interpretation,
                            )}
                          </td>
                          <td>{formatScore(candidate.totalScore)}</td>
                          <td>{formatScore(candidate.cadenceFitScore)}</td>
                          <td>{formatScore(candidate.energyFitScore)}</td>
                          <td>{candidate.requiredStretchPercent.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty-state">{copy.emptySegment}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function formatScore(value: number): string {
  return Math.round(value).toString();
}
