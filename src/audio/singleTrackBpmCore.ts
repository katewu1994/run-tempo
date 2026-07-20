import {
  buildEssentiaConsensus,
  buildTempoCnnEstimate,
  calculateIntervalStability,
  mergeTempoAnalyses,
} from "./bpmAnalysisMath";
import type {
  SingleTrackBpmAnalysis,
  TempoCnnEstimate,
  TempoCnnLocalEstimate,
  TempoWindowEstimate,
} from "./singleTrackBpmTypes";

const ESSENTIA_SAMPLE_RATE = 44100;
const FALLBACK_SAMPLE_RATE = 11025;
const MIN_BPM = 40;
const MAX_BPM = 240;
const MIN_ANALYSIS_SECONDS = 8;
const WINDOW_SECONDS = 45;
const WHOLE_TRACK_LIMIT_SECONDS = 75;
const TEMPO_CNN_SAMPLE_RATE = 11025;
const TEMPO_CNN_WINDOW_SECONDS = 18;
const TEMPO_CNN_FRAME_HOP = 512;
const TEMPO_CNN_PATCH_FRAMES = 256;
const TEMPO_CNN_PATCH_HOP = 128;
const TEMPO_CNN_MEL_BANDS = 40;
const TEMPO_CNN_CLASS_COUNT = 256;
const TEMPO_CNN_MIN_BPM = 30;
const TEMPO_CNN_MODEL_PATH = "models/tempocnn/deeptemp-k16-3/model.json";
const SILENCE_BLOCK_SECONDS = 0.5;
const SILENCE_RELATIVE_THRESHOLD = 0.035;
const SILENCE_ABSOLUTE_THRESHOLD = 0.0001;
const SILENCE_PADDING_SECONDS = 1;

const FALLBACK_FRAME_SIZE = 1024;
const FALLBACK_HOP_SIZE = 512;
const FALLBACK_MIN_BPM = 60;
const FALLBACK_MAX_BPM = 200;
const FALLBACK_BPM_STEP = 0.5;

type EssentiaWasmModule = {
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
};

type EssentiaVector = {
  delete?: () => void;
};

type EssentiaVectorCollection = {
  size: () => number;
  get: (index: number) => EssentiaVector;
  delete?: () => void;
};

type RhythmExtractor2013Result = {
  bpm?: number;
  confidence?: number;
  ticks?: EssentiaVector;
  estimates?: EssentiaVector;
  bpmIntervals?: EssentiaVector;
};

type EssentiaInstance = {
  arrayToVector: (input: Float32Array) => EssentiaVector;
  vectorToArray: (input: EssentiaVector) => Float32Array | number[];
  FrameGenerator: (
    input: Float32Array,
    frameSize?: number,
    hopSize?: number,
  ) => EssentiaVectorCollection;
  Windowing: (
    frame: EssentiaVector,
    normalized?: boolean,
    size?: number,
    type?: string,
    zeroPadding?: number,
    zeroPhase?: boolean,
  ) => { frame: EssentiaVector };
  Spectrum: (
    frame: EssentiaVector,
    size?: number,
  ) => { spectrum: EssentiaVector };
  MelBands: (
    spectrum: EssentiaVector,
    highFrequencyBound?: number,
    inputSize?: number,
    log?: boolean,
    lowFrequencyBound?: number,
    normalize?: string,
    numberBands?: number,
    sampleRate?: number,
    type?: string,
    warpingFormula?: string,
    weighting?: string,
  ) => { bands: EssentiaVector };
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

type EssentiaRuntime = {
  essentia: EssentiaInstance;
};

type TempoCnnFeature = {
  melSpectrum: ArrayLike<ArrayLike<number>>;
  frameSize: number;
  melBandsSize: number;
};

type TempoCnnRuntime = {
  tf: typeof import("@tensorflow/tfjs");
  model: import("@tensorflow/tfjs").GraphModel;
};

type ActiveRange = {
  start: number;
  end: number;
};

let essentiaPromise: Promise<EssentiaRuntime> | null = null;
let tempoCnnPromise: Promise<TempoCnnRuntime> | null = null;

export async function analyzeSingleTrackChannels(args: {
  channels: Float32Array[];
  sampleRate: number;
}): Promise<SingleTrackBpmAnalysis> {
  const mono = createCancellationSafeMono(args.channels);
  const activeRange = findActiveRange(mono, args.sampleRate);

  if (!activeRange) {
    return createEmptyAnalysis();
  }

  const activeSamples = mono.subarray(activeRange.start, activeRange.end);
  if (activeSamples.length / args.sampleRate < MIN_ANALYSIS_SECONDS) {
    return createEmptyAnalysis();
  }

  let runtime: EssentiaRuntime | null = null;
  let primary: SingleTrackBpmAnalysis | null = null;

  try {
    runtime = await getEssentia();
    const windows = createAnalysisWindows(activeSamples, args.sampleRate);
    const estimates: TempoWindowEstimate[] = [];

    for (const window of windows) {
      try {
        const estimate = analyzeEssentiaWindow(
          runtime.essentia,
          window,
          args.sampleRate,
        );
        if (estimate) {
          estimates.push(estimate);
        }
      } catch {
        // Keep the usable sections and let TempoCNN arbitrate incomplete or
        // low-confidence multifeature results.
      }
    }

    primary = buildEssentiaConsensus(estimates);
    if (primary?.isReliable) {
      return primary;
    }
  } catch {
    // TempoCNN and the deterministic fallback below still get a chance when
    // the classic beat tracker cannot initialize.
  }

  let tempoCnn: TempoCnnEstimate | null = null;
  if (runtime) {
    try {
      tempoCnn = await analyzeWithTempoCnn(
        runtime.essentia,
        activeSamples,
        args.sampleRate,
      );
    } catch (error) {
      // A model or backend failure should not discard a usable Essentia result.
      console.warn("TempoCNN analysis unavailable.", error);
    }
  }

  const merged = mergeTempoAnalyses(primary, tempoCnn);
  if (merged) {
    return merged;
  }

  return analyzeFallback(activeSamples, args.sampleRate);
}

function analyzeEssentiaWindow(
  essentia: EssentiaInstance,
  samples: Float32Array,
  sourceSampleRate: number,
): TempoWindowEstimate | null {
  let signal: EssentiaVector | null = null;
  let result: RhythmExtractor2013Result | null = null;

  try {
    const resampled = resampleLinear(samples, sourceSampleRate, ESSENTIA_SAMPLE_RATE);
    signal = essentia.arrayToVector(resampled);
    result = essentia.RhythmExtractor2013(
      signal,
      MAX_BPM,
      "multifeature",
      MIN_BPM,
    );

    const bpm = result.bpm;
    const confidence = result.confidence;
    if (
      !Number.isFinite(bpm) ||
      !bpm ||
      bpm < MIN_BPM ||
      bpm > MAX_BPM ||
      !Number.isFinite(confidence) ||
      confidence === undefined ||
      confidence < 0
    ) {
      return null;
    }

    const intervals = result.bpmIntervals
      ? Array.from(essentia.vectorToArray(result.bpmIntervals))
      : [];

    return {
      bpm,
      confidence,
      intervalStability: calculateIntervalStability(intervals),
    };
  } finally {
    signal?.delete?.();
    disposeEssentiaResult(result);
  }
}

function createCancellationSafeMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array();
  }

  if (channels.length === 1) {
    return channels[0]?.slice() ?? new Float32Array();
  }

  const length = Math.min(...channels.map((channel) => channel.length));
  const mixed = new Float32Array(length);
  const channelEnergy = new Float64Array(channels.length);
  let mixedEnergy = 0;

  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sample = channels[channelIndex]?.[i] ?? 0;
      sum += sample;
      channelEnergy[channelIndex] += sample * sample;
    }

    const value = sum / channels.length;
    mixed[i] = value;
    mixedEnergy += value * value;
  }

  let strongestChannelIndex = 0;
  for (let i = 1; i < channelEnergy.length; i += 1) {
    if ((channelEnergy[i] ?? 0) > (channelEnergy[strongestChannelIndex] ?? 0)) {
      strongestChannelIndex = i;
    }
  }

  const strongestEnergy = channelEnergy[strongestChannelIndex] ?? 0;
  if (strongestEnergy > 0 && mixedEnergy / strongestEnergy < 0.08) {
    return channels[strongestChannelIndex]?.slice() ?? mixed;
  }

  return mixed;
}

function findActiveRange(samples: Float32Array, sampleRate: number): ActiveRange | null {
  if (samples.length === 0 || sampleRate <= 0) {
    return null;
  }

  const blockSize = Math.max(1, Math.round(sampleRate * SILENCE_BLOCK_SECONDS));
  const blockCount = Math.ceil(samples.length / blockSize);
  const rmsValues = new Float32Array(blockCount);
  let peakRms = 0;

  for (let block = 0; block < blockCount; block += 1) {
    const start = block * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let energy = 0;

    for (let i = start; i < end; i += 1) {
      const sample = samples[i] ?? 0;
      energy += sample * sample;
    }

    const rms = Math.sqrt(energy / Math.max(1, end - start));
    rmsValues[block] = rms;
    peakRms = Math.max(peakRms, rms);
  }

  if (peakRms < SILENCE_ABSOLUTE_THRESHOLD) {
    return null;
  }

  const threshold = Math.max(
    SILENCE_ABSOLUTE_THRESHOLD,
    peakRms * SILENCE_RELATIVE_THRESHOLD,
  );
  let firstActiveBlock = -1;
  let lastActiveBlock = -1;

  for (let block = 0; block < rmsValues.length; block += 1) {
    if ((rmsValues[block] ?? 0) >= threshold) {
      firstActiveBlock = firstActiveBlock < 0 ? block : firstActiveBlock;
      lastActiveBlock = block;
    }
  }

  if (firstActiveBlock < 0 || lastActiveBlock < 0) {
    return null;
  }

  const padding = Math.round(sampleRate * SILENCE_PADDING_SECONDS);
  return {
    start: Math.max(0, firstActiveBlock * blockSize - padding),
    end: Math.min(samples.length, (lastActiveBlock + 1) * blockSize + padding),
  };
}

function createAnalysisWindows(
  samples: Float32Array,
  sampleRate: number,
): Float32Array[] {
  const durationSec = samples.length / sampleRate;
  if (durationSec <= WHOLE_TRACK_LIMIT_SECONDS) {
    return [samples];
  }

  const windowLength = Math.min(samples.length, Math.round(WINDOW_SECONDS * sampleRate));
  const maxStart = samples.length - windowLength;
  const starts = [0, Math.round(maxStart / 2), maxStart];

  return starts
    .filter((start, index) => starts.indexOf(start) === index)
    .map((start) => samples.subarray(start, start + windowLength));
}

function resampleLinear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (sourceSampleRate === targetSampleRate) {
    return samples.slice();
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const sourcePosition = i * ratio;
    const lower = Math.min(samples.length - 1, Math.floor(sourcePosition));
    const upper = Math.min(samples.length - 1, lower + 1);
    const fraction = sourcePosition - lower;
    const lowerValue = samples[lower] ?? 0;
    output[i] = lowerValue + ((samples[upper] ?? lowerValue) - lowerValue) * fraction;
  }

  return output;
}

async function getEssentia(): Promise<EssentiaRuntime> {
  essentiaPromise ??= Promise.all([
    import("essentia.js/dist/essentia-wasm.es.js"),
    import("essentia.js/dist/essentia.js-core.es.js"),
  ]).then(async ([wasmModule, coreModule]) => {
    const wasm = wasmModule.EssentiaWASM as EssentiaWasmModule;
    const Essentia = coreModule.default as EssentiaConstructor;

    await waitForEssentiaRuntime(wasm);
    return {
      essentia: new Essentia(wasm),
    };
  });

  return essentiaPromise;
}

async function analyzeWithTempoCnn(
  essentia: EssentiaInstance,
  samples: Float32Array,
  sourceSampleRate: number,
): Promise<TempoCnnEstimate | null> {
  const runtime = await getTempoCnnRuntime();
  const windows = createTempoCnnWindows(samples, sourceSampleRate);
  const localEstimates: TempoCnnLocalEstimate[] = [];

  for (const window of windows) {
    const resampled = resampleLinear(
      window,
      sourceSampleRate,
      TEMPO_CNN_SAMPLE_RATE,
    );
    const features = computeTempoCnnFeatures(
      essentia,
      resampled,
    );
    const patchStarts = createPatchStarts(features.frameSize);

    if (patchStarts.length === 0) {
      continue;
    }

    const inputValues = createTempoCnnInput(features, patchStarts);
    standardizeTempoCnnInput(inputValues);
    const input = runtime.tf.tensor4d(inputValues, [
      patchStarts.length,
      TEMPO_CNN_MEL_BANDS,
      TEMPO_CNN_PATCH_FRAMES,
      1,
    ]);
    const output = runtime.model.execute(input, "output");
    const outputTensors = Array.isArray(output) ? output : [output];
    const outputTensor = outputTensors[0];

    try {
      if (!outputTensor) {
        continue;
      }

      const probabilities = await outputTensor.data();
      const classCount = probabilities.length / patchStarts.length;
      if (
        !Number.isInteger(classCount) ||
        classCount !== TEMPO_CNN_CLASS_COUNT
      ) {
        throw new Error(
          `Unexpected TempoCNN output shape: ${probabilities.length} values for ${patchStarts.length} patches.`,
        );
      }

      for (let patch = 0; patch < patchStarts.length; patch += 1) {
        let bestClass = 0;
        let bestProbability = -1;
        const offset = patch * classCount;

        for (let tempoClass = 0; tempoClass < classCount; tempoClass += 1) {
          const probability = probabilities[offset + tempoClass] ?? 0;
          if (probability > bestProbability) {
            bestProbability = probability;
            bestClass = tempoClass;
          }
        }

        localEstimates.push({
          bpm: TEMPO_CNN_MIN_BPM + bestClass,
          probability: Math.max(0, bestProbability),
        });
      }
    } finally {
      input.dispose();
      for (const tensor of outputTensors) {
        tensor.dispose();
      }
    }
  }

  return buildTempoCnnEstimate(localEstimates);
}

async function getTempoCnnRuntime(): Promise<TempoCnnRuntime> {
  tempoCnnPromise ??= import("@tensorflow/tfjs").then(async (tf) => {
    await tf.setBackend("cpu");
    await tf.ready();

    const modelUrl = `${import.meta.env.BASE_URL}${TEMPO_CNN_MODEL_PATH}`;
    const model = await tf.loadGraphModel(modelUrl);

    return {
      tf,
      model,
    };
  });

  return tempoCnnPromise;
}

function computeTempoCnnFeatures(
  essentia: EssentiaInstance,
  samples: Float32Array,
): TempoCnnFeature {
  const frames = essentia.FrameGenerator(
    samples,
    1024,
    TEMPO_CNN_FRAME_HOP,
  );
  const melSpectrum: Float32Array[] = [];

  try {
    for (let index = 0; index < frames.size(); index += 1) {
      const frame = frames.get(index);
      let windowed: { frame: EssentiaVector } | null = null;
      let spectrum: { spectrum: EssentiaVector } | null = null;
      let melBands: { bands: EssentiaVector } | null = null;

      try {
        // Mirrors Essentia's TensorflowInputTempoCNN pipeline. The npm WASM
        // build does not expose that composite algorithm, but does expose all
        // three primitives used by its official implementation.
        windowed = essentia.Windowing(frame, false, 1024, "hann", 0, true);
        spectrum = essentia.Spectrum(windowed.frame, 1024);
        melBands = essentia.MelBands(
          spectrum.spectrum,
          5000,
          513,
          false,
          20,
          "unit_tri",
          TEMPO_CNN_MEL_BANDS,
          TEMPO_CNN_SAMPLE_RATE,
          "magnitude",
          "slaneyMel",
          "linear",
        );
        melSpectrum.push(
          Float32Array.from(essentia.vectorToArray(melBands.bands)),
        );
      } finally {
        melBands?.bands.delete?.();
        spectrum?.spectrum.delete?.();
        windowed?.frame.delete?.();
      }
    }
  } finally {
    frames.delete?.();
  }

  return {
    melSpectrum,
    frameSize: melSpectrum.length,
    melBandsSize: TEMPO_CNN_MEL_BANDS,
  };
}

function createTempoCnnWindows(
  samples: Float32Array,
  sampleRate: number,
): Float32Array[] {
  const windowLength = Math.min(
    samples.length,
    Math.round(TEMPO_CNN_WINDOW_SECONDS * sampleRate),
  );

  if (samples.length <= windowLength * 1.5) {
    return [samples];
  }

  const maxStart = samples.length - windowLength;
  const starts = [0, Math.round(maxStart / 2), maxStart];
  return starts
    .filter((start, index) => starts.indexOf(start) === index)
    .map((start) => samples.subarray(start, start + windowLength));
}

function createPatchStarts(frameCount: number): number[] {
  const starts: number[] = [];
  for (
    let start = 0;
    start + TEMPO_CNN_PATCH_FRAMES <= frameCount;
    start += TEMPO_CNN_PATCH_HOP
  ) {
    starts.push(start);
  }
  return starts;
}

function createTempoCnnInput(
  features: TempoCnnFeature,
  patchStarts: number[],
): Float32Array {
  const input = new Float32Array(
    patchStarts.length * TEMPO_CNN_MEL_BANDS * TEMPO_CNN_PATCH_FRAMES,
  );

  for (let patch = 0; patch < patchStarts.length; patch += 1) {
    const frameStart = patchStarts[patch] ?? 0;
    for (let band = 0; band < TEMPO_CNN_MEL_BANDS; band += 1) {
      for (let frame = 0; frame < TEMPO_CNN_PATCH_FRAMES; frame += 1) {
        const featureFrame = features.melSpectrum[frameStart + frame];
        const outputIndex =
          (patch * TEMPO_CNN_MEL_BANDS + band) * TEMPO_CNN_PATCH_FRAMES + frame;
        input[outputIndex] = Number(featureFrame?.[band] ?? 0);
      }
    }
  }

  return input;
}

function standardizeTempoCnnInput(input: Float32Array): void {
  if (input.length === 0) {
    return;
  }

  let mean = 0;
  for (const value of input) {
    mean += value;
  }
  mean /= input.length;

  let variance = 0;
  for (const value of input) {
    const difference = value - mean;
    variance += difference * difference;
  }
  const standardDeviation = Math.sqrt(variance / input.length);

  if (standardDeviation === 0) {
    input.fill(0);
    return;
  }

  for (let index = 0; index < input.length; index += 1) {
    input[index] = ((input[index] ?? 0) - mean) / standardDeviation;
  }
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

function analyzeFallback(
  samples: Float32Array,
  sourceSampleRate: number,
): SingleTrackBpmAnalysis {
  const resampled = resampleLinear(samples, sourceSampleRate, FALLBACK_SAMPLE_RATE);
  const envelope = buildFallbackEnergyEnvelope(resampled);
  const onset = buildFallbackOnsetEnvelope(envelope);

  if (onset.length < 8 || maxValue(onset) <= 0.0001) {
    return createEmptyAnalysis("fallback_autocorrelation");
  }

  const peaks = keepStrongFallbackOnsets(onset);
  let bestBpm = 0;
  let bestScore = 0;
  const candidates: Array<{ bpm: number; score: number }> = [];
  const frameRate = FALLBACK_SAMPLE_RATE / FALLBACK_HOP_SIZE;

  for (
    let bpm = FALLBACK_MIN_BPM;
    bpm <= FALLBACK_MAX_BPM;
    bpm += FALLBACK_BPM_STEP
  ) {
    const score = autocorrelationScore(peaks, (60 / bpm) * frameRate);
    candidates.push({ bpm, score });
    if (score > bestScore) {
      bestBpm = bpm;
      bestScore = score;
    }
  }

  if (bestScore <= 0) {
    return createEmptyAnalysis("fallback_autocorrelation");
  }

  if (bestBpm < 110 && bestBpm * 2 <= FALLBACK_MAX_BPM) {
    const doubled = candidates.find(
      (candidate) => Math.abs(candidate.bpm - bestBpm * 2) < FALLBACK_BPM_STEP / 2,
    );
    if (doubled && doubled.score >= bestScore * 0.82) {
      bestBpm = doubled.bpm;
    }
  }

  return {
    bpm: Math.round(bestBpm * 10) / 10,
    confidence: null,
    confidenceLevel: "unavailable",
    tempoStability: Math.round(clamp(bestScore, 0, 1) * 1000) / 1000,
    windowAgreement: null,
    analyzedWindowCount: 1,
    method: "fallback_autocorrelation",
    tempoCnn: null,
    detectorAgreement: null,
    isReliable: false,
  };
}

function buildFallbackEnergyEnvelope(samples: Float32Array): Float32Array {
  if (samples.length < FALLBACK_FRAME_SIZE) {
    return new Float32Array();
  }

  const frameCount =
    Math.floor((samples.length - FALLBACK_FRAME_SIZE) / FALLBACK_HOP_SIZE) + 1;
  const envelope = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * FALLBACK_HOP_SIZE;
    let energy = 0;
    for (let i = 0; i < FALLBACK_FRAME_SIZE; i += 1) {
      const sample = samples[start + i] ?? 0;
      energy += sample * sample;
    }
    envelope[frame] = Math.sqrt(energy / FALLBACK_FRAME_SIZE);
  }

  return envelope;
}

function buildFallbackOnsetEnvelope(envelope: Float32Array): Float32Array {
  const onset = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i += 1) {
    onset[i] = Math.max(0, (envelope[i] ?? 0) - (envelope[i - 1] ?? 0));
  }

  const smoothed = smooth(onset, 2);
  const max = maxValue(smoothed);
  if (max > 0) {
    for (let i = 0; i < smoothed.length; i += 1) {
      smoothed[i] = (smoothed[i] ?? 0) / max;
    }
  }

  return smoothed;
}

function keepStrongFallbackOnsets(onset: Float32Array): Float32Array {
  const sorted = Array.from(onset).sort((a, b) => a - b);
  const threshold = Math.max(
    0.05,
    sorted[Math.floor(sorted.length * 0.75)] ?? 0.05,
  );
  return onset.map((value) => (value >= threshold ? value : 0));
}

function smooth(values: Float32Array, radius: number): Float32Array {
  const output = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = i + offset;
      if (index >= 0 && index < values.length) {
        sum += values[index] ?? 0;
        count += 1;
      }
    }
    output[i] = sum / count;
  }
  return output;
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

  return currentEnergy > 0 && laggedEnergy > 0
    ? score / Math.sqrt(currentEnergy * laggedEnergy)
    : 0;
}

function interpolate(values: Float32Array, index: number): number {
  const lower = Math.floor(index);
  const upper = Math.min(values.length - 1, lower + 1);
  const fraction = index - lower;
  const lowerValue = values[lower] ?? 0;
  return lowerValue + ((values[upper] ?? lowerValue) - lowerValue) * fraction;
}

function maxValue(values: Float32Array): number {
  let max = 0;
  for (const value of values) {
    max = Math.max(max, value);
  }
  return max;
}

function createEmptyAnalysis(
  method: SingleTrackBpmAnalysis["method"] = "essentia_multifeature",
): SingleTrackBpmAnalysis {
  return {
    bpm: null,
    confidence: null,
    confidenceLevel: "unavailable",
    tempoStability: null,
    windowAgreement: null,
    analyzedWindowCount: 0,
    method,
    tempoCnn: null,
    detectorAgreement: null,
    isReliable: false,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
