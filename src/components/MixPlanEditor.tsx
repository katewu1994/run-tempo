import { useState, type DragEvent } from "react";
import { GripVertical, Info, Repeat2 } from "lucide-react";
import type {
  BpmInterpretation,
  CandidateScore,
  ExecutableMixPlan,
  OpenAISelectionPlan,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import { formatDuration } from "../utils/format";
import type { MultiTrackCopy } from "./multiTrackFormat";
import {
  getLocalizedBpmInterpretation,
  getLocalizedSegmentName,
} from "./multiTrackFormat";

type DragSelection = { segmentId: string; index: number } | null;

export function MixPlanEditor({
  runningPlan,
  selectionPlan,
  executablePlan,
  trimToPlanDuration,
  tracks,
  candidateGroups,
  isBusy,
  copy,
  analysisCopy,
  segmentNames,
  onMove,
  onTrimToPlanDurationChange,
}: {
  runningPlan: RunningPlan;
  selectionPlan: OpenAISelectionPlan;
  executablePlan: ExecutableMixPlan;
  trimToPlanDuration: boolean;
  tracks: TrackFeature[];
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  isBusy: boolean;
  copy: MultiTrackCopy["editor"];
  analysisCopy: MultiTrackCopy["candidates"];
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"];
  onMove: (segmentId: string, fromIndex: number, toIndex: number) => void;
  onTrimToPlanDurationChange: (shouldTrim: boolean) => void;
}) {
  const [dragSelection, setDragSelection] = useState<DragSelection>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isTrimHelpOpen, setIsTrimHelpOpen] = useState(false);
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

  const handleDrop = (
    event: DragEvent<HTMLLIElement>,
    segmentId: string,
    targetIndex: number,
  ) => {
    event.preventDefault();

    if (dragSelection?.segmentId === segmentId) {
      onMove(segmentId, dragSelection.index, targetIndex);
    }

    setDragSelection(null);
    setDragOverIndex(null);
  };

  return (
    <section className="panel planner-panel sequence-editor" aria-labelledby="sequence-editor-title">
      <div className="panel-heading">
        <div>
          <h2 id="sequence-editor-title">{copy.title}</h2>
        </div>
        <div className="sequence-trim-control">
          <label>
            <input
              type="checkbox"
              checked={trimToPlanDuration}
              disabled={isBusy}
              onChange={(event) =>
                onTrimToPlanDurationChange(event.currentTarget.checked)
              }
            />
            <span>{copy.trimToPlanDuration}</span>
          </label>
          <div className="sequence-trim-help">
            <button
              type="button"
              aria-label={copy.trimToPlanDurationHelp}
              aria-expanded={isTrimHelpOpen}
              aria-controls="trim-to-plan-help"
              onClick={() => setIsTrimHelpOpen((isOpen) => !isOpen)}
            >
              <Info size={15} aria-hidden="true" />
            </button>
            {isTrimHelpOpen ? (
              <div id="trim-to-plan-help" role="note">
                {copy.trimToPlanDurationHint}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sequence-groups">
        {selectionPlan.segmentPlans.map((segmentPlan) => {
          const segment = segmentsById.get(segmentPlan.segmentId);
          if (!segment || segmentPlan.rankedTrackSelections.length === 0) {
            return null;
          }

          const playbackBlocks = executablePlan.blocks.filter(
            (block) => block.segmentId === segmentPlan.segmentId,
          );
          const hasAutomaticRepeats =
            playbackBlocks.length > segmentPlan.rankedTrackSelections.length;
          const hasPlaybackAdjustment =
            hasAutomaticRepeats ||
            Math.abs(executablePlan.totalDurationSec - runningPlan.totalDurationSec) > 0.05;

          return (
            <section className="sequence-group" key={segmentPlan.segmentId}>
              <div className="sequence-group-heading">
                <strong>{getLocalizedSegmentName(segmentNames, segment.name)}</strong>
                <span>{segment.targetCadence} BPM</span>
              </div>
              <ol>
                {segmentPlan.rankedTrackSelections.map((selection, index) => {
                  const candidate = candidatesBySelectionKey.get(
                    getSelectionKey(
                      segmentPlan.segmentId,
                      selection.trackId,
                      selection.selectedBpmInterpretation,
                    ),
                  );
                  const dragging = dragSelection?.segmentId === segmentPlan.segmentId && dragSelection.index === index;
                  const dragTarget = dragSelection?.segmentId === segmentPlan.segmentId && dragOverIndex === index;

                  return (
                    <li
                      className={`sequence-row ${dragging ? "dragging" : ""} ${dragTarget ? "drag-target" : ""}`}
                      draggable={!isBusy}
                      key={`${selection.trackId}-${index}`}
                      onDragStart={() =>
                        setDragSelection({ segmentId: segmentPlan.segmentId, index })
                      }
                      onDragEnd={() => {
                        setDragSelection(null);
                        setDragOverIndex(null);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragEnter={() => setDragOverIndex(index)}
                      onDrop={(event) => handleDrop(event, segmentPlan.segmentId, index)}
                    >
                      <span className="sequence-grip" title={copy.drag}>
                        <GripVertical size={18} />
                        <span className="sr-only">{copy.drag}</span>
                      </span>
                      <span className="sequence-index">{index + 1}</span>
                      <div className="sequence-track-copy">
                        <strong>{tracksById.get(selection.trackId)?.fileName ?? selection.trackId}</strong>
                      </div>
                      {candidate ? (
                        <div className="sequence-analysis" aria-label={copy.analysis}>
                          <span className="sequence-analysis-bpm">
                            {candidate.bestCandidateBpm.toFixed(1)} BPM
                          </span>
                          <span>
                            {getLocalizedBpmInterpretation(
                              analysisCopy.interpretations,
                              selection.selectedBpmInterpretation,
                            )}
                          </span>
                          <span>{analysisCopy.headers.total} {formatScore(candidate.totalScore)}</span>
                          <span>{analysisCopy.headers.cadence} {formatScore(candidate.cadenceFitScore)}</span>
                          <span>{analysisCopy.headers.energy} {formatScore(candidate.energyFitScore)}</span>
                          <span>{analysisCopy.headers.structure} {formatScore(candidate.structureFitScore)}</span>
                          <span>{analysisCopy.headers.mood} {formatScore(candidate.moodFitScore)}</span>
                          <span>{analysisCopy.headers.stretch} {candidate.requiredStretchPercent.toFixed(1)}%</span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              {hasPlaybackAdjustment ? (
                <section
                  className="sequence-playback-preview"
                  aria-label={copy.playbackOrder}
                >
                  <div className="sequence-playback-heading">
                    <span className="sequence-playback-icon" aria-hidden="true">
                      <Repeat2 size={15} />
                    </span>
                    <div>
                      <strong>{copy.playbackOrder}</strong>
                      <small>
                        {hasAutomaticRepeats
                          ? copy.playbackOrderHint
                          : copy.extendedPlaybackHint}
                      </small>
                    </div>
                    <span className="sequence-block-count">
                      {copy.blockCount(playbackBlocks.length)}
                    </span>
                  </div>
                  <ol className="sequence-playback-order">
                    {playbackBlocks.map((block, blockIndex) => {
                      const isRepeat = playbackBlocks
                        .slice(0, blockIndex)
                        .some((previousBlock) => previousBlock.trackId === block.trackId);

                      return (
                        <li
                          className={isRepeat ? "is-repeat" : ""}
                          key={block.blockId}
                        >
                          <span className="sequence-playback-index">
                            {blockIndex + 1}
                          </span>
                          <strong>
                            {tracksById.get(block.trackId)?.fileName ?? block.trackId}
                          </strong>
                          <span className="sequence-playback-time">
                            {copy.mixTime(
                              formatDuration(block.mixStartSec),
                              formatDuration(block.mixEndSec),
                            )}
                          </span>
                          {isRepeat ? (
                            <span className="sequence-repeat-badge">
                              <Repeat2 size={11} aria-hidden="true" />
                              {copy.repeated}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ) : null}
            </section>
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
