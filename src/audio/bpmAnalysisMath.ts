import type {
  SingleTrackBpmAnalysis,
  TempoCnnEstimate,
  TempoCnnLocalEstimate,
  TempoConfidenceLevel,
  TempoWindowEstimate,
} from "./singleTrackBpmTypes";

const MIN_BPM = 40;
const MAX_BPM = 240;
const TEMPO_MATCH_TOLERANCE = 0.03;
const MIN_RELIABLE_STABILITY = 0.6;

export function getTempoConfidenceLevel(
  confidence: number | null,
): TempoConfidenceLevel {
  if (confidence === null || !Number.isFinite(confidence)) {
    return "unavailable";
  }

  if (confidence < 1) {
    return "very_low";
  }

  if (confidence <= 1.5) {
    return "low";
  }

  if (confidence <= 3.5) {
    return "good";
  }

  return "excellent";
}

export function calculateIntervalStability(intervals: number[]): number | null {
  const validIntervals = intervals.filter(
    (interval) => Number.isFinite(interval) && interval > 0,
  );

  if (validIntervals.length < 4) {
    return null;
  }

  const center = median(validIntervals);
  if (center <= 0) {
    return null;
  }

  const deviations = validIntervals.map((interval) => Math.abs(interval - center));
  const relativeMedianDeviation = median(deviations) / center;

  return clamp(1 - relativeMedianDeviation / 0.08, 0, 1);
}

export function buildEssentiaConsensus(
  estimates: TempoWindowEstimate[],
): SingleTrackBpmAnalysis | null {
  const validEstimates = estimates.filter(
    (estimate) =>
      Number.isFinite(estimate.bpm) &&
      estimate.bpm >= MIN_BPM &&
      estimate.bpm <= MAX_BPM &&
      Number.isFinite(estimate.confidence) &&
      estimate.confidence >= 0,
  );

  if (validEstimates.length === 0) {
    return null;
  }

  const reference = validEstimates.reduce((best, current) =>
    current.confidence > best.confidence ? current : best,
  ).bpm;
  const normalized = validEstimates.map((estimate) => ({
    ...estimate,
    bpm: normalizeOctaveToReference(estimate.bpm, reference),
    weight: Math.max(0.1, estimate.confidence),
  }));
  const bpm = weightedMedian(
    normalized.map((estimate) => ({ value: estimate.bpm, weight: estimate.weight })),
  );
  const matching = normalized.filter(
    (estimate) => relativeDifference(estimate.bpm, bpm) <= TEMPO_MATCH_TOLERANCE,
  );
  const totalWeight = normalized.reduce((sum, estimate) => sum + estimate.weight, 0);
  const matchingWeight = matching.reduce((sum, estimate) => sum + estimate.weight, 0);
  const windowAgreement = totalWeight > 0 ? matchingWeight / totalWeight : 0;
  const rawConfidence = weightedAverage(
    normalized.map((estimate) => ({
      value: estimate.confidence,
      weight: estimate.weight,
    })),
  );
  const confidence = rawConfidence * (0.55 + windowAgreement * 0.45);
  const intervalStabilities = matching
    .filter(
      (estimate): estimate is typeof estimate & { intervalStability: number } =>
        estimate.intervalStability !== null,
    )
    .map((estimate) => ({
      value: estimate.intervalStability,
      weight: estimate.weight,
    }));
  const intervalStability =
    intervalStabilities.length > 0 ? weightedAverage(intervalStabilities) : null;
  const tempoStability =
    intervalStability === null
      ? windowAgreement
      : intervalStability * 0.65 + windowAgreement * 0.35;
  const confidenceLevel = getTempoConfidenceLevel(confidence);
  const isReliable =
    (confidenceLevel === "good" || confidenceLevel === "excellent") &&
    tempoStability >= MIN_RELIABLE_STABILITY &&
    windowAgreement >= 0.66;

  return {
    bpm: roundBpm(bpm),
    confidence: roundTo(confidence, 2),
    confidenceLevel,
    tempoStability: roundTo(tempoStability, 3),
    windowAgreement: roundTo(windowAgreement, 3),
    analyzedWindowCount: validEstimates.length,
    method: "essentia_multifeature",
    tempoCnn: null,
    detectorAgreement: null,
    isReliable,
  };
}

export function buildTempoCnnEstimate(
  localEstimates: TempoCnnLocalEstimate[],
): TempoCnnEstimate | null {
  const validEstimates = localEstimates.filter(
    (estimate) =>
      Number.isFinite(estimate.bpm) &&
      estimate.bpm >= MIN_BPM &&
      estimate.bpm <= MAX_BPM &&
      Number.isFinite(estimate.probability) &&
      estimate.probability >= 0 &&
      estimate.probability <= 1,
  );

  if (validEstimates.length === 0) {
    return null;
  }

  const reference = validEstimates.reduce((best, current) =>
    current.probability > best.probability ? current : best,
  ).bpm;
  const normalized = validEstimates.map((estimate) => ({
    bpm: normalizeOctaveToReference(estimate.bpm, reference),
    probability: estimate.probability,
    weight: Math.max(0.05, estimate.probability),
  }));
  const bpm = weightedMedian(
    normalized.map((estimate) => ({ value: estimate.bpm, weight: estimate.weight })),
  );
  const matching = normalized.filter(
    (estimate) => relativeDifference(estimate.bpm, bpm) <= TEMPO_MATCH_TOLERANCE,
  );
  const totalWeight = normalized.reduce((sum, estimate) => sum + estimate.weight, 0);
  const matchingWeight = matching.reduce((sum, estimate) => sum + estimate.weight, 0);
  const stability = totalWeight > 0 ? matchingWeight / totalWeight : 0;
  const probability = weightedAverage(
    matching.map((estimate) => ({
      value: estimate.probability,
      weight: estimate.weight,
    })),
  );

  return {
    bpm: roundBpm(bpm),
    probability: roundTo(probability, 3),
    stability: roundTo(stability, 3),
    localEstimateCount: validEstimates.length,
  };
}

export function mergeTempoAnalyses(
  primary: SingleTrackBpmAnalysis | null,
  tempoCnn: TempoCnnEstimate | null,
): SingleTrackBpmAnalysis | null {
  if (!tempoCnn) {
    return primary;
  }

  if (!primary || primary.bpm === null) {
    const confidenceLevel = getTempoCnnConfidenceLevel(tempoCnn.probability);
    const isReliable =
      (confidenceLevel === "good" || confidenceLevel === "excellent") &&
      tempoCnn.stability >= 0.7 &&
      tempoCnn.localEstimateCount >= 2;

    return {
      bpm: tempoCnn.bpm,
      confidence: null,
      confidenceLevel,
      tempoStability: tempoCnn.stability,
      windowAgreement: null,
      analyzedWindowCount: 0,
      method: "tempocnn",
      tempoCnn,
      detectorAgreement: null,
      isReliable,
    };
  }

  const normalizedTempoCnnBpm = normalizeOctaveToReference(
    tempoCnn.bpm,
    primary.bpm,
  );
  const detectorAgreement =
    relativeDifference(normalizedTempoCnnBpm, primary.bpm) <=
    TEMPO_MATCH_TOLERANCE;
  const tempoStability = detectorAgreement
    ? averageAvailable(primary.tempoStability, tempoCnn.stability)
    : Math.min(primary.tempoStability ?? 1, tempoCnn.stability) * 0.5;
  const hasEnoughLocalEvidence = tempoCnn.localEstimateCount >= 2;
  const primaryHasMinimumSignal = (primary.confidence ?? 0) >= 1;
  const strongModelEvidence =
    tempoCnn.probability >= 0.55 && tempoCnn.stability >= 0.65;
  const exceptionalModelEvidence =
    tempoCnn.probability >= 0.8 && tempoCnn.stability >= 0.8;
  const isReliable =
    detectorAgreement &&
    hasEnoughLocalEvidence &&
    strongModelEvidence &&
    (primaryHasMinimumSignal || exceptionalModelEvidence);
  const confidenceLevel: TempoConfidenceLevel = isReliable
    ? exceptionalModelEvidence && (primary.confidence ?? 0) > 1.5
      ? "excellent"
      : "good"
    : detectorAgreement
      ? "low"
      : "very_low";

  return {
    ...primary,
    confidenceLevel,
    tempoStability: roundTo(tempoStability, 3),
    method: "essentia_tempocnn_hybrid",
    tempoCnn: {
      ...tempoCnn,
      bpm: roundBpm(normalizedTempoCnnBpm),
    },
    detectorAgreement,
    isReliable,
  };
}

export function normalizeOctaveToReference(bpm: number, reference: number): number {
  const candidates = [bpm / 2, bpm, bpm * 2].filter(
    (candidate) => candidate >= MIN_BPM && candidate <= MAX_BPM,
  );

  return candidates.reduce((closest, candidate) =>
    relativeDifference(candidate, reference) < relativeDifference(closest, reference)
      ? candidate
      : closest,
  );
}

function getTempoCnnConfidenceLevel(probability: number): TempoConfidenceLevel {
  if (probability < 0.35) {
    return "very_low";
  }

  if (probability < 0.6) {
    return "low";
  }

  if (probability < 0.82) {
    return "good";
  }

  return "excellent";
}

function averageAvailable(left: number | null, right: number): number {
  return left === null ? right : (left + right) / 2;
}

function weightedMedian(values: Array<{ value: number; weight: number }>): number {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  let cumulativeWeight = 0;

  for (const item of sorted) {
    cumulativeWeight += item.weight;
    if (cumulativeWeight >= totalWeight / 2) {
      return item.value;
    }
  }

  return sorted[sorted.length - 1]?.value ?? 0;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }

  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(left, right, 1);
}

function roundBpm(value: number): number {
  return roundTo(value, 1);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
