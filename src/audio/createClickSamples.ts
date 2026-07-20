export type ClickStyle = "soft_hihat" | "wood_block" | "sharp_beep" | "low_tick";

const CLICK_DURATIONS_SEC: Record<ClickStyle, number> = {
  soft_hihat: 0.015,
  wood_block: 0.025,
  sharp_beep: 0.02,
  low_tick: 0.025,
};

export function addClickToChannel(args: {
  channel: Float32Array;
  sampleRate: number;
  timeSec: number;
  style: ClickStyle;
  gain: number;
  isAccent: boolean;
}): void {
  const sampleRate = Math.max(1, args.sampleRate);
  const startFrame = Math.round(args.timeSec * sampleRate);
  const clickLength = Math.max(
    1,
    Math.floor(CLICK_DURATIONS_SEC[args.style] * sampleRate),
  );
  const accentGain = args.isAccent ? 1.28 : 1;
  const gain = Math.max(0, args.gain) * accentGain;
  let seed = createSeed(startFrame, args.style, args.isAccent);
  let previousNoise = 0;

  for (let i = 0; i < clickLength; i += 1) {
    const outputIndex = startFrame + i;

    if (outputIndex < 0 || outputIndex >= args.channel.length) {
      continue;
    }

    const progress = i / clickLength;
    const t = i / sampleRate;
    const envelope = Math.pow(1 - progress, 3);
    const random = () => {
      seed = (seed * 48271) % 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const sample = createClickSample({
      style: args.style,
      t,
      envelope,
      random,
      previousNoise,
    });

    previousNoise = sample.noise;
    args.channel[outputIndex] += clamp(sample.value * gain, -1, 1);
  }
}

export function addMetronomeGrid(args: {
  outputChannels: Float32Array[];
  sampleRate: number;
  startSec: number;
  endSec: number;
  targetCadence: number;
  clickStyle: ClickStyle;
  clickVolume: number;
  accentEvery: 0 | 2 | 4 | 8;
  gain: number;
}): void {
  if (
    args.outputChannels.length === 0 ||
    args.endSec <= args.startSec ||
    args.targetCadence <= 0
  ) {
    return;
  }

  const intervalSec = 60 / args.targetCadence;
  const gain = Math.max(0, args.clickVolume) * Math.max(0, args.gain);
  let beatIndex = 0;

  for (
    let clickTimeSec = args.startSec;
    clickTimeSec < args.endSec;
    clickTimeSec += intervalSec
  ) {
    const isAccent =
      args.accentEvery > 0 && beatIndex % args.accentEvery === 0;

    for (const channel of args.outputChannels) {
      addClickToChannel({
        channel,
        sampleRate: args.sampleRate,
        timeSec: clickTimeSec,
        style: args.clickStyle,
        gain,
        isAccent,
      });
    }

    beatIndex += 1;
  }
}

function createClickSample(args: {
  style: ClickStyle;
  t: number;
  envelope: number;
  random: () => number;
  previousNoise: number;
}): { value: number; noise: number } {
  const noise = args.random() * 2 - 1;

  if (args.style === "sharp_beep") {
    return {
      value: Math.sin(2 * Math.PI * 1500 * args.t) * args.envelope * 0.9,
      noise,
    };
  }

  if (args.style === "low_tick") {
    return {
      value: Math.sin(2 * Math.PI * 800 * args.t) * args.envelope * 0.85,
      noise,
    };
  }

  if (args.style === "soft_hihat") {
    const highPassedNoise = noise - args.previousNoise * 0.82;

    return {
      value: clamp(highPassedNoise * args.envelope * 0.55, -0.8, 0.8),
      noise,
    };
  }

  const body = Math.sin(2 * Math.PI * 880 * args.t);
  const snap = Math.sin(2 * Math.PI * 1760 * args.t) * 0.28;

  return {
    value: (body + snap + noise * 0.18) * args.envelope * 0.72,
    noise,
  };
}

function createSeed(startFrame: number, style: ClickStyle, isAccent: boolean): number {
  const styleSeed: Record<ClickStyle, number> = {
    soft_hihat: 101,
    wood_block: 211,
    sharp_beep: 307,
    low_tick: 401,
  };
  const seed = Math.abs(startFrame * 131 + styleSeed[style] + (isAccent ? 17 : 0));

  return (seed % 0x7ffffffe) + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
