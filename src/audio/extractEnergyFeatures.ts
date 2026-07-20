import type { RawEnergyFeatures } from "../domain/mixTypes";

const MAX_ANALYSIS_SECONDS = 120;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;

export function extractRawEnergyFeatures(audioBuffer: AudioBuffer): RawEnergyFeatures {
  const samples = downmixForEnergy(audioBuffer);
  const rms = calculateRms(samples);
  const envelope = buildEnergyEnvelope(samples);

  return {
    rms,
    onsetDensity: calculateOnsetDensity(envelope, audioBuffer.duration),
    spectralCentroid: 0.5,
  };
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
