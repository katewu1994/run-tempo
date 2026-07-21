import type { MusicalKeyFeature } from "../domain/mixTypes";

const TARGET_SAMPLE_RATE = 11025;
const WINDOW_SIZE = 4096;
const WINDOW_COUNT = 20;
const TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function analyzeMusicalKey(audioBuffer: AudioBuffer): MusicalKeyFeature | null {
  const samples = resampleMono(audioBuffer, TARGET_SAMPLE_RATE, 90);
  if (samples.length < WINDOW_SIZE) return null;

  const chroma = new Array<number>(12).fill(0);
  const availableWindows = Math.floor(samples.length / WINDOW_SIZE);
  const count = Math.min(WINDOW_COUNT, availableWindows);

  for (let windowIndex = 0; windowIndex < count; windowIndex += 1) {
    const start = Math.floor((windowIndex * (samples.length - WINDOW_SIZE)) / Math.max(1, count - 1));
    for (let midi = 36; midi <= 83; midi += 1) {
      const frequency = 440 * 2 ** ((midi - 69) / 12);
      chroma[midi % 12] += goertzelPower(samples, start, frequency, TARGET_SAMPLE_RATE);
    }
  }

  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (total < 1e-5) return null;
  const normalized = chroma.map((value) => value / total);
  const candidates: Array<{ tonic: number; mode: "major" | "minor"; score: number }> = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    candidates.push({ tonic, mode: "major", score: correlation(normalized, rotate(MAJOR_PROFILE, tonic)) });
    candidates.push({ tonic, mode: "minor", score: correlation(normalized, rotate(MINOR_PROFILE, tonic)) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return null;
  const separation = Math.max(0, best.score - (second?.score ?? 0));
  const confidence = Math.max(0, Math.min(1, 0.35 + separation * 1.8));
  return { tonic: TONICS[best.tonic] ?? "C", mode: best.mode, confidence };
}

function goertzelPower(samples: Float32Array, start: number, frequency: number, sampleRate: number): number {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;
  for (let index = 0; index < WINDOW_SIZE; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (WINDOW_SIZE - 1));
    const current = (samples[start + index] ?? 0) * window + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return Math.max(0, previous2 ** 2 + previous ** 2 - coefficient * previous * previous2);
}

function correlation(values: number[], profile: number[]): number {
  const valueMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const profileMean = profile.reduce((sum, value) => sum + value, 0) / profile.length;
  let numerator = 0;
  let left = 0;
  let right = 0;
  values.forEach((value, index) => {
    const a = value - valueMean;
    const b = (profile[index] ?? 0) - profileMean;
    numerator += a * b;
    left += a * a;
    right += b * b;
  });
  return left && right ? numerator / Math.sqrt(left * right) : 0;
}

function rotate(values: number[], offset: number): number[] {
  return values.map((_, index) => values[(index - offset + 12) % 12] ?? 0);
}

function resampleMono(audioBuffer: AudioBuffer, targetRate: number, maxSeconds: number): Float32Array {
  const outputLength = Math.min(
    Math.floor(audioBuffer.duration * targetRate),
    maxSeconds * targetRate,
  );
  const output = new Float32Array(outputLength);
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  const ratio = audioBuffer.sampleRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const fraction = sourceIndex - left;
    let sample = 0;
    for (const channel of channels) sample += (channel[left] ?? 0) * (1 - fraction) + (channel[left + 1] ?? 0) * fraction;
    output[index] = sample / Math.max(1, channels.length);
  }
  return output;
}
