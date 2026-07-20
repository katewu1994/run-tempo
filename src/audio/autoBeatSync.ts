const ANALYSIS_SAMPLE_RATE = 11025;
const MAX_SYNC_SECONDS = 60;
const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_TARGET_BPM = 40;
const MAX_TARGET_BPM = 720;
const PHASE_BIN_SECONDS = 0.01;
const PHASE_SIGMA_SECONDS = 0.028;

export type AutoBeatSyncResult = {
  offsetMs: number;
  firstBeatSourceSec: number;
  confidence: number;
  peakCount: number;
};

type OnsetPeak = {
  sourceSec: number;
  adjustedSec: number;
  phaseSec: number;
  weight: number;
};

export function estimateAutoBeatSync(
  audioBuffer: AudioBuffer,
  tempoRatio: number,
  targetBpm: number,
): AutoBeatSyncResult | null {
  const safeTargetBpm = clamp(targetBpm, MIN_TARGET_BPM, MAX_TARGET_BPM);
  const safeTempoRatio = Number.isFinite(tempoRatio) && tempoRatio > 0 ? tempoRatio : 1;
  const beatIntervalSec = 60 / safeTargetBpm;
  const samples = downmixAndDownsample(audioBuffer);
  const envelope = buildEnergyEnvelope(samples);
  const onset = buildOnsetEnvelope(envelope);
  const peaks = findOnsetPeaks(onset, safeTempoRatio, beatIntervalSec);

  if (peaks.length < 4) {
    return null;
  }

  const phase = scoreBeatPhase(peaks, beatIntervalSec);
  if (!phase) {
    return null;
  }

  const firstMatch = findFirstMatchingPeak(peaks, phase.phaseSec, beatIntervalSec);
  const signedPhaseSec =
    phase.phaseSec > beatIntervalSec / 2
      ? phase.phaseSec - beatIntervalSec
      : phase.phaseSec;

  return {
    offsetMs: Math.round(signedPhaseSec * 1000),
    firstBeatSourceSec:
      firstMatch?.sourceSec ?? positiveModulo(signedPhaseSec, beatIntervalSec) * safeTempoRatio,
    confidence: phase.confidence,
    peakCount: peaks.length,
  };
}

function downmixAndDownsample(audioBuffer: AudioBuffer): Float32Array {
  const sourceSampleRate = audioBuffer.sampleRate;
  const sourceLength = Math.min(
    audioBuffer.length,
    Math.floor(sourceSampleRate * MAX_SYNC_SECONDS),
  );
  const ratio = sourceSampleRate / ANALYSIS_SAMPLE_RATE;
  const targetLength = Math.max(1, Math.floor(sourceLength / ratio));
  const result = new Float32Array(targetLength);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel),
  );

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = Math.min(sourceLength - 1, Math.floor(i * ratio));
    let sample = 0;

    for (const channel of channels) {
      sample += channel[sourceIndex] ?? 0;
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
    smoothed[i] /= max;
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

function findOnsetPeaks(
  onset: Float32Array,
  tempoRatio: number,
  beatIntervalSec: number,
): OnsetPeak[] {
  if (onset.length < 3) {
    return [];
  }

  const values = Array.from(onset).sort((a, b) => a - b);
  const threshold = Math.max(0.08, values[Math.floor(values.length * 0.76)] ?? 0.08);
  const peaks: OnsetPeak[] = [];

  for (let i = 1; i < onset.length - 1; i += 1) {
    const weight = onset[i];
    const isLocalPeak = weight >= onset[i - 1] && weight > onset[i + 1];

    if (!isLocalPeak || weight < threshold) {
      continue;
    }

    const sourceSec = (i * HOP_SIZE) / ANALYSIS_SAMPLE_RATE;
    const adjustedSec = sourceSec / tempoRatio;

    if (adjustedSec < 0.05) {
      continue;
    }

    peaks.push({
      sourceSec,
      adjustedSec,
      phaseSec: positiveModulo(adjustedSec, beatIntervalSec),
      weight,
    });
  }

  return peaks
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 220)
    .sort((a, b) => a.sourceSec - b.sourceSec);
}

function scoreBeatPhase(
  peaks: OnsetPeak[],
  beatIntervalSec: number,
): { phaseSec: number; confidence: number } | null {
  const binCount = Math.max(16, Math.round(beatIntervalSec / PHASE_BIN_SECONDS));
  const binDuration = beatIntervalSec / binCount;
  const scores = new Float32Array(binCount);

  for (const peak of peaks) {
    for (let bin = 0; bin < binCount; bin += 1) {
      const candidatePhaseSec = bin * binDuration;
      const distance = circularDistance(
        peak.phaseSec,
        candidatePhaseSec,
        beatIntervalSec,
      );
      const closeness = Math.exp(
        -(distance * distance) / (2 * PHASE_SIGMA_SECONDS * PHASE_SIGMA_SECONDS),
      );

      scores[bin] += peak.weight * closeness;
    }
  }

  let bestIndex = 0;
  let bestScore = 0;

  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestIndex = i;
    }
  }

  if (bestScore <= 0) {
    return null;
  }

  let secondScore = 0;
  const exclusionBins = Math.max(2, Math.round(0.06 / binDuration));

  for (let i = 0; i < scores.length; i += 1) {
    const binDistance = Math.min(
      Math.abs(i - bestIndex),
      scores.length - Math.abs(i - bestIndex),
    );

    if (binDistance > exclusionBins && scores[i] > secondScore) {
      secondScore = scores[i];
    }
  }

  const separation = secondScore > 0 ? (bestScore - secondScore) / bestScore : 1;
  const densityBonus = Math.min(0.25, peaks.length / 180);

  return {
    phaseSec: bestIndex * binDuration,
    confidence: clamp(separation + densityBonus, 0, 1),
  };
}

function findFirstMatchingPeak(
  peaks: OnsetPeak[],
  phaseSec: number,
  beatIntervalSec: number,
): OnsetPeak | null {
  const toleranceSec = Math.min(0.075, beatIntervalSec * 0.25);

  return (
    peaks.find(
      (peak) =>
        circularDistance(peak.phaseSec, phaseSec, beatIntervalSec) <= toleranceSec,
    ) ?? null
  );
}

function circularDistance(a: number, b: number, period: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, period - direct);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
