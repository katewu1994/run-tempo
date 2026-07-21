import { ZodError } from "zod";
import {
  BpmInterpretationSchema,
  OpenAISelectionPlanSchema,
  PlannerInputSchema,
  type CandidateScore,
  type OpenAISelectionPlan,
  type PlannerInput,
  type RunSegment,
} from "./schemas.js";

type SegmentPlan = OpenAISelectionPlan["segmentPlans"][number];
type TrackSelection = SegmentPlan["rankedTrackSelections"][number];

const MIN_REQUIRED_CLICK_VOLUME = 0.1;
const REQUIRED_CLICK_STYLE: TrackSelection["metronomePreference"]["clickStyle"] =
  "sharp_beep";
const REQUIRED_ACCENT_EVERY: TrackSelection["metronomePreference"]["accentEvery"] = 4;

export class PlannerOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerOutputValidationError";
  }
}

export function parsePlannerInput(raw: unknown): PlannerInput {
  return PlannerInputSchema.parse(raw);
}

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "request";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function repairAndValidateOpenAISelectionPlan(
  raw: unknown,
  input: PlannerInput,
): OpenAISelectionPlan {
  if (!isRecord(raw)) {
    throw new PlannerOutputValidationError(
      "OpenAI did not return a JSON object.",
    );
  }

  const normalized = normalizeOpenAIPlan(raw, input);
  const repaired = repairPlanAgainstInput(normalized, input);
  const parsed = OpenAISelectionPlanSchema.safeParse(repaired);

  if (!parsed.success) {
    throw new PlannerOutputValidationError(
      `OpenAI output failed validation after repair: ${formatZodError(parsed.error)}`,
    );
  }

  return parsed.data;
}

function normalizeOpenAIPlan(
  raw: Record<string, unknown>,
  input: PlannerInput,
): OpenAISelectionPlan {
  const segmentPlans = Array.isArray(raw.segmentPlans)
    ? raw.segmentPlans.flatMap((segmentPlan) =>
        normalizeSegmentPlan(segmentPlan, input),
      )
    : [];

  return {
    mixTitle: normalizeText(raw.mixTitle, `${input.runningPlan.title} Run Tempo mix`),
    segmentPlans,
  };
}

function normalizeSegmentPlan(
  raw: unknown,
  input: PlannerInput,
): SegmentPlan[] {
  if (!isRecord(raw)) {
    return [];
  }

  const segmentId = normalizeText(raw.segmentId, "");

  if (segmentId.length === 0) {
    return [];
  }

  const rankedTrackSelections = Array.isArray(raw.rankedTrackSelections)
    ? raw.rankedTrackSelections.flatMap((selection) =>
        normalizeSelection(selection, segmentId, input),
      )
    : [];

  return [
    {
      segmentId,
      rankedTrackSelections,
    },
  ];
}

function normalizeSelection(
  raw: unknown,
  segmentId: string,
  input: PlannerInput,
): TrackSelection[] {
  if (!isRecord(raw)) {
    return [];
  }

  const trackId = normalizeText(raw.trackId, "");

  if (trackId.length === 0) {
    return [];
  }

  const matchingCandidate = findCandidate(input, segmentId, trackId);
  const parsedInterpretation = BpmInterpretationSchema.safeParse(
    raw.selectedBpmInterpretation,
  );
  const selectedBpmInterpretation =
    matchingCandidate?.interpretation ??
    (parsedInterpretation.success ? parsedInterpretation.data : "1:1");

  return [
    {
      trackId,
      selectedBpmInterpretation,
      metronomePreference: normalizeMetronomePreference(raw.metronomePreference),
      reason: normalizeText(
        raw.reason,
        matchingCandidate
          ? getCandidateReason(matchingCandidate)
          : "Selected by the OpenAI planner.",
      ),
    },
  ];
}

function repairPlanAgainstInput(
  plan: OpenAISelectionPlan,
  input: PlannerInput,
): OpenAISelectionPlan {
  const rawPlansBySegmentId = new Map<string, SegmentPlan>();

  for (const segmentPlan of plan.segmentPlans) {
    if (!rawPlansBySegmentId.has(segmentPlan.segmentId)) {
      rawPlansBySegmentId.set(segmentPlan.segmentId, segmentPlan);
    }
  }

  const usedTrackIds = new Set<string>();
  const segmentPlans = input.runningPlan.segments.map((segment) => {
    const rawPlan = rawPlansBySegmentId.get(segment.segmentId);
    const repairedSelections = repairSelectionsForSegment({
      segment,
      rawSelections: rawPlan?.rankedTrackSelections ?? [],
      input,
      usedTrackIds,
    });

    return {
      segmentId: segment.segmentId,
      rankedTrackSelections: repairedSelections,
    };
  });

  return {
    mixTitle: plan.mixTitle,
    segmentPlans,
  };
}

function repairSelectionsForSegment({
  segment,
  rawSelections,
  input,
  usedTrackIds,
}: {
  segment: RunSegment;
  rawSelections: TrackSelection[];
  input: PlannerInput;
  usedTrackIds: Set<string>;
}): TrackSelection[] {
  const maxSelections = input.rules.maxTracksPerSegment;
  const candidatePool = getTopCandidates(input, segment.segmentId);
  const candidatesByTrackId = new Map(
    candidatePool.map((candidate) => [candidate.trackId, candidate]),
  );
  const selectedTrackIdsInSegment = new Set<string>();
  const selections: TrackSelection[] = [];

  for (const selection of rawSelections) {
    const candidate = candidatesByTrackId.get(selection.trackId);

    if (!candidate) {
      continue;
    }

    if (selectedTrackIdsInSegment.has(candidate.trackId)) {
      continue;
    }

    if (!input.rules.allowTrackReuse && usedTrackIds.has(candidate.trackId)) {
      continue;
    }

    selections.push({
      ...selection,
      trackId: candidate.trackId,
      selectedBpmInterpretation: candidate.interpretation,
      metronomePreference: {
        ...getDefaultMetronomePreference(segment),
        ...selection.metronomePreference,
      },
      reason: normalizeText(selection.reason, getCandidateReason(candidate)),
    });
    selectedTrackIdsInSegment.add(candidate.trackId);
    usedTrackIds.add(candidate.trackId);

    if (selections.length >= maxSelections) {
      return selections;
    }
  }

  for (const candidate of candidatePool) {
    if (selectedTrackIdsInSegment.has(candidate.trackId)) {
      continue;
    }

    if (!input.rules.allowTrackReuse && usedTrackIds.has(candidate.trackId)) {
      continue;
    }

    selections.push({
      trackId: candidate.trackId,
      selectedBpmInterpretation: candidate.interpretation,
      metronomePreference: getDefaultMetronomePreference(segment),
      reason: getCandidateReason(candidate),
    });
    selectedTrackIdsInSegment.add(candidate.trackId);
    usedTrackIds.add(candidate.trackId);

    if (selections.length >= maxSelections) {
      break;
    }
  }

  return selections;
}

function normalizeMetronomePreference(raw: unknown): TrackSelection["metronomePreference"] {
  if (!isRecord(raw)) {
    return {
      clickStyle: REQUIRED_CLICK_STYLE,
      clickVolume: 0.32,
      accentEvery: REQUIRED_ACCENT_EVERY,
    };
  }

  const clickVolume =
    typeof raw.clickVolume === "number" && Number.isFinite(raw.clickVolume)
      ? clamp(raw.clickVolume, MIN_REQUIRED_CLICK_VOLUME, 1)
      : 0.32;

  return {
    clickStyle: REQUIRED_CLICK_STYLE,
    clickVolume,
    accentEvery: REQUIRED_ACCENT_EVERY,
  };
}

function getDefaultMetronomePreference(
  segment: RunSegment,
): TrackSelection["metronomePreference"] {
  return {
    clickStyle: REQUIRED_CLICK_STYLE,
    clickVolume: getSegmentClickVolume(segment),
    accentEvery: REQUIRED_ACCENT_EVERY,
  };
}

function getSegmentClickVolume(segment: RunSegment): number {
  if (
    segment.name === "warmup" ||
    segment.name === "recovery" ||
    segment.name === "cooldown"
  ) {
    return 0.25;
  }

  if (segment.name === "tempo" || segment.name === "finish") {
    return 0.38;
  }

  return 0.32;
}

function getTopCandidates(
  input: PlannerInput,
  segmentId: string,
): CandidateScore[] {
  return (
    input.topCandidatesBySegment.find((group) => group.segmentId === segmentId)
      ?.topCandidates ?? []
  ).sort((a, b) => b.totalScore - a.totalScore);
}

function findCandidate(
  input: PlannerInput,
  segmentId: string,
  trackId: string,
): CandidateScore | null {
  return (
    getTopCandidates(input, segmentId).find(
      (candidate) => candidate.trackId === trackId,
    ) ?? null
  );
}

function getCandidateReason(candidate: CandidateScore): string {
  return [
    `total ${formatScore(candidate.totalScore)}`,
    `BPM fit ${formatScore(candidate.cadenceFitScore)} at ${candidate.bestCandidateBpm.toFixed(1)} BPM`,
    `energy fit ${formatScore(candidate.energyFitScore)}`,
    `structure fit ${formatScore(candidate.structureFitScore)}`,
    `mood fit ${formatScore(candidate.moodFitScore)}`,
    `stretch ${candidate.requiredStretchPercent.toFixed(1)}%`,
  ].join("; ");
}

function formatScore(value: number): string {
  return Math.round(value).toString();
}

function normalizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 500) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
