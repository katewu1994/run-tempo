import { Trash2 } from "lucide-react";
import type { TrackFeature } from "../domain/mixTypes";
import { formatBpm, formatDuration } from "../utils/format";
import {
  getLocalizedBpmInterpretation,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type TrackFeatureTableProps = {
  tracks: TrackFeature[];
  copy: MultiTrackCopy["tracks"];
  onRemove?: (trackId: string) => void;
};

export function TrackFeatureTable({ tracks, copy, onRemove }: TrackFeatureTableProps) {
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
              <th scope="col">{copy.headers.source}</th>
              <th scope="col">{copy.headers.duration}</th>
              <th scope="col">{copy.headers.detectedBpm}</th>
              <th scope="col">{copy.headers.candidates}</th>
              <th scope="col">{copy.headers.energy}</th>
              {onRemove ? <th scope="col"><span className="sr-only">{copy.remove}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr key={track.trackId}>
                <td>
                  <strong className="track-file-name">{track.fileName}</strong>
                  {track.relativePath ? (
                    <small className="track-relative-path">
                      {track.relativePath}
                    </small>
                  ) : null}
                </td>
                <td>
                  <span className={`source-kind-pill ${track.sourceKind}`}>
                    {copy.sourceLabels[track.sourceKind]}
                  </span>
                </td>
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
                {onRemove ? (
                  <td>
                    <button
                      type="button"
                      className="icon-action track-remove-action"
                      aria-label={`${copy.remove}: ${track.fileName}`}
                      onClick={() => onRemove(track.trackId)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </td>
                ) : null}
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
