import type { TrackFeature } from "../domain/mixTypes";
import { formatBpm, formatDuration } from "../utils/format";
import {
  getLocalizedBpmInterpretation,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type TrackFeatureTableProps = {
  tracks: TrackFeature[];
  copy: MultiTrackCopy["tracks"];
};

export function TrackFeatureTable({ tracks, copy }: TrackFeatureTableProps) {
  return (
    <section className="panel planner-panel" aria-labelledby="tracks-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="tracks-title">{copy.title}</h2>
        </div>
      </div>

      <div className="table-wrap">
        <table className="planner-table">
          <thead>
            <tr>
              <th scope="col">{copy.headers.file}</th>
              <th scope="col">{copy.headers.duration}</th>
              <th scope="col">{copy.headers.detectedBpm}</th>
              <th scope="col">{copy.headers.candidates}</th>
              <th scope="col">{copy.headers.energy}</th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.trackId}>
                <td>{track.fileName}</td>
                <td>{formatDuration(track.durationSec)}</td>
                <td>{formatBpm(track.detectedBpm)}</td>
                <td>
                  <div className="inline-tags">
                    {track.bpmCandidates.length > 0 ? (
                      track.bpmCandidates.map((candidate) => (
                        <span
                          className="metric-tag"
                          key={`${track.trackId}-${candidate.interpretation}`}
                        >
                          {formatBpm(candidate.bpm)}{" "}
                          {getLocalizedBpmInterpretation(
                            copy.interpretations,
                            candidate.interpretation,
                          )}
                        </span>
                      ))
                    ) : (
                      <span className="empty-value">{copy.noCandidates}</span>
                    )}
                  </div>
                </td>
                <td>{formatScore(track.normalizedEnergyScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return Math.round(value).toString();
}
