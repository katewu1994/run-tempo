import type {
  CadenceRamp,
  RunningPlan,
  RunSegment,
  RunSegmentName,
} from "./mixTypes";

export type RunningPlanMode = "constant" | "progressive" | "interval";

export type RunningPlanSettings = {
  mode: RunningPlanMode;
  maxStretchPercent: number;
  constant: {
    durationMin: number;
    bpm: number;
  };
  progressive: {
    warmupMin: number;
    buildMin: number;
    holdMin: number;
    cooldownMin: number;
    startBpm: number;
    peakBpm: number;
    endBpm: number;
  };
  interval: {
    warmupMin: number;
    fastMin: number;
    slowMin: number;
    repeats: number;
    cooldownMin: number;
    fastBpm: number;
    slowBpm: number;
  };
};

const SECONDS_PER_MINUTE = 60;
const DEFAULT_MAX_STRETCH_PERCENT = 10;
const PROGRESSIVE_CADENCE_STEP_BPM = 5;
export const MAX_MULTI_TRACK_DURATION_SEC = 60 * 60;

export const MIN_RUNNING_BPM = 80;
export const MAX_RUNNING_BPM = 220;

export const DEFAULT_RUNNING_PLAN_SETTINGS: RunningPlanSettings = {
  mode: "constant",
  maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
  constant: {
    durationMin: 15,
    bpm: 180,
  },
  progressive: {
    warmupMin: 5,
    buildMin: 15,
    holdMin: 5,
    cooldownMin: 5,
    startBpm: 140,
    peakBpm: 170,
    endBpm: 135,
  },
  interval: {
    warmupMin: 5,
    fastMin: 2,
    slowMin: 2,
    repeats: 6,
    cooldownMin: 5,
    fastBpm: 175,
    slowBpm: 140,
  },
};

export function buildRunningPlanFromSettings(
  settings: RunningPlanSettings,
): RunningPlan {
  let plan: RunningPlan;

  if (settings.mode === "progressive") {
    plan = buildProgressivePlan(settings);
  } else if (settings.mode === "interval") {
    plan = buildIntervalPlan(settings);
  } else {
    plan = buildConstantPlan(settings);
  }

  return limitPlanDuration(plan, MAX_MULTI_TRACK_DURATION_SEC);
}

function limitPlanDuration(plan: RunningPlan, maxDurationSec: number): RunningPlan {
  if (plan.totalDurationSec <= maxDurationSec) {
    return plan;
  }

  const segments = plan.segments.flatMap((segment) => {
    if (segment.startSec >= maxDurationSec) {
      return [];
    }

    return [{ ...segment, endSec: Math.min(segment.endSec, maxDurationSec) }];
  });

  return {
    ...plan,
    title: `${plan.title} (60 min max)`,
    totalDurationSec: maxDurationSec,
    segments,
  };
}

export function getTargetCadenceAtSec(
  plan: RunningPlan,
  elapsedSec: number,
): number | null {
  if (!Number.isFinite(elapsedSec)) {
    return null;
  }

  const boundedElapsedSec = Math.max(0, Math.min(plan.totalDurationSec, elapsedSec));
  const segment = plan.segments.find(
    (item) =>
      boundedElapsedSec >= item.startSec &&
      (boundedElapsedSec < item.endSec || item.endSec === plan.totalDurationSec),
  );

  if (!segment) {
    return null;
  }

  if (!segment.cadenceRamp) {
    return segment.targetCadence;
  }

  const durationSec = Math.max(1, segment.endSec - segment.startSec);
  const progress = Math.max(
    0,
    Math.min(1, (boundedElapsedSec - segment.startSec) / durationSec),
  );

  return roundCadence(
    segment.cadenceRamp.start +
      (segment.cadenceRamp.end - segment.cadenceRamp.start) * progress,
  );
}

function buildConstantPlan(settings: RunningPlanSettings): RunningPlan {
  const durationMin = sanitizeMinutes(settings.constant.durationMin, 15, 1, 240);
  const bpm = sanitizeBpm(settings.constant.bpm, 180);
  const maxStretchPercent = sanitizeMaxStretchPercent(settings.maxStretchPercent);
  const totalDurationSec = minutesToSeconds(durationMin);
  const segments = [
    createSegment({
      segmentId: "constant-steady",
      name: "steady",
      startSec: 0,
      endSec: totalDurationSec,
      targetCadence: bpm,
      targetEnergyRange: { min: 40, max: 70 },
      maxStretchPercent,
    }),
  ];

  return {
    planId: createPlanId("constant", [durationMin, bpm, maxStretchPercent]),
    title: `Manual constant ${bpm} BPM - ${formatMinutes(durationMin)}`,
    totalDurationSec,
    segments,
  };
}

function buildProgressivePlan(settings: RunningPlanSettings): RunningPlan {
  const warmupMin = sanitizeMinutes(settings.progressive.warmupMin, 5, 0, 60);
  const buildMin = sanitizeMinutes(settings.progressive.buildMin, 15, 1, 180);
  const holdMin = sanitizeMinutes(settings.progressive.holdMin, 5, 0, 120);
  const cooldownMin = sanitizeMinutes(settings.progressive.cooldownMin, 5, 0, 60);
  const startBpm = sanitizeBpm(settings.progressive.startBpm, 140);
  const peakBpm = sanitizeBpm(settings.progressive.peakBpm, 170);
  const endBpm = sanitizeBpm(settings.progressive.endBpm, 135);
  const maxStretchPercent = sanitizeMaxStretchPercent(settings.maxStretchPercent);
  const segments: RunSegment[] = [];
  let cursorSec = 0;

  cursorSec = appendSegment(segments, {
    segmentId: "progressive-warmup",
    name: "warmup",
    startSec: cursorSec,
    durationSec: minutesToSeconds(warmupMin),
    targetCadence: startBpm,
    targetEnergyRange: { min: 25, max: 50 },
    maxStretchPercent,
  });

  cursorSec = appendCadenceSteps(segments, {
    segmentId: "progressive-build",
    name: "tempo",
    startSec: cursorSec,
    durationSec: minutesToSeconds(buildMin),
    startBpm,
    endBpm: peakBpm,
    targetEnergyRange: { min: 45, max: 80 },
    maxStretchPercent,
  });

  cursorSec = appendSegment(segments, {
    segmentId: "progressive-peak",
    name: "finish",
    startSec: cursorSec,
    durationSec: minutesToSeconds(holdMin),
    targetCadence: peakBpm,
    targetEnergyRange: { min: 60, max: 90 },
    maxStretchPercent,
  });

  cursorSec = appendCadenceSteps(segments, {
    segmentId: "progressive-cooldown",
    name: "cooldown",
    startSec: cursorSec,
    durationSec: minutesToSeconds(cooldownMin),
    startBpm: peakBpm,
    endBpm,
    targetEnergyRange: { min: 20, max: 50 },
    maxStretchPercent,
  });

  return {
    planId: createPlanId("progressive", [
      warmupMin,
      buildMin,
      holdMin,
      cooldownMin,
      startBpm,
      peakBpm,
      endBpm,
      maxStretchPercent,
    ]),
    title: `Manual progressive ${startBpm}-${peakBpm}-${endBpm} BPM - ${formatMinutes(
      cursorSec / SECONDS_PER_MINUTE,
    )}`,
    totalDurationSec: cursorSec,
    segments,
  };
}

function buildIntervalPlan(settings: RunningPlanSettings): RunningPlan {
  const warmupMin = sanitizeMinutes(settings.interval.warmupMin, 5, 0, 60);
  const fastMin = sanitizeMinutes(settings.interval.fastMin, 2, 0.5, 60);
  const slowMin = sanitizeMinutes(settings.interval.slowMin, 2, 0.5, 60);
  const repeats = sanitizeRepeats(settings.interval.repeats, 6);
  const cooldownMin = sanitizeMinutes(settings.interval.cooldownMin, 5, 0, 60);
  const fastBpm = sanitizeBpm(settings.interval.fastBpm, 175);
  const slowBpm = sanitizeBpm(settings.interval.slowBpm, 140);
  const maxStretchPercent = sanitizeMaxStretchPercent(settings.maxStretchPercent);
  const segments: RunSegment[] = [];
  let cursorSec = 0;

  cursorSec = appendSegment(segments, {
    segmentId: "interval-warmup",
    name: "warmup",
    startSec: cursorSec,
    durationSec: minutesToSeconds(warmupMin),
    targetCadence: slowBpm,
    targetEnergyRange: { min: 25, max: 50 },
    maxStretchPercent,
  });

  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    cursorSec = appendSegment(segments, {
      segmentId: `interval-${repeat}-fast`,
      name: "tempo",
      startSec: cursorSec,
      durationSec: minutesToSeconds(fastMin),
      targetCadence: fastBpm,
      targetEnergyRange: { min: 60, max: 90 },
      maxStretchPercent,
    });

    cursorSec = appendSegment(segments, {
      segmentId: `interval-${repeat}-slow`,
      name: "recovery",
      startSec: cursorSec,
      durationSec: minutesToSeconds(slowMin),
      targetCadence: slowBpm,
      targetEnergyRange: { min: 25, max: 55 },
      maxStretchPercent,
    });
  }

  cursorSec = appendSegment(segments, {
    segmentId: "interval-cooldown",
    name: "cooldown",
    startSec: cursorSec,
    durationSec: minutesToSeconds(cooldownMin),
    targetCadence: slowBpm,
    targetEnergyRange: { min: 20, max: 50 },
    maxStretchPercent,
  });

  return {
    planId: createPlanId("interval", [
      warmupMin,
      fastMin,
      slowMin,
      repeats,
      cooldownMin,
      fastBpm,
      slowBpm,
      maxStretchPercent,
    ]),
    title: `Manual intervals ${fastMin}:${slowMin} x ${repeats} - ${formatMinutes(
      cursorSec / SECONDS_PER_MINUTE,
    )}`,
    totalDurationSec: cursorSec,
    segments,
  };
}

function appendSegment(
  segments: RunSegment[],
  args: {
    segmentId: string;
    name: RunSegmentName;
    startSec: number;
    durationSec: number;
    targetCadence: number;
    cadenceRamp?: CadenceRamp;
    targetEnergyRange: { min: number; max: number };
    maxStretchPercent: number;
  },
): number {
  if (args.durationSec <= 0) {
    return args.startSec;
  }

  const endSec = args.startSec + args.durationSec;
  segments.push(
    createSegment({
      ...args,
      endSec,
    }),
  );

  return endSec;
}

function appendCadenceSteps(
  segments: RunSegment[],
  args: {
    segmentId: string;
    name: RunSegmentName;
    startSec: number;
    durationSec: number;
    startBpm: number;
    endBpm: number;
    targetEnergyRange: { min: number; max: number };
    maxStretchPercent: number;
  },
): number {
  if (args.durationSec <= 0) {
    return args.startSec;
  }

  const cadenceDifference = args.endBpm - args.startBpm;
  const stepCount = Math.max(
    1,
    Math.ceil(Math.abs(cadenceDifference) / PROGRESSIVE_CADENCE_STEP_BPM),
  );
  const segmentCount = stepCount + 1;
  let cursorSec = args.startSec;

  for (let index = 0; index < segmentCount; index += 1) {
    const isLast = index === segmentCount - 1;
    const targetEndSec = isLast
      ? args.startSec + args.durationSec
      : args.startSec + Math.round((args.durationSec * (index + 1)) / segmentCount);
    const progress = stepCount === 0 ? 0 : index / stepCount;
    const targetCadence = roundCadence(
      args.startBpm + cadenceDifference * progress,
    );

    cursorSec = appendSegment(segments, {
      segmentId: `${args.segmentId}-${index + 1}`,
      name: args.name,
      startSec: cursorSec,
      durationSec: Math.max(1, targetEndSec - cursorSec),
      targetCadence,
      targetEnergyRange: args.targetEnergyRange,
      maxStretchPercent: args.maxStretchPercent,
    });
  }

  return args.startSec + args.durationSec;
}

function createSegment(args: {
  segmentId: string;
  name: RunSegmentName;
  startSec: number;
  endSec: number;
  targetCadence: number;
  cadenceRamp?: CadenceRamp;
  targetEnergyRange: { min: number; max: number };
  maxStretchPercent: number;
}): RunSegment {
  return {
    segmentId: args.segmentId,
    name: args.name,
    startSec: args.startSec,
    endSec: args.endSec,
    targetCadence: roundCadence(args.targetCadence),
    cadenceRamp: args.cadenceRamp
      ? {
          start: roundCadence(args.cadenceRamp.start),
          end: roundCadence(args.cadenceRamp.end),
          interpolation: args.cadenceRamp.interpolation,
        }
      : undefined,
    targetEnergyRange: args.targetEnergyRange,
    maxStretchPercent: sanitizeMaxStretchPercent(args.maxStretchPercent),
  };
}

function sanitizeBpm(value: number, fallback: number): number {
  return roundCadence(clampNumber(value, MIN_RUNNING_BPM, MAX_RUNNING_BPM, fallback));
}

function sanitizeMinutes(
  value: number,
  fallback: number,
  min: number,
  max: number,
): number {
  return roundNumber(clampNumber(value, min, max, fallback), 1);
}

function sanitizeRepeats(value: number, fallback: number): number {
  return Math.round(clampNumber(value, 1, 30, fallback));
}

function sanitizeMaxStretchPercent(value: number): number {
  return roundNumber(
    clampNumber(value, 0, 30, DEFAULT_MAX_STRETCH_PERCENT),
    1,
  );
}

function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, value));
}

function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * SECONDS_PER_MINUTE);
}

function roundCadence(value: number): number {
  return roundNumber(value, 1);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function createPlanId(mode: RunningPlanMode, values: number[]): string {
  return `manual_${mode}_${values.map(formatIdToken).join("_")}`;
}

function formatIdToken(value: number): string {
  return String(value).replace(".", "p");
}

function formatMinutes(minutes: number): string {
  return `${roundNumber(minutes, 1)} min`;
}
