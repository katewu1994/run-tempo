import type { ExecutableMixPlan } from "../domain/mixTypes";
import { addMetronomeGrid } from "./createClickSamples";
import { getBlockSourceGain } from "./gainEnvelope";
import type { MultiBlockRenderOptions, TrackAudioMap } from "./multiTrackTypes";

const DEFAULT_RENDER_OPTIONS: MultiBlockRenderOptions = {
  masterGain: 0.9,
  sourceGain: 0.85,
  metronomeGain: 1,
  preventClipping: true,
  normalizeSourceLoudness: true,
  targetSourceRms: 0.16,
  minSourceNormalizationGain: 0.45,
  maxSourceNormalizationGain: 2.5,
};

const MAX_LOUDNESS_ANALYSIS_SAMPLES = 500000;

type ResolvedRenderOptions = Omit<MultiBlockRenderOptions, "outputSampleRate"> & {
  outputSampleRate: number;
};

export async function renderExecutableMixPlan(args: {
  audioContext: BaseAudioContext;
  trackAudioMap: TrackAudioMap;
  plan: ExecutableMixPlan;
  options?: Partial<MultiBlockRenderOptions>;
}): Promise<AudioBuffer> {
  const options = resolveRenderOptions(
    args.audioContext.sampleRate,
    args.options,
  );
  const totalDurationSec = getTotalDurationSec(args.plan);
  const outputLength = Math.max(
    1,
    Math.ceil(totalDurationSec * options.outputSampleRate),
  );
  const outputChannelCount = getOutputChannelCount(args.plan, args.trackAudioMap);
  const outputBuffer = args.audioContext.createBuffer(
    outputChannelCount,
    outputLength,
    options.outputSampleRate,
  );
  const outputChannels = Array.from(
    { length: outputChannelCount },
    (_, channel) => outputBuffer.getChannelData(channel),
  );
  const sourceGainByTrackId = getSourceGainByTrackId({
    plan: args.plan,
    trackAudioMap: args.trackAudioMap,
    options,
  });

  for (const block of args.plan.blocks) {
    const sourceBuffer = args.trackAudioMap[block.trackId];

    if (!sourceBuffer) {
      console.warn(`No decoded audio buffer found for track ${block.trackId}.`);
      continue;
    }

    renderSourceBlock({
      outputChannels,
      outputSampleRate: options.outputSampleRate,
      sourceBuffer,
      block,
      sourceGain: options.sourceGain * (sourceGainByTrackId.get(block.trackId) ?? 1),
    });

    if (block.metronome.enabled) {
      addMetronomeGrid({
        outputChannels,
        sampleRate: options.outputSampleRate,
        startSec: block.mixStartSec + getMetronomeOffsetSec(block.metronome.offsetMs),
        endSec: block.mixEndSec,
        targetCadence: block.targetCadence,
        clickStyle: block.metronome.clickStyle,
        clickVolume: block.metronome.clickVolume,
        accentEvery: block.metronome.accentEvery,
        gain: options.metronomeGain,
        fadeInSec: block.transition.fadeInSec,
        fadeOutSec: block.transition.fadeOutSec,
      });
    }
  }

  applyGain(outputChannels, options.masterGain);

  if (options.preventClipping) {
    normalizePeak(outputChannels);
  }

  return outputBuffer;
}

function getSourceGainByTrackId(args: {
  plan: ExecutableMixPlan;
  trackAudioMap: TrackAudioMap;
  options: ResolvedRenderOptions;
}): Map<string, number> {
  const result = new Map<string, number>();

  if (!args.options.normalizeSourceLoudness) {
    return result;
  }

  const usedTrackIds = new Set(args.plan.blocks.map((block) => block.trackId));

  for (const trackId of usedTrackIds) {
    const sourceBuffer = args.trackAudioMap[trackId];

    if (!sourceBuffer) {
      continue;
    }

    const rms = calculateBufferRms(sourceBuffer);

    if (rms <= 0) {
      result.set(trackId, 1);
      continue;
    }

    result.set(
      trackId,
      clamp(
        args.options.targetSourceRms / rms,
        args.options.minSourceNormalizationGain,
        args.options.maxSourceNormalizationGain,
      ),
    );
  }

  return result;
}

function calculateBufferRms(buffer: AudioBuffer): number {
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    return 0;
  }

  const step = Math.max(
    1,
    Math.floor(buffer.length / MAX_LOUDNESS_ANALYSIS_SAMPLES),
  );
  let sum = 0;
  let count = 0;

  for (let frame = 0; frame < buffer.length; frame += step) {
    let sample = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      sample += buffer.getChannelData(channel)[frame] ?? 0;
    }

    const downmixed = sample / buffer.numberOfChannels;
    sum += downmixed * downmixed;
    count += 1;
  }

  return count > 0 ? Math.sqrt(sum / count) : 0;
}

function getMetronomeOffsetSec(offsetMs: number): number {
  return Number.isFinite(offsetMs) ? offsetMs / 1000 : 0;
}

function renderSourceBlock(args: {
  outputChannels: Float32Array[];
  outputSampleRate: number;
  sourceBuffer: AudioBuffer;
  block: ExecutableMixPlan["blocks"][number];
  sourceGain: number;
}) {
  const blockDurationSec = Math.max(
    0,
    args.block.mixEndSec - args.block.mixStartSec,
  );
  const sourceStartSec = Math.max(0, args.block.sourceStartSec);
  const sourceEndSec = Math.min(
    args.sourceBuffer.duration,
    Math.max(sourceStartSec, args.block.sourceEndSec),
  );

  if (blockDurationSec <= 0 || sourceEndSec <= sourceStartSec) {
    return;
  }

  const outputLength = args.outputChannels[0]?.length ?? 0;
  const startFrame = Math.max(
    0,
    Math.ceil(args.block.mixStartSec * args.outputSampleRate),
  );
  const endFrame = Math.min(
    outputLength,
    Math.ceil(args.block.mixEndSec * args.outputSampleRate),
  );
  const fadeInSec = Math.max(
    0,
    args.block.transition.fadeInSec,
    args.block.transition.crossfadeWithPreviousSec,
  );
  const fadeOutSec = Math.max(0, args.block.transition.fadeOutSec);
  const playbackRate = getBlockPlaybackRate(args.block);

  for (let outputFrame = startFrame; outputFrame < endFrame; outputFrame += 1) {
    const outputTimeSec = outputFrame / args.outputSampleRate;

    if (outputTimeSec >= args.block.mixEndSec) {
      break;
    }

    const timeInBlockSec = outputTimeSec - args.block.mixStartSec;
    const sourceTimeSec = sourceStartSec + timeInBlockSec * playbackRate;

    if (sourceTimeSec >= sourceEndSec) {
      break;
    }

    const gain = getBlockSourceGain({
      timeInBlockSec,
      blockDurationSec,
      fadeInSec,
      fadeOutSec,
      baseGain: args.sourceGain,
    });

    for (
      let outputChannel = 0;
      outputChannel < args.outputChannels.length;
      outputChannel += 1
    ) {
      args.outputChannels[outputChannel][outputFrame] +=
        readConvertedSourceSample({
          sourceBuffer: args.sourceBuffer,
          sourceTimeSec,
          outputChannel,
          outputChannelCount: args.outputChannels.length,
        }) * gain;
    }
  }
}

function getBlockPlaybackRate(block: ExecutableMixPlan["blocks"][number]): number {
  if (
    block.stretchDecision !== "safe_stretch" ||
    !Number.isFinite(block.stretchRatio) ||
    block.stretchRatio <= 0
  ) {
    return 1;
  }

  return block.stretchRatio;
}

function readConvertedSourceSample(args: {
  sourceBuffer: AudioBuffer;
  sourceTimeSec: number;
  outputChannel: number;
  outputChannelCount: number;
}): number {
  const sourceChannelCount = args.sourceBuffer.numberOfChannels;

  if (sourceChannelCount === 0) {
    return 0;
  }

  if (args.outputChannelCount === 1 && sourceChannelCount > 1) {
    let sum = 0;

    for (let channel = 0; channel < sourceChannelCount; channel += 1) {
      sum += readSourceSample(args.sourceBuffer, channel, args.sourceTimeSec);
    }

    return sum / sourceChannelCount;
  }

  const sourceChannel =
    sourceChannelCount === 1
      ? 0
      : Math.min(args.outputChannel, sourceChannelCount - 1);

  return readSourceSample(args.sourceBuffer, sourceChannel, args.sourceTimeSec);
}

function readSourceSample(
  sourceBuffer: AudioBuffer,
  channel: number,
  timeSec: number,
): number {
  const sourceFrame = timeSec * sourceBuffer.sampleRate;
  const frame0 = Math.floor(sourceFrame);

  if (frame0 < 0 || frame0 >= sourceBuffer.length) {
    return 0;
  }

  const frame1 = Math.min(sourceBuffer.length - 1, frame0 + 1);
  const ratio = sourceFrame - frame0;
  const samples = sourceBuffer.getChannelData(channel);

  return samples[frame0] * (1 - ratio) + samples[frame1] * ratio;
}

function getTotalDurationSec(plan: ExecutableMixPlan): number {
  const maxBlockEndSec = plan.blocks.reduce(
    (maxEndSec, block) => Math.max(maxEndSec, block.mixEndSec),
    0,
  );
  const planDurationSec =
    Number.isFinite(plan.totalDurationSec) && plan.totalDurationSec > 0
      ? plan.totalDurationSec
      : 0;

  return Math.max(planDurationSec, maxBlockEndSec, 0);
}

function getOutputChannelCount(
  plan: ExecutableMixPlan,
  trackAudioMap: TrackAudioMap,
): number {
  const maxSourceChannelCount = plan.blocks.reduce((maxChannels, block) => {
    const sourceBuffer = trackAudioMap[block.trackId];

    if (!sourceBuffer) {
      return maxChannels;
    }

    return Math.max(maxChannels, Math.min(sourceBuffer.numberOfChannels, 2));
  }, 0);

  return maxSourceChannelCount || 2;
}

function applyGain(channels: Float32Array[], gain: number) {
  const finiteGain = Number.isFinite(gain) ? Math.max(0, gain) : 0;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] *= finiteGain;
    }
  }
}

function normalizePeak(channels: Float32Array[]) {
  let peak = 0;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  }

  if (peak <= 1) {
    return;
  }

  const normalizationGain = 1 / peak;

  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] *= normalizationGain;
    }
  }
}

function resolveRenderOptions(
  contextSampleRate: number,
  options?: Partial<MultiBlockRenderOptions>,
): ResolvedRenderOptions {
  return {
    outputSampleRate: getFinitePositiveNumber(
      options?.outputSampleRate,
      contextSampleRate,
    ),
    masterGain: getFiniteNonNegativeNumber(
      options?.masterGain,
      DEFAULT_RENDER_OPTIONS.masterGain,
    ),
    sourceGain: getFiniteNonNegativeNumber(
      options?.sourceGain,
      DEFAULT_RENDER_OPTIONS.sourceGain,
    ),
    metronomeGain: getFiniteNonNegativeNumber(
      options?.metronomeGain,
      DEFAULT_RENDER_OPTIONS.metronomeGain,
    ),
    preventClipping:
      options?.preventClipping ?? DEFAULT_RENDER_OPTIONS.preventClipping,
    normalizeSourceLoudness:
      options?.normalizeSourceLoudness ??
      DEFAULT_RENDER_OPTIONS.normalizeSourceLoudness,
    targetSourceRms: getFinitePositiveNumber(
      options?.targetSourceRms,
      DEFAULT_RENDER_OPTIONS.targetSourceRms,
    ),
    minSourceNormalizationGain: getFinitePositiveNumber(
      options?.minSourceNormalizationGain,
      DEFAULT_RENDER_OPTIONS.minSourceNormalizationGain,
    ),
    maxSourceNormalizationGain: getFinitePositiveNumber(
      options?.maxSourceNormalizationGain,
      DEFAULT_RENDER_OPTIONS.maxSourceNormalizationGain,
    ),
  };
}

function getFinitePositiveNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function getFiniteNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? value
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
