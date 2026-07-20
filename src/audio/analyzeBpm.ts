import type { BpmAnalysis } from "./types";

const ESSENTIA_SAMPLE_RATE = 44100;
const ANALYSIS_SAMPLE_RATE = 11025;
const MAX_ANALYSIS_SECONDS = 120;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const ESSENTIA_MIN_BPM = 40;
const ESSENTIA_MAX_BPM = 240;
const FALLBACK_MIN_BPM = 60;
const FALLBACK_MAX_BPM = 200;
const BPM_STEP = 0.5;
const HALF_TIME_BPM_THRESHOLD = 110;
const HARMONIC_SCORE_RATIO = 0.5;

type TempoCandidate = {
  bpm: number;
  score: number;
};

type EssentiaWasmModule = {
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
};

type EssentiaVector = {
  delete?: () => void;
};

type RhythmExtractor2013Result = {
  bpm?: number;
  ticks?: EssentiaVector;
  estimates?: EssentiaVector;
  bpmIntervals?: EssentiaVector;
};

type EssentiaInstance = {
  arrayToVector: (input: Float32Array) => EssentiaVector;
  RhythmExtractor2013: (
    signal: EssentiaVector,
    maxTempo?: number,
    method?: string,
    minTempo?: number,
  ) => RhythmExtractor2013Result;
};

type EssentiaConstructor = new (
  wasmModule: EssentiaWasmModule,
  isDebug?: boolean,
) => EssentiaInstance;

let essentiaPromise: Promise<EssentiaInstance> | null = null;

export async function analyzeBpm(audioBuffer: AudioBuffer): Promise<BpmAnalysis> {
  const essentiaAnalysis = await analyzeBpmWithEssentia(audioBuffer);

  if (essentiaAnalysis.bpm !== null) {
    return essentiaAnalysis;
  }

  return analyzeBpmFallback(audioBuffer);
}

async function analyzeBpmWithEssentia(
  audioBuffer: AudioBuffer,
): Promise<BpmAnalysis> {
  let result: RhythmExtractor2013Result | null = null;
  let signal: EssentiaVector | null = null;

  try {
    const essentia = await getEssentia();
    const samples = downmixAndResample(audioBuffer, ESSENTIA_SAMPLE_RATE);

    if (samples.length < ESSENTIA_SAMPLE_RATE) {
      return { bpm: null };
    }

    signal = essentia.arrayToVector(samples);
    result = essentia.RhythmExtractor2013(
      signal,
      ESSENTIA_MAX_BPM,
      "multifeature",
      ESSENTIA_MIN_BPM,
    );

    return {
      bpm: normalizeDetectedBpm(result.bpm),
    };
  } catch (error) {
    console.warn("Essentia BPM analysis failed; using fallback detector.", error);
    return { bpm: null };
  } finally {
    signal?.delete?.();
    disposeEssentiaResult(result);
  }
}

function analyzeBpmFallback(audioBuffer: AudioBuffer): BpmAnalysis {
  const samples = downmixAndDownsample(audioBuffer);
  const envelope = buildEnergyEnvelope(samples);
  const onset = buildOnsetEnvelope(envelope);

  if (onset.length < 8 || Math.max(...onset) <= 0.0001) {
    return { bpm: null };
  }

  const peaks = keepStrongOnsets(onset);
  const tempo = estimateTempo(peaks);

  if (!tempo) {
    return { bpm: null };
  }

  return {
    bpm: Math.round(tempo.bpm * 10) / 10,
  };
}

async function getEssentia(): Promise<EssentiaInstance> {
  essentiaPromise ??= Promise.all([
    import("essentia.js/dist/essentia-wasm.es.js"),
    import("essentia.js/dist/essentia.js-core.es.js"),
  ]).then(async ([wasmModule, coreModule]) => {
    const wasm = wasmModule.EssentiaWASM as EssentiaWasmModule;
    const Essentia = coreModule.default as EssentiaConstructor;

    await waitForEssentiaRuntime(wasm);

    return new Essentia(wasm);
  });

  return essentiaPromise;
}

function waitForEssentiaRuntime(wasm: EssentiaWasmModule): Promise<void> {
  if (wasm.calledRun) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const previousOnRuntimeInitialized = wasm.onRuntimeInitialized;
    wasm.onRuntimeInitialized = () => {
      previousOnRuntimeInitialized?.();
      resolve();
    };
  });
}

function normalizeDetectedBpm(value: number | undefined): number | null {
  if (
    !Number.isFinite(value) ||
    !value ||
    value < ESSENTIA_MIN_BPM ||
    value > ESSENTIA_MAX_BPM
  ) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function disposeEssentiaResult(result: RhythmExtractor2013Result | null): void {
  if (!result) {
    return;
  }

  for (const value of Object.values(result)) {
    if (typeof value === "object" && value !== null) {
      value.delete?.();
    }
  }
}

function downmixAndDownsample(audioBuffer: AudioBuffer): Float32Array {
  return downmixAndResample(audioBuffer, ANALYSIS_SAMPLE_RATE);
}

function downmixAndResample(
  audioBuffer: AudioBuffer,
  targetSampleRate: number,
): Float32Array {
  const sourceSampleRate = audioBuffer.sampleRate;
  const sourceLength = Math.min(
    audioBuffer.length,
    Math.floor(sourceSampleRate * MAX_ANALYSIS_SECONDS),
  );
  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.floor(sourceLength / ratio));
  const result = new Float32Array(targetLength);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel),
  );

  for (let i = 0; i < targetLength; i += 1) {
    const sourcePosition = i * ratio;
    const sourceIndex = Math.min(sourceLength - 1, Math.floor(sourcePosition));
    const nextSourceIndex = Math.min(sourceLength - 1, sourceIndex + 1);
    const fraction = sourcePosition - sourceIndex;
    let sample = 0;

    for (const channel of channels) {
      const current = channel[sourceIndex] ?? 0;
      const next = channel[nextSourceIndex] ?? current;
      sample += current + (next - current) * fraction;
    }

    result[i] = sample / channels.length;
  }

  return result;
}

function buildEnergyEnvelope(samples: Float32Array): Float32Array {
  if (samples.length < FRAME_SIZE) {
    return new Float32Array();
  }

  const frameCount = Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1;
  const envelope = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * HOP_SIZE;
    let sum = 0;

    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const sample = samples[start + i] ?? 0;
      sum += sample * sample;
    }

    envelope[frame] = Math.sqrt(sum / FRAME_SIZE);
  }

  return envelope;
}

function buildOnsetEnvelope(envelope: Float32Array): Float32Array {
  const onset = new Float32Array(envelope.length);

  for (let i = 1; i < envelope.length; i += 1) {
    onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  }

  const smoothed = smooth(onset, 2);
  const max = Math.max(...smoothed);

  if (max <= 0) {
    return smoothed;
  }

  for (let i = 0; i < smoothed.length; i += 1) {
    smoothed[i] = smoothed[i] / max;
  }

  return smoothed;
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const smoothed = new Float32Array(values.length);

  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;

    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = i + offset;
      if (index >= 0 && index < values.length) {
        sum += values[index];
        count += 1;
      }
    }

    smoothed[i] = sum / count;
  }

  return smoothed;
}

function keepStrongOnsets(onset: Float32Array): Float32Array {
  const sorted = Array.from(onset).sort((a, b) => a - b);
  const thresholdIndex = Math.floor(sorted.length * 0.75);
  const threshold = Math.max(0.05, sorted[thresholdIndex] ?? 0.05);
  const peaks = new Float32Array(onset.length);

  for (let i = 0; i < onset.length; i += 1) {
    peaks[i] = onset[i] >= threshold ? onset[i] : 0;
  }

  return peaks;
}

function estimateTempo(onset: Float32Array): { bpm: number } | null {
  const frameRate = ANALYSIS_SAMPLE_RATE / HOP_SIZE;
  let bestBpm = 0;
  let bestScore = 0;
  const candidates: TempoCandidate[] = [];

  for (let bpm = FALLBACK_MIN_BPM; bpm <= FALLBACK_MAX_BPM; bpm += BPM_STEP) {
    const lag = (60 / bpm) * frameRate;
    const score = autocorrelationScore(onset, lag);
    candidates.push({ bpm, score });

    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  bestBpm = resolveHalfTimeTempo(bestBpm, bestScore, candidates);

  if (BPM_STEP > 0) {
    bestBpm = Math.round(bestBpm / BPM_STEP) * BPM_STEP;
  }

  bestBpm = Math.max(FALLBACK_MIN_BPM, Math.min(FALLBACK_MAX_BPM, bestBpm));

  return { bpm: bestBpm };
}

function resolveHalfTimeTempo(
  bestBpm: number,
  bestScore: number,
  candidates: TempoCandidate[],
): number {
  const doubledBpm = bestBpm * 2;

  if (bestBpm >= HALF_TIME_BPM_THRESHOLD || doubledBpm > FALLBACK_MAX_BPM) {
    return bestBpm;
  }

  const doubledCandidate = candidates.find(
    (candidate) => Math.abs(candidate.bpm - doubledBpm) < BPM_STEP / 2,
  );

  if (!doubledCandidate || doubledCandidate.score < bestScore * HARMONIC_SCORE_RATIO) {
    return bestBpm;
  }

  return doubledCandidate.bpm;
}

function autocorrelationScore(values: Float32Array, lag: number): number {
  if (lag <= 0 || lag >= values.length - 1) {
    return 0;
  }

  let score = 0;
  let currentEnergy = 0;
  let laggedEnergy = 0;

  for (let i = Math.ceil(lag); i < values.length; i += 1) {
    const current = values[i] ?? 0;
    const lagged = interpolate(values, i - lag);
    score += current * lagged;
    currentEnergy += current * current;
    laggedEnergy += lagged * lagged;
  }

  if (currentEnergy <= 0 || laggedEnergy <= 0) {
    return 0;
  }

  return score / Math.sqrt(currentEnergy * laggedEnergy);
}

function interpolate(values: Float32Array, index: number): number {
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(lowerIndex + 1, values.length - 1);
  const fraction = index - lowerIndex;
  const lower = values[lowerIndex] ?? 0;
  const upper = values[upperIndex] ?? lower;

  return lower + (upper - lower) * fraction;
}
