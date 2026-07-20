export function mixAudio(
  audioContext: AudioContext,
  originalBuffer: AudioBuffer,
  metronomeBuffer: AudioBuffer,
  masterGain: number,
): AudioBuffer {
  const length = originalBuffer.length;
  const channelCount = originalBuffer.numberOfChannels;
  const outputBuffer = audioContext.createBuffer(
    channelCount,
    length,
    originalBuffer.sampleRate,
  );
  const click = metronomeBuffer.getChannelData(0);
  const clampedMasterGain = clamp(masterGain, 0, 2);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const input = originalBuffer.getChannelData(channel);
    const output = outputBuffer.getChannelData(channel);

    for (let i = 0; i < length; i += 1) {
      output[i] = clamp(
        (input[i] + (click[i] ?? 0)) * clampedMasterGain,
        -1,
        1,
      );
    }
  }

  return outputBuffer;
}

export function copyAudioBufferSlice(
  audioContext: AudioContext,
  sourceBuffer: AudioBuffer,
  durationSec: number,
): AudioBuffer {
  const length = Math.min(
    sourceBuffer.length,
    Math.max(1, Math.floor(durationSec * sourceBuffer.sampleRate)),
  );
  const outputBuffer = audioContext.createBuffer(
    sourceBuffer.numberOfChannels,
    length,
    sourceBuffer.sampleRate,
  );

  for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
    outputBuffer
      .getChannelData(channel)
      .set(sourceBuffer.getChannelData(channel).slice(0, length));
  }

  return outputBuffer;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
