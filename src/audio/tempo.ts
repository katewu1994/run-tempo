const MIN_TEMPO_RATIO = 0.25;
const MAX_TEMPO_RATIO = 4;

export function getTempoRatio(
  sourceBpm: number | null,
  targetBpm: number,
): number {
  if (!sourceBpm || sourceBpm <= 0 || !Number.isFinite(sourceBpm)) {
    return 1;
  }

  return clamp(targetBpm / sourceBpm, MIN_TEMPO_RATIO, MAX_TEMPO_RATIO);
}

export function resampleTempo(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
  tempoRatio: number,
): AudioBuffer {
  const safeRatio = clamp(tempoRatio, MIN_TEMPO_RATIO, MAX_TEMPO_RATIO);

  if (Math.abs(safeRatio - 1) < 0.001) {
    return cloneAudioBuffer(audioContext, sourceBuffer);
  }

  const outputLength = Math.max(1, Math.round(sourceBuffer.length / safeRatio));
  const outputBuffer = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    outputLength,
    sourceBuffer.sampleRate,
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    const input = sourceBuffer.getChannelData(channel);
    const output = outputBuffer.getChannelData(channel);

    for (let i = 0; i < outputLength; i += 1) {
      const sourcePosition = i * safeRatio;
      const sourceIndex = Math.floor(sourcePosition);
      const nextIndex = Math.min(sourceIndex + 1, input.length - 1);
      const fraction = sourcePosition - sourceIndex;
      const current = input[sourceIndex] ?? 0;
      const next = input[nextIndex] ?? current;

      output[i] = current + (next - current) * fraction;
    }
  }

  return outputBuffer;
}

function cloneAudioBuffer(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
): AudioBuffer {
  const outputBuffer = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate,
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    outputBuffer.getChannelData(channel).set(sourceBuffer.getChannelData(channel));
  }

  return outputBuffer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
