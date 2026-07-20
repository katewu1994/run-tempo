import { z } from "zod";

const finiteNumber = z.number().finite();

export const BpmInterpretationSchema = z.enum([
  "1:2",
  "2:3",
  "1:1",
  "3:2",
  "2:1",
]);

export const BpmCandidateSchema = z.object({
  bpm: finiteNumber.positive(),
  interpretation: BpmInterpretationSchema,
});

export const RawEnergyFeaturesSchema = z.object({
  rms: finiteNumber.nonnegative(),
  onsetDensity: finiteNumber.nonnegative(),
  spectralCentroid: finiteNumber.nonnegative(),
});

export const TrackFeatureSchema = z.object({
  trackId: z.string().min(1),
  fileName: z.string().min(1),
  durationSec: finiteNumber.positive(),
  detectedBpm: finiteNumber.positive().nullable(),
  bpmCandidates: z.array(BpmCandidateSchema),
  beatConfidence: finiteNumber.min(0).max(1).nullable(),
  tempoStability: finiteNumber.min(0).max(1).nullable(),
  rawEnergyFeatures: RawEnergyFeaturesSchema.nullable(),
  normalizedEnergyScore: finiteNumber.min(0).max(100).nullable(),
});

export const RunSegmentNameSchema = z.enum([
  "warmup",
  "steady",
  "tempo",
  "recovery",
  "finish",
  "cooldown",
  "custom",
]);

export const CadenceRampSchema = z.object({
  start: finiteNumber.positive(),
  end: finiteNumber.positive(),
  interpolation: z.literal("linear"),
});

export const RunSegmentSchema = z
  .object({
    segmentId: z.string().min(1),
    name: RunSegmentNameSchema,
    startSec: finiteNumber.nonnegative(),
    endSec: finiteNumber.positive(),
    targetCadence: finiteNumber.positive(),
    cadenceRamp: CadenceRampSchema.optional(),
    targetEnergyRange: z.object({
      min: finiteNumber.min(0).max(100),
      max: finiteNumber.min(0).max(100),
    }),
    maxStretchPercent: finiteNumber.nonnegative(),
  })
  .refine((segment) => segment.endSec > segment.startSec, {
    message: "endSec must be greater than startSec",
    path: ["endSec"],
  })
  .refine(
    (segment) => segment.targetEnergyRange.max >= segment.targetEnergyRange.min,
    {
      message: "targetEnergyRange.max must be greater than or equal to min",
      path: ["targetEnergyRange"],
    },
  );

export const RunningPlanSchema = z.object({
  planId: z.string().min(1),
  title: z.string().min(1),
  totalDurationSec: finiteNumber.positive(),
  segments: z.array(RunSegmentSchema).min(1),
});

export const CandidateScoreSchema = z.object({
  segmentId: z.string().min(1),
  trackId: z.string().min(1),
  bestCandidateBpm: finiteNumber.positive(),
  interpretation: BpmInterpretationSchema,
  cadenceFitScore: finiteNumber.min(0).max(100),
  energyFitScore: finiteNumber.min(0).max(100),
  stabilityScore: finiteNumber.min(0).max(100),
  stretchRiskScore: finiteNumber.min(0).max(100),
  totalScore: finiteNumber.min(0).max(100),
  requiredStretchPercent: finiteNumber.nonnegative(),
});

export const PlannerInputSchema = z.object({
  runningPlan: RunningPlanSchema,
  tracks: z.array(TrackFeatureSchema).min(1),
  topCandidatesBySegment: z.array(
    z.object({
      segmentId: z.string().min(1),
      topCandidates: z.array(CandidateScoreSchema),
    }),
  ),
  rules: z.object({
    allowTrackReuse: z.boolean(),
    allowLoop: z.boolean(),
    maxTracksPerSegment: z.number().int().min(1).max(10),
    preferStableCadenceGrid: z.boolean(),
  }),
});

export const MetronomeClickStyleSchema = z.enum([
  "soft_hihat",
  "wood_block",
  "sharp_beep",
  "low_tick",
]);

export const MetronomePreferenceSchema = z.object({
  clickStyle: MetronomeClickStyleSchema,
  clickVolume: finiteNumber.min(0.1).max(1),
  accentEvery: z.union([
    z.literal(0),
    z.literal(2),
    z.literal(4),
    z.literal(8),
  ]),
});

export const OpenAISelectionPlanSchema = z.object({
  mixTitle: z.string().min(1),
  segmentPlans: z.array(
    z.object({
      segmentId: z.string().min(1),
      rankedTrackSelections: z.array(
        z.object({
          trackId: z.string().min(1),
          selectedBpmInterpretation: BpmInterpretationSchema,
          metronomePreference: MetronomePreferenceSchema,
          reason: z.string().min(1),
        }),
      ),
    }),
  ),
});

export type BpmInterpretation = z.infer<typeof BpmInterpretationSchema>;
export type BpmCandidate = z.infer<typeof BpmCandidateSchema>;
export type TrackFeature = z.infer<typeof TrackFeatureSchema>;
export type RunSegment = z.infer<typeof RunSegmentSchema>;
export type RunningPlan = z.infer<typeof RunningPlanSchema>;
export type CandidateScore = z.infer<typeof CandidateScoreSchema>;
export type PlannerInput = z.infer<typeof PlannerInputSchema>;
export type OpenAISelectionPlan = z.infer<typeof OpenAISelectionPlanSchema>;
export type MetronomeClickStyle = z.infer<typeof MetronomeClickStyleSchema>;
