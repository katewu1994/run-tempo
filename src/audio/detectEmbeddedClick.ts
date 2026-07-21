export type EmbeddedClickDetection = {
  status: "suspected" | "not_detected";
  confidence: number;
};

const MAX_ANALYSIS_SECONDS = 90;
const FRAME_DURATION_SEC = 0.012;
const MIN_BPM = 40;
const MAX_BPM = 240;

/**
 * Looks for short, bright transients that recur on a stable beat grid.
 * This is intentionally conservative: regular drums and hi-hats can look like
 * a click, so callers must treat "suspected" as a prompt for confirmation.
 */
export function detectEmbeddedClick(
  audioBuffer: AudioBuffer,
  bpm: number | null,
): EmbeddedClickDetection {
  if (!bpm || bpm < MIN_BPM || bpm > MAX_BPM || audioBuffer.duration < 8) {
    return { status: "not_detected", confidence: 0 };
  }

  const frameSize = Math.max(1, Math.floor(audioBuffer.sampleRate * FRAME_DURATION_SEC));
  const maxFrames = Math.min(
    Math.floor(audioBuffer.length / frameSize),
    Math.floor(MAX_ANALYSIS_SECONDS / FRAME_DURATION_SEC),
  );

  if (maxFrames < 300) {
    return { status: "not_detected", confidence: 0 };
  }

  const transientEnergy = new Float32Array(maxFrames);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, index) => audioBuffer.getChannelData(index),
  );

  for (let frame = 0; frame < maxFrames; frame += 1) {
    const start = frame * frameSize;
    let derivativeTotal = 0;
    let amplitudeTotal = 0;

    for (const channel of channels) {
      let previous = channel[start] ?? 0;
      for (let offset = 1; offset < frameSize; offset += 1) {
        const sample = channel[start + offset] ?? 0;
        derivativeTotal += Math.abs(sample - previous);
        amplitudeTotal += Math.abs(sample);
        previous = sample;
      }
    }

    // Short tonal clicks have an unusually high amount of fast change relative
    // to their average loudness. This reduces false positives from sustained music.
    transientEnergy[frame] = derivativeTotal / Math.max(0.0001, amplitudeTotal);
  }

  const baseline = mean(transientEnergy);
  const interval = 60 / bpm / FRAME_DURATION_SEC;
  const phaseCount = Math.max(1, Math.round(interval));
  let best: { score: number; consistency: number } = { score: 0, consistency: 0 };

  for (let phase = 0; phase < phaseCount; phase += 1) {
    const hits: number[] = [];
    for (let position = phase; position < transientEnergy.length; position += interval) {
      const center = Math.round(position);
      hits.push(
        Math.max(
          transientEnergy[Math.max(0, center - 1)] ?? 0,
          transientEnergy[center] ?? 0,
          transientEnergy[Math.min(transientEnergy.length - 1, center + 1)] ?? 0,
        ),
      );
    }

    if (hits.length < 12) {
      continue;
    }

    const hitMean = mean(hits);
    const consistency = hits.filter((value) => value >= baseline * 1.35).length / hits.length;
    const score = Math.min(1, Math.max(0, (hitMean / Math.max(0.0001, baseline) - 1) / 0.65));

    if (score * consistency > best.score * best.consistency) {
      best = { score, consistency };
    }
  }

  const confidence = Math.round(Math.min(1, best.score * best.consistency) * 100) / 100;
  return {
    status: confidence >= 0.58 ? "suspected" : "not_detected",
    confidence,
  };
}

function mean(values: ArrayLike<number>): number {
  if (values.length === 0) {
    return 0;
  }

  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index] ?? 0;
  }
  return total / values.length;
}
