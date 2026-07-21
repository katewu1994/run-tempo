import type {
  BpmInterpretation,
  ExecutableMixPlan,
  OpenAISelectionPlan,
  MetronomeClickStyle,
  MetronomePreference,
  RunSegment,
  RunningPlan,
  StretchDecision,
  TrackFeature,
} from "../domain/mixTypes";
import {
  MAX_EMBEDDED_CLICK_STRETCH_PERCENT,
  trackHasEmbeddedClick,
} from "./scoreCandidates";

type ExecutableBlock = ExecutableMixPlan["blocks"][number];

const MIN_REQUIRED_CLICK_VOLUME = 0.1;
const REQUIRED_CLICK_STYLE: MetronomeClickStyle = "sharp_beep";
const REQUIRED_ACCENT_EVERY: MetronomePreference["accentEvery"] = 4;

export function buildExecutableMixPlan(args: {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  selectionPlan: OpenAISelectionPlan;
  crossfadeSec: number;
  allowLoop?: boolean;
  trimToPlanDuration?: boolean;
}): ExecutableMixPlan {
  const blocks: ExecutableBlock[] = [];
  const tracksById = new Map(args.tracks.map((track) => [track.trackId, track]));
  const segmentPlansById = new Map(
    args.selectionPlan.segmentPlans.map((segmentPlan) => [
      segmentPlan.segmentId,
      segmentPlan,
    ]),
  );
  for (const [segmentIndex, segment] of args.runningPlan.segments.entries()) {
    const shouldTrimAtSegmentEnd =
      (args.trimToPlanDuration ?? true) ||
      segmentIndex < args.runningPlan.segments.length - 1;
    const segmentPlan = segmentPlansById.get(segment.segmentId);

    if (!segmentPlan) {
      console.warn(`No selection plan found for segment ${segment.segmentId}.`);
      continue;
    }

    let cursorSec = segment.startSec;
    let previousBlock: ExecutableBlock | null = null;

    if (cursorSec >= segment.endSec) {
      continue;
    }

    const resolvedSelections = resolveSelectionsForSegment(
      segment,
      segmentPlan.rankedTrackSelections,
      tracksById,
    );

    if (resolvedSelections.length === 0) {
      console.warn(`No usable selections found for segment ${segment.segmentId}.`);
      continue;
    }

    let selectionIndex = 0;

    while (cursorSec < segment.endSec) {
      if (selectionIndex >= resolvedSelections.length) {
        if (!args.allowLoop) {
          break;
        }

        selectionIndex = 0;
      }

      const resolved = resolvedSelections[selectionIndex];
      selectionIndex += 1;

      const requestedCrossfadeSec = previousBlock
        ? getBarAlignedCrossfadeSec(
            args.crossfadeSec,
            segment.targetCadence,
            REQUIRED_ACCENT_EVERY,
          )
        : 0;
      let crossfadeWithPreviousSec = previousBlock
        ? Math.min(
            requestedCrossfadeSec,
            getBlockDuration(previousBlock) / 2,
            resolved.blockDurationSec / 2,
          )
        : 0;
      let mixStartSec = Math.max(
        segment.startSec,
        cursorSec - crossfadeWithPreviousSec,
      );
      let mixEndSec = shouldTrimAtSegmentEnd
        ? Math.min(segment.endSec, mixStartSec + resolved.blockDurationSec)
        : mixStartSec + resolved.blockDurationSec;
      crossfadeWithPreviousSec = previousBlock
        ? Math.min(
            crossfadeWithPreviousSec,
            getBlockDuration(previousBlock) / 2,
            Math.max(0, mixEndSec - mixStartSec) / 2,
          )
        : 0;
      mixStartSec = Math.max(
        segment.startSec,
        cursorSec - crossfadeWithPreviousSec,
      );
      mixEndSec = shouldTrimAtSegmentEnd
        ? Math.min(segment.endSec, mixStartSec + resolved.blockDurationSec)
        : mixStartSec + resolved.blockDurationSec;

      if (mixEndSec <= cursorSec) {
        break;
      }

      const usedMixDurationSec = mixEndSec - mixStartSec;
      const block: ExecutableBlock = {
        blockId: `${segment.segmentId}-block-${blocks.length + 1}`,
        segmentId: segment.segmentId,
        trackId: resolved.track.trackId,
        mixStartSec,
        mixEndSec,
        sourceStartSec: 0,
        sourceEndSec: Math.min(
          resolved.track.durationSec,
          usedMixDurationSec * resolved.playbackRate,
        ),
        targetCadence: segment.targetCadence,
        cadenceRamp: segment.cadenceRamp,
        selectedSourceBpm: resolved.selectedSourceBpm,
        interpretation: resolved.selection.selectedBpmInterpretation,
        stretchRatio: resolved.stretchRatio,
        stretchDecision: resolved.stretchDecision,
        metronome: {
          enabled:
            resolved.track.sourceKind !== "standardized" &&
            resolved.track.embeddedClickStatus !== "confirmed",
          ...getRequiredMetronomePreference(
            resolved.selection.metronomePreference,
          ),
          offsetMs: 0,
        },
        transition: {
          fadeInSec: 0,
          fadeOutSec: 0,
          crossfadeWithPreviousSec: 0,
        },
      };
      block.transition.crossfadeWithPreviousSec = crossfadeWithPreviousSec;
      block.transition.fadeInSec = crossfadeWithPreviousSec;

      if (previousBlock) {
        previousBlock.transition.fadeOutSec = crossfadeWithPreviousSec;
      }

      blocks.push(block);
      previousBlock = block;
      cursorSec = block.mixEndSec;
    }

    if (cursorSec < segment.endSec) {
      console.warn(
        `Selected tracks filled ${Math.round(cursorSec - segment.startSec)}s of ${Math.round(
          segment.endSec - segment.startSec,
        )}s for segment ${segment.segmentId}.`,
      );
    }
  }

  const renderedDurationSec = blocks.reduce(
    (durationSec, block) => Math.max(durationSec, block.mixEndSec),
    args.runningPlan.totalDurationSec,
  );

  return {
    mixTitle: args.selectionPlan.mixTitle,
    totalDurationSec:
      args.trimToPlanDuration ?? true
        ? args.runningPlan.totalDurationSec
        : renderedDurationSec,
    blocks,
  };
}

function resolveSelectionsForSegment(
  segment: RunSegment,
  selections: OpenAISelectionPlan["segmentPlans"][number]["rankedTrackSelections"],
  tracksById: Map<string, TrackFeature>,
) {
  return selections.flatMap((selection) => {
    const track = tracksById.get(selection.trackId);

    if (!track) {
      console.warn(`Track ${selection.trackId} was selected but is unavailable.`);
      return [];
    }

    const selectedSourceBpm = getSelectedSourceBpm(
      track,
      selection.selectedBpmInterpretation,
    );

    if (selectedSourceBpm === null) {
      console.warn(
        `Track ${track.trackId} does not have a ${selection.selectedBpmInterpretation} BPM candidate.`,
      );
      return [];
    }

    const stretchRatio = segment.targetCadence / selectedSourceBpm;
    const stretchDecision = getStretchDecision(segment, selectedSourceBpm, track);

    if (stretchDecision === "skip_stretch") {
      return [];
    }

    const playbackRate = getRenderPlaybackRate(stretchDecision, stretchRatio);
    const blockDurationSec = getMaxRenderableMixDurationSec(
      track.durationSec,
      playbackRate,
    );

    if (blockDurationSec <= 0) {
      return [];
    }

    return [
      {
        selection,
        track,
        selectedSourceBpm,
        stretchRatio,
        stretchDecision,
        playbackRate,
        blockDurationSec,
      },
    ];
  });
}

function getSelectedSourceBpm(
  track: TrackFeature,
  interpretation: BpmInterpretation,
): number | null {
  return (
    track.bpmCandidates.find(
      (candidate) => candidate.interpretation === interpretation,
    )?.bpm ?? null
  );
}

function getRequiredMetronomePreference(
  preference: MetronomePreference,
): MetronomePreference {
  const clickVolume = Number.isFinite(preference.clickVolume)
    ? preference.clickVolume
    : MIN_REQUIRED_CLICK_VOLUME;

  return {
    clickStyle: REQUIRED_CLICK_STYLE,
    clickVolume: Math.max(
      MIN_REQUIRED_CLICK_VOLUME,
      Math.min(1, clickVolume),
    ),
    accentEvery: REQUIRED_ACCENT_EVERY,
  };
}

function getStretchDecision(
  segment: RunSegment,
  selectedSourceBpm: number,
  track: TrackFeature,
): StretchDecision {
  const requiredStretchPercent = Math.abs(
    segment.targetCadence / selectedSourceBpm - 1,
  ) * 100;

  if (requiredStretchPercent <= 0.05) {
    return "no_stretch";
  }

  if (
    trackHasEmbeddedClick(track) &&
    requiredStretchPercent > MAX_EMBEDDED_CLICK_STRETCH_PERCENT
  ) {
    return "skip_stretch";
  }

  return "safe_stretch";
}

function getBarAlignedCrossfadeSec(
  requestedSec: number,
  cadenceBpm: number,
  accentEvery: MetronomePreference["accentEvery"],
): number {
  if (!Number.isFinite(requestedSec) || requestedSec <= 0) {
    return 0;
  }

  const beatsPerBar = accentEvery > 0 ? accentEvery : 4;
  const barDurationSec = (60 / Math.max(1, cadenceBpm)) * beatsPerBar;
  const barCount = Math.max(1, Math.round(requestedSec / barDurationSec));
  return barDurationSec * barCount;
}

function getBlockDuration(block: ExecutableBlock): number {
  return Math.max(0, block.mixEndSec - block.mixStartSec);
}

function getRenderPlaybackRate(
  stretchDecision: StretchDecision,
  stretchRatio: number,
): number {
  if (
    stretchDecision !== "safe_stretch" ||
    !Number.isFinite(stretchRatio) ||
    stretchRatio <= 0
  ) {
    return 1;
  }

  return stretchRatio;
}

function getMaxRenderableMixDurationSec(
  sourceDurationSec: number,
  playbackRate: number,
): number {
  if (!Number.isFinite(sourceDurationSec) || sourceDurationSec <= 0) {
    return 0;
  }

  if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
    return sourceDurationSec;
  }

  return sourceDurationSec / playbackRate;
}
