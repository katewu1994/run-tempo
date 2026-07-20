import type { MetronomeSettings } from "./types";

const CLICK_DURATION_SEC = 0.055;
const ACCENT_GAIN = 1.45;

export function createMetronomeBuffer(
  audioContext: AudioContext,
  durationSec: number,
  sampleRate: number,
  settings: MetronomeSettings,
): AudioBuffer {
  const samples = createMetronomeSamples(durationSec, sampleRate, settings);
  const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
  buffer.getChannelData(0).set(samples);
  return buffer;
}

export function createMetronomeSamples(
  durationSec: number,
  sampleRate: number,
  settings: MetronomeSettings,
): Float32Array {
  const length = Math.max(1, Math.ceil(durationSec * sampleRate));
  const output = new Float32Array(length);
  const beatIntervalSec = 60 / clamp(settings.targetBpm, 40, 720);
  const clickLength = Math.max(1, Math.floor(CLICK_DURATION_SEC * sampleRate));
  const offsetSamples = Math.round((settings.offsetMs / 1000) * sampleRate);
  let beatIndex = 0;

  for (
    let beatStart = offsetSamples;
    beatStart < length;
    beatStart += Math.round(beatIntervalSec * sampleRate)
  ) {
    if (beatStart + clickLength < 0) {
      beatIndex += 1;
      continue;
    }

    const isAccent =
      settings.accentEvery > 0 && beatIndex % settings.accentEvery === 0;

    writeClick(output, beatStart, clickLength, sampleRate, settings, isAccent, beatIndex);
    beatIndex += 1;
  }

  return output;
}

function writeClick(
  output: Float32Array,
  start: number,
  clickLength: number,
  sampleRate: number,
  settings: MetronomeSettings,
  isAccent: boolean,
  beatIndex: number,
) {
  const volume = clamp(settings.volume, 0, 2);
  const accentGain = isAccent ? ACCENT_GAIN : 1;
  let seed = (beatIndex + 1) * 16807;

  for (let i = 0; i < clickLength; i += 1) {
    const index = start + i;
    if (index < 0 || index >= output.length) {
      continue;
    }

    const t = i / sampleRate;
    const progress = i / clickLength;
    const envelope = Math.pow(1 - progress, 3);
    const sample = createClickSample(
      settings.clickStyle,
      t,
      envelope,
      isAccent,
      () => {
        seed = (seed * 48271) % 0x7fffffff;
        return seed / 0x7fffffff;
      },
    );

    output[index] = clamp(output[index] + sample * volume * accentGain, -1, 1);
  }
}

function createClickSample(
  style: MetronomeSettings["clickStyle"],
  t: number,
  envelope: number,
  isAccent: boolean,
  random: () => number,
): number {
  if (style === "soft") {
    const noise = (random() * 2 - 1) * 0.72;
    const accentTone = isAccent ? Math.sin(2 * Math.PI * 2800 * t) * 0.32 : 0;
    return (noise + accentTone) * envelope;
  }

  if (style === "wood") {
    const bodyFrequency = isAccent ? 1320 : 880;
    const body = Math.sin(2 * Math.PI * bodyFrequency * t);
    const snap = Math.sin(2 * Math.PI * bodyFrequency * 2 * t) * 0.35;
    return (body + snap) * envelope * 0.85;
  }

  const frequency = isAccent ? 2200 : 1500;
  return Math.sin(2 * Math.PI * frequency * t) * envelope;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
