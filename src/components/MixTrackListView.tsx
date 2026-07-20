import { ListMusic } from "lucide-react";
import type {
  ExecutableMixPlan,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import { formatDuration } from "../utils/format";
import {
  getLocalizedBpmInterpretation,
  getLocalizedSegmentName,
  type MultiTrackCopy,
} from "./multiTrackFormat";

type MixTrackListViewProps = {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  executablePlan: ExecutableMixPlan;
  planTitle: string;
  copy: MultiTrackCopy["selection"];
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"];
  interpretations: MultiTrackCopy["candidates"]["interpretations"];
};

export function MixTrackListView({
  runningPlan,
  tracks,
  executablePlan,
  planTitle,
  copy,
  segmentNames,
  interpretations,
}: MixTrackListViewProps) {
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
  const blocksBySegmentId = new Map<string, ExecutableMixPlan["blocks"]>();

  for (const block of executablePlan.blocks) {
    const blocks = blocksBySegmentId.get(block.segmentId) ?? [];
    blocks.push(block);
    blocksBySegmentId.set(block.segmentId, blocks);
  }

  const segmentsWithBlocks = runningPlan.segments
    .map((segment) => ({
      segment,
      blocks: blocksBySegmentId.get(segment.segmentId) ?? [],
    }))
    .filter((group) => group.blocks.length > 0);

  return (
    <section className="panel planner-panel" aria-labelledby="mix-track-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="mix-track-title">
            {copy.title(executablePlan.mixTitle || planTitle)}
          </h2>
        </div>
        <ListMusic aria-hidden="true" />
      </div>

      <dl className="summary-grid planner-summary">
        <div>
          <dt>{copy.summary.mixTitle}</dt>
          <dd>{executablePlan.mixTitle || planTitle}</dd>
        </div>
        <div>
          <dt>{copy.summary.totalDuration}</dt>
          <dd>{formatDuration(executablePlan.totalDurationSec)}</dd>
        </div>
        <div>
          <dt>{copy.summary.tracksInMix}</dt>
          <dd>{copy.trackCount(executablePlan.blocks.length)}</dd>
        </div>
      </dl>

      {segmentsWithBlocks.length > 0 ? (
        <div className="selection-list">
          {segmentsWithBlocks.map(({ segment, blocks }) => (
            <div className="selection-group" key={segment.segmentId}>
              <h3>{getLocalizedSegmentName(segmentNames, segment.name)}</h3>
              <ol>
                {blocks.map((block) => (
                  <li key={block.blockId}>
                    <strong>
                      {tracksById.get(block.trackId)?.fileName ?? block.trackId}
                    </strong>
                    <div className="inline-tags">
                      <span className="metric-tag">
                        {copy.mixTime(
                          formatDuration(block.mixStartSec),
                          formatDuration(block.mixEndSec),
                        )}
                      </span>
                      <span className="metric-tag">
                        {copy.sourceTime(
                          formatDuration(block.sourceStartSec),
                          formatDuration(block.sourceEndSec),
                        )}
                      </span>
                      <span className="metric-tag">
                        {copy.bpmDetail(
                          getLocalizedBpmInterpretation(
                            interpretations,
                            block.interpretation,
                          ),
                          block.selectedSourceBpm.toFixed(1),
                        )}
                      </span>
                      <span className="metric-tag">
                        {copy.clickVolume(block.metronome.clickVolume)}
                      </span>
                    </div>
                    <p>
                      {copy.blockDetail(
                        formatDuration(block.mixEndSec - block.mixStartSec),
                        block.stretchRatio.toFixed(3),
                      )}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">{copy.noSelection}</p>
      )}
    </section>
  );
}
