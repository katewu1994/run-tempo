export function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const bytesPerSample = 2;
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const channels = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(channels[channel][frame] ?? 0, -1, 1);
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

export function createWavFileName(fileName: string, targetBpm: number): string {
  const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[^\w.-]+/g, "_");
  const bpm = Math.round(targetBpm * 10) / 10;
  return `${baseName}_${bpm}bpm_mix.wav`;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

