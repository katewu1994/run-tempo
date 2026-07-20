import type { RunningPlan } from "./mixTypes";

const DEFAULT_MAX_STRETCH_PERCENT = 10;

export const RUNNING_PLAN_PRESETS: RunningPlan[] = [
  {
    planId: "fixed_180_9min",
    title: "Fixed 180 cadence - 9 min",
    totalDurationSec: 9 * 60,
    segments: [
      {
        segmentId: "fixed-180",
        name: "steady",
        startSec: 0,
        endSec: 9 * 60,
        targetCadence: 180,
        targetEnergyRange: { min: 40, max: 70 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
    ],
  },
  {
    planId: "cadence_drill_9min",
    title: "Cadence drill - 9 min",
    totalDurationSec: 9 * 60,
    segments: [
      {
        segmentId: "drill-warmup",
        name: "warmup",
        startSec: 0,
        endSec: 3 * 60,
        targetCadence: 180,
        targetEnergyRange: { min: 40, max: 65 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
      {
        segmentId: "drill-tempo",
        name: "tempo",
        startSec: 3 * 60,
        endSec: 6 * 60,
        targetCadence: 185,
        targetEnergyRange: { min: 55, max: 85 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
      {
        segmentId: "drill-cooldown",
        name: "steady",
        startSec: 6 * 60,
        endSec: 9 * 60,
        targetCadence: 180,
        targetEnergyRange: { min: 40, max: 70 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
    ],
  },
  {
    planId: "easy_15min",
    title: "Easy run - 15 min",
    totalDurationSec: 15 * 60,
    segments: [
      {
        segmentId: "easy-warmup",
        name: "warmup",
        startSec: 0,
        endSec: 5 * 60,
        targetCadence: 175,
        targetEnergyRange: { min: 20, max: 45 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
      {
        segmentId: "easy-steady",
        name: "steady",
        startSec: 5 * 60,
        endSec: 12 * 60,
        targetCadence: 180,
        targetEnergyRange: { min: 40, max: 70 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
      {
        segmentId: "easy-cooldown",
        name: "cooldown",
        startSec: 12 * 60,
        endSec: 15 * 60,
        targetCadence: 175,
        targetEnergyRange: { min: 20, max: 50 },
        maxStretchPercent: DEFAULT_MAX_STRETCH_PERCENT,
      },
    ],
  },
];
