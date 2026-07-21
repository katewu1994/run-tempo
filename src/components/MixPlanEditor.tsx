import { useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListRestart,
  Lock,
  Unlock,
} from "lucide-react";
import type {
  CandidateScore,
  OpenAISelectionPlan,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import type { MultiTrackCopy } from "./multiTrackFormat";
import { getLocalizedSegmentName } from "./multiTrackFormat";
import { getLockedSelectionKey } from "../planning/editSelectionPlan";

type DragSelection = { segmentId: string; index: number } | null;

export function MixPlanEditor({
  runningPlan,
  selectionPlan,
  tracks,
  candidateGroups,
  lockedSelectionKeys,
  isBusy,
  copy,
  segmentNames,
  onToggleLock,
  onReplace,
  onMove,
}: {
  runningPlan: RunningPlan;
  selectionPlan: OpenAISelectionPlan;
  tracks: TrackFeature[];
  candidateGroups: Array<{ segmentId: string; topCandidates: CandidateScore[] }>;
  lockedSelectionKeys: Set<string>;
  isBusy: boolean;
  copy: MultiTrackCopy["editor"];
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"];
  onToggleLock: (segmentId: string, trackId: string) => void;
  onReplace: (segmentId: string, index: number, trackId: string) => void;
  onMove: (segmentId: string, fromIndex: number, toIndex: number) => void;
}) {
  const [dragSelection, setDragSelection] = useState<DragSelection>(null);
  const tracksById = new Map(tracks.map((track) => [track.trackId, track]));
  const segmentsById = new Map(
    runningPlan.segments.map((segment) => [segment.segmentId, segment]),
  );
  const candidatesBySegmentId = new Map(
    candidateGroups.map((group) => [group.segmentId, group.topCandidates]),
  );

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
  };

  return (
    <section className="panel planner-panel sequence-editor" aria-labelledby="sequence-editor-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h2 id="sequence-editor-title">{copy.title}</h2>
          <p className="field-hint">{copy.hint}</p>
        </div>
        <ListRestart aria-hidden="true" />
      </div>

      <div className="sequence-groups">
        {selectionPlan.segmentPlans.map((segmentPlan) => {
          const segment = segmentsById.get(segmentPlan.segmentId);
          const selectedTrackIds = new Set(
            segmentPlan.rankedTrackSelections.map((selection) => selection.trackId),
          );
          const candidates = candidatesBySegmentId.get(segmentPlan.segmentId) ?? [];

          if (!segment || segmentPlan.rankedTrackSelections.length === 0) {
            return null;
          }

          return (
            <section className="sequence-group" key={segmentPlan.segmentId}>
              <div className="sequence-group-heading">
                <strong>{getLocalizedSegmentName(segmentNames, segment.name)}</strong>
                <span>{segment.targetCadence} BPM</span>
              </div>
              <ol>
                {segmentPlan.rankedTrackSelections.map((selection, index) => {
                  const key = getLockedSelectionKey(segmentPlan.segmentId, selection.trackId);
                  const locked = lockedSelectionKeys.has(key);

                  return (
                    <li
                      className={`sequence-row ${locked ? "locked" : ""}`}
                      draggable={!isBusy}
                      key={`${selection.trackId}-${index}`}
                      onDragStart={() =>
                        setDragSelection({ segmentId: segmentPlan.segmentId, index })
                      }
                      onDragEnd={() => setDragSelection(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDrop(event, segmentPlan.segmentId, index)}
                    >
                      <span className="sequence-grip" aria-hidden="true">
                        <GripVertical size={18} />
                      </span>
                      <span className="sequence-index">{index + 1}</span>
                      <div className="sequence-track-copy">
                        <strong>{tracksById.get(selection.trackId)?.fileName ?? selection.trackId}</strong>
                        <small>{selection.reason}</small>
                      </div>
                      <label className="sequence-replace-field">
                        <span className="sr-only">{copy.replace}</span>
                        <select
                          aria-label={`${copy.replace}: ${tracksById.get(selection.trackId)?.fileName ?? selection.trackId}`}
                          disabled={isBusy || locked}
                          value={selection.trackId}
                          onChange={(event) =>
                            onReplace(segmentPlan.segmentId, index, event.target.value)
                          }
                        >
                          {candidates.map((candidate) => (
                            <option
                              key={candidate.trackId}
                              value={candidate.trackId}
                              disabled={
                                candidate.trackId !== selection.trackId &&
                                selectedTrackIds.has(candidate.trackId)
                              }
                            >
                              {tracksById.get(candidate.trackId)?.fileName ?? candidate.trackId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="sequence-actions">
                        <button
                          type="button"
                          className="icon-action"
                          disabled={isBusy || index === 0}
                          aria-label={copy.moveUp}
                          onClick={() => onMove(segmentPlan.segmentId, index, index - 1)}
                        ><ArrowUp size={15} aria-hidden="true" /></button>
                        <button
                          type="button"
                          className="icon-action"
                          disabled={isBusy || index === segmentPlan.rankedTrackSelections.length - 1}
                          aria-label={copy.moveDown}
                          onClick={() => onMove(segmentPlan.segmentId, index, index + 1)}
                        ><ArrowDown size={15} aria-hidden="true" /></button>
                        <button
                          type="button"
                          className={`icon-action sequence-lock ${locked ? "active" : ""}`}
                          disabled={isBusy}
                          aria-label={locked ? copy.unlock : copy.lock}
                          aria-pressed={locked}
                          onClick={() => onToggleLock(segmentPlan.segmentId, selection.trackId)}
                        >
                          {locked ? <Lock size={15} aria-hidden="true" /> : <Unlock size={15} aria-hidden="true" />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}
