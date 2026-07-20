import type { SingleTrackBpmAnalysis } from "./singleTrackBpmTypes";

export type BpmCandidateSource = "essentia" | "tempocnn" | "fallback";
export type ClickTempoRelation = "1:1" | "3:2" | "2:1" | "3:1";

export type BpmCandidate = {
  value: number;
  relation: "1:2" | "2:3" | "1:1" | "3:2" | "2:1";
  source?: BpmCandidateSource;
  recommended?: boolean;
};

export type TempoDetectorOption = {
  source: BpmCandidateSource;
  bpm: number;
  comparisonScore: number | null;
  recommended: boolean;
};

export type ClickTempoOption = {
  relation: ClickTempoRelation;
  multiplier: number;
  bpm: number;
  advanced: boolean;
  recommended: boolean;
};

export type RecommendedClickSetup = {
  source: BpmCandidateSource;
  baseBpm: number;
  relation: ClickTempoRelation;
  clickBpm: number;
  score: number;
};

export type SingleTrackBpmDecision = {
  detectors: TempoDetectorOption[];
  recommendedDetector: BpmCandidateSource | null;
};

export type DetectorComparisonScores = {
  essentia: number;
  tempocnn: number;
};

const BPM_CANDIDATE_MULTIPLIERS: Array<{
  multiplier: number;
  relation: BpmCandidate["relation"];
}> = [
  { multiplier: 1 / 2, relation: "1:2" },
  { multiplier: 2 / 3, relation: "2:3" },
  { multiplier: 1, relation: "1:1" },
  { multiplier: 3 / 2, relation: "3:2" },
  { multiplier: 2, relation: "2:1" },
];

const CLICK_TEMPO_MULTIPLIERS: Array<{
  multiplier: number;
  relation: ClickTempoRelation;
  advanced: boolean;
}> = [
  { multiplier: 1, relation: "1:1", advanced: false },
  { multiplier: 2, relation: "2:1", advanced: false },
  { multiplier: 3, relation: "3:1", advanced: false },
  { multiplier: 3 / 2, relation: "3:2", advanced: true },
];

const MIN_CLICK_BPM = 40;
const MAX_CLICK_BPM = 720;

const SINGLE_TRACK_MULTIPLIERS: Array<{
  multiplier: number;
  relation: BpmCandidate["relation"];
}> = [
  { multiplier: 1 / 2, relation: "1:2" },
  { multiplier: 1, relation: "1:1" },
  { multiplier: 2, relation: "2:1" },
];

export function normalizeBpm(value: number): number {
  return Math.round(value * 10) / 10;
}

export function getBpmCandidates(bpm: number | null): BpmCandidate[] {
  return buildBpmCandidates(bpm, BPM_CANDIDATE_MULTIPLIERS);
}

export function getSingleTrackBpmCandidates(bpm: number | null): BpmCandidate[] {
  return buildBpmCandidates(bpm, SINGLE_TRACK_MULTIPLIERS);
}

export function getSingleTrackBpmDecision(
  analysis: SingleTrackBpmAnalysis | null,
): SingleTrackBpmDecision {
  if (!analysis?.bpm) {
    return { detectors: [], recommendedDetector: null };
  }

  if (analysis.method === "fallback_autocorrelation") {
    return {
      detectors: [
        {
          source: "fallback",
          bpm: normalizeBpm(analysis.bpm),
          comparisonScore: null,
          recommended: true,
        },
      ],
      recommendedDetector: "fallback",
    };
  }

  const scores = getDetectorComparisonScores(analysis);
  const detectors: TempoDetectorOption[] = [];

  if (analysis.method !== "tempocnn") {
    detectors.push({
      source: "essentia",
      bpm: normalizeBpm(analysis.bpm),
      comparisonScore: scores.essentia,
      recommended: false,
    });
  }

  if (analysis.tempoCnn) {
    detectors.push({
      source: "tempocnn",
      bpm: normalizeBpm(analysis.tempoCnn.bpm),
      comparisonScore: scores.tempocnn,
      recommended: false,
    });
  }

  const recommendedDetector = detectors.reduce<TempoDetectorOption | null>(
    (best, detector) =>
      !best || (detector.comparisonScore ?? 0) > (best.comparisonScore ?? 0)
        ? detector
        : best,
    null,
  )?.source ?? null;

  return {
    detectors: detectors.map((detector) => ({
      ...detector,
      recommended: detector.source === recommendedDetector,
    })),
    recommendedDetector,
  };
}

export function getClickTempoOptions(
  baseBpm: number | null,
  targetBpm: number,
): ClickTempoOption[] {
  if (!baseBpm || !Number.isFinite(baseBpm)) {
    return [];
  }

  const options = CLICK_TEMPO_MULTIPLIERS.map(({
    multiplier,
    relation,
    advanced,
  }) => ({
    relation,
    multiplier,
    bpm: normalizeBpm(baseBpm * multiplier),
    advanced,
    recommended: false,
  })).filter(
    (option) => option.bpm >= MIN_CLICK_BPM && option.bpm <= MAX_CLICK_BPM,
  );
  const recommended = options.reduce<ClickTempoOption | null>(
    (closest, option) =>
      !closest || Math.abs(option.bpm - targetBpm) < Math.abs(closest.bpm - targetBpm)
        ? option
        : closest,
    null,
  );

  return options.map((option) => ({
    ...option,
    recommended: option.relation === recommended?.relation,
  }));
}

export function getRecommendedClickSetup(
  detectors: TempoDetectorOption[],
  targetBpm: number,
): RecommendedClickSetup | null {
  const detector = detectors.reduce<TempoDetectorOption | null>(
    (best, option) => {
      if (!best) {
        return option;
      }

      const bestScore = best.comparisonScore ?? 0.65;
      const optionScore = option.comparisonScore ?? 0.65;
      if (optionScore === bestScore) {
        return option.recommended && !best.recommended ? option : best;
      }

      return optionScore > bestScore ? option : best;
    },
    null,
  );
  if (!detector) {
    return null;
  }

  const options = getClickTempoOptions(detector.bpm, targetBpm);
  const option = options.find((candidate) => candidate.recommended) ?? options[0];
  if (!option) {
    return null;
  }

  return {
    source: detector.source,
    baseBpm: detector.bpm,
    relation: option.relation,
    clickBpm: option.bpm,
    score: detector.comparisonScore ?? 0.65,
  };
}

export function getClickTempoBpm(
  baseBpm: number | null,
  relation: ClickTempoRelation,
): number | null {
  const option = CLICK_TEMPO_MULTIPLIERS.find(
    (candidate) => candidate.relation === relation,
  );
  if (!baseBpm || !option) {
    return null;
  }

  const bpm = normalizeBpm(baseBpm * option.multiplier);
  return bpm >= MIN_CLICK_BPM && bpm <= MAX_CLICK_BPM ? bpm : null;
}

function buildBpmCandidates(
  bpm: number | null,
  multipliers: typeof BPM_CANDIDATE_MULTIPLIERS,
): BpmCandidate[] {
  if (!bpm || !Number.isFinite(bpm)) {
    return [];
  }

  const candidates = multipliers.map(({ multiplier, relation }) => ({
    value: normalizeBpm(bpm * multiplier),
    relation,
  })).filter((candidate) => candidate.value >= 40 && candidate.value <= 240);

  const uniqueCandidates = new Map<number, BpmCandidate>();

  for (const candidate of candidates) {
    if (!uniqueCandidates.has(candidate.value)) {
      uniqueCandidates.set(candidate.value, candidate);
    }
  }

  return Array.from(uniqueCandidates.values()).sort((a, b) => a.value - b.value);
}

export function getClosestBpm(value: number, options: BpmCandidate[]): number | null {
  if (options.length === 0) {
    return null;
  }

  return options.reduce((closest, option) =>
    Math.abs(option.value - value) < Math.abs(closest.value - value)
      ? option
      : closest,
  ).value;
}

export function getDetectorComparisonScores(
  analysis: SingleTrackBpmAnalysis,
): DetectorComparisonScores {
  const confidenceScore = Math.min(1, Math.max(0, (analysis.confidence ?? 0) / 3.5));
  const essentiaConsistency =
    analysis.windowAgreement ?? analysis.tempoStability ?? 0;
  const essentiaScore =
    confidenceScore * 0.65 + essentiaConsistency * 0.35;
  const cnn = analysis.tempoCnn;
  const evidenceMultiplier = cnn && cnn.localEstimateCount >= 2 ? 1 : 0.7;
  const tempoCnnScore = cnn
    ? (cnn.probability * 0.65 + cnn.stability * 0.35) * evidenceMultiplier
    : 0;

  return {
    essentia: Math.min(1, Math.max(0, essentiaScore)),
    tempocnn: Math.min(1, Math.max(0, tempoCnnScore)),
  };
}
