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
}): ExecutableMixPlan {
  const blocks: ExecutableBlock[] = [];
  const tracksById = new Map(args.tracks.map((track) => [track.trackId, track]));
  const segmentPlansById = new Map(
    args.selectionPlan.segmentPlans.map((segmentPlan) => [
      segmentPlan.segmentId,
      segmentPlan,
    ]),
  );
  let timelineCursorSec = 0;
  let previousBlock: ExecutableBlock | null = null;

  for (const segment of args.runningPlan.segments) {
    const segmentPlan = segmentPlansById.get(segment.segmentId);

    if (!segmentPlan) {
      console.warn(`No selection plan found for segment ${segment.segmentId}.`);
      continue;
    }

    let cursorSec = Math.max(segment.startSec, timelineCursorSec);

    if (cursorSec >= segment.endSec) {
      continue;
    }

    const resolvedSelections = resolveSelectionsForSegment(
      segment,
      segmentPlan.rankedTrackSelections,
      tracksById,
    );
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

      const block: ExecutableBlock = {
        blockId: `${segment.segmentId}-block-${blocks.length + 1}`,
        segmentId: segment.segmentId,
        trackId: resolved.track.trackId,
        mixStartSec: cursorSec,
        mixEndSec: cursorSec + resolved.blockDurationSec,
        sourceStartSec: 0,
        sourceEndSec: resolved.track.durationSec,
        targetCadence: segment.targetCadence,
        cadenceRamp: segment.cadenceRamp,
        selectedSourceBpm: resolved.selectedSourceBpm,
        interpretation: resolved.selection.selectedBpmInterpretation,
        stretchRatio: resolved.stretchRatio,
        stretchDecision: resolved.stretchDecision,
        metronome: {
          enabled: true,
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
      const crossfadeWithPreviousSec =
        previousBlock === null
          ? 0
          : Math.min(
              Math.max(0, args.crossfadeSec),
              getBlockDuration(previousBlock) / 2,
              getBlockDuration(block) / 2,
            );

      block.transition.crossfadeWithPreviousSec = crossfadeWithPreviousSec;
      block.transition.fadeInSec = crossfadeWithPreviousSec;

      if (previousBlock) {
        previousBlock.transition.fadeOutSec = crossfadeWithPreviousSec;
      }

      blocks.push(block);
      previousBlock = block;
      cursorSec = block.mixEndSec;
      timelineCursorSec = Math.max(timelineCursorSec, cursorSec);
    }

    if (cursorSec < segment.endSec) {
      console.warn(
        `Selected tracks filled ${Math.round(cursorSec - segment.startSec)}s of ${Math.round(
          segment.endSec - segment.startSec,
        )}s for segment ${segment.segmentId}.`,
      );
    }
  }

  return {
    mixTitle: args.selectionPlan.mixTitle,
    totalDurationSec: Math.max(
      args.runningPlan.totalDurationSec,
      getLastBlockEndSec(blocks),
    ),
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
    const stretchDecision = getStretchDecision(
      segment,
      selectedSourceBpm,
      stretchRatio,
    );
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
  stretchRatio: number,
): StretchDecision {
  const bpmDifference = Math.abs(segment.targetCadence - selectedSourceBpm);
  const requiredStretchPercent = Math.abs(stretchRatio - 1) * 100;

  if (bpmDifference <= 3) {
    return "no_stretch";
  }

  if (requiredStretchPercent <= segment.maxStretchPercent) {
    return "safe_stretch";
  }

  return "skip_stretch";
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

function getLastBlockEndSec(blocks: ExecutableBlock[]): number {
  return blocks.reduce(
    (lastEndSec, block) => Math.max(lastEndSec, block.mixEndSec),
    0,
  );
}
