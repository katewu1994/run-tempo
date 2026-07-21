import type { EnergyStructureFeature, RawEnergyFeatures } from "../domain/mixTypes";

const MAX_ANALYSIS_SECONDS = 120;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const SPECTRAL_FRAME_SIZE = 512;
const SPECTRAL_BIN_COUNT = 96;
const MAX_SPECTRAL_FRAMES = 24;

export function extractRawEnergyFeatures(audioBuffer: AudioBuffer): RawEnergyFeatures {
  const samples = downmixForEnergy(audioBuffer);
  const rms = calculateRms(samples);
  const envelope = buildEnergyEnvelope(samples);

  return {
    rms,
    onsetDensity: calculateOnsetDensity(envelope, audioBuffer.duration),
    spectralCentroid: calculateNormalizedSpectralCentroid(samples),
  };
}

export function extractEnergyStructure(
  audioBuffer: AudioBuffer,
): EnergyStructureFeature | null {
  const envelope = buildEnergyEnvelope(downmixForEnergy(audioBuffer));
  if (envelope.length < 5) return null;

  const regions = Array.from({ length: 5 }, (_, index) => {
    const start = Math.floor((index * envelope.length) / 5);
    const end = Math.max(start + 1, Math.floor(((index + 1) * envelope.length) / 5));
    const values = envelope.slice(start, end);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });
  const max = Math.max(...regions);
  const min = Math.min(...regions);
  if (max <= 0) return null;
  const scaled = regions.map((value) => (value / max) * 100);
  const openingEnergy = scaled[0] ?? 0;
  const middleEnergy = ((scaled[1] ?? 0) + (scaled[2] ?? 0) + (scaled[3] ?? 0)) / 3;
  const closingEnergy = scaled[4] ?? 0;
  const peakIndex = regions.indexOf(max);
  const dynamicRange = ((max - min) / max) * 100;
  let shape: EnergyStructureFeature["shape"] = "flat";
  if (dynamicRange >= 15) {
    if (closingEnergy - openingEnergy >= 12) shape = "build";
    else if (openingEnergy - closingEnergy >= 12) shape = "release";
    else if (peakIndex >= 1 && peakIndex <= 3) shape = peakIndex === 2 ? "peak" : "arc";
  }

  return { openingEnergy, middleEnergy, peakEnergy: 100, closingEnergy, dynamicRange, shape };
}

function calculateNormalizedSpectralCentroid(samples: Float32Array): number {
  if (samples.length < SPECTRAL_FRAME_SIZE) {
    return 0;
  }

  const availableFrames = Math.floor(samples.length / SPECTRAL_FRAME_SIZE);
  const frameCount = Math.min(MAX_SPECTRAL_FRAMES, availableFrames);
  const frameStride = Math.max(1, Math.floor(availableFrames / frameCount));
  let weightedFrequency = 0;
  let totalMagnitude = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameStride * SPECTRAL_FRAME_SIZE;

    for (let bin = 1; bin <= SPECTRAL_BIN_COUNT; bin += 1) {
      let real = 0;
      let imaginary = 0;

      for (let index = 0; index < SPECTRAL_FRAME_SIZE; index += 1) {
        const window = 0.5 - 0.5 * Math.cos(
          (2 * Math.PI * index) / (SPECTRAL_FRAME_SIZE - 1),
        );
        const sample = (samples[start + index] ?? 0) * window;
        const phase = (2 * Math.PI * bin * index) / SPECTRAL_FRAME_SIZE;
        real += sample * Math.cos(phase);
        imaginary -= sample * Math.sin(phase);
      }

      const magnitude = Math.hypot(real, imaginary);
      weightedFrequency += (bin / SPECTRAL_BIN_COUNT) * magnitude;
      totalMagnitude += magnitude;
    }
  }

  return totalMagnitude > 0 ? weightedFrequency / totalMagnitude : 0;
}

function downmixForEnergy(audioBuffer: AudioBuffer): Float32Array {
  const sourceLength = Math.min(
    audioBuffer.length,
    Math.floor(audioBuffer.sampleRate * MAX_ANALYSIS_SECONDS),
  );
  const result = new Float32Array(sourceLength);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel),
  );

  for (let i = 0; i < sourceLength; i += 1) {
    let sample = 0;

    for (const channel of channels) {
      sample += channel[i] ?? 0;
    }

    result[i] = sample / channels.length;
  }

  return result;
}

function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;

  for (const sample of samples) {
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples.length);
}

function buildEnergyEnvelope(samples: Float32Array): number[] {
  if (samples.length < FRAME_SIZE) {
    return [];
  }

  const frameCount = Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1;
  const envelope: number[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * HOP_SIZE;
    let sum = 0;

    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const sample = samples[start + i] ?? 0;
      sum += sample * sample;
    }

    envelope.push(Math.sqrt(sum / FRAME_SIZE));
  }

  return envelope;
}

function calculateOnsetDensity(envelope: number[], durationSec: number): number {
  if (envelope.length < 2 || durationSec <= 0) {
    return 0;
  }

  const increases = envelope
    .slice(1)
    .map((value, index) => Math.max(0, value - (envelope[index] ?? 0)));
  const mean =
    increases.reduce((total, value) => total + value, 0) / increases.length;
  const variance =
    increases.reduce((total, value) => total + (value - mean) ** 2, 0) /
    increases.length;
  const threshold = mean + Math.sqrt(variance);
  const onsetCount = increases.filter((value) => value > threshold).length;

  return onsetCount / durationSec;
}
