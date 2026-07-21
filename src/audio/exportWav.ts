import type { RawEnergyFeatures } from "../domain/mixTypes";

export type WavArtwork = {
  data: Uint8Array;
  mimeType: string;
};

export type RunTempoWavMetadata = {
  version: 1;
  cadenceBpm: number;
  clickEmbedded: true;
  clickStyle: string;
  accentEvery: number;
  clickVolume: number;
  rawEnergyFeatures?: RawEnergyFeatures;
};

export type WavMetadata = {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: WavArtwork;
  runTempo?: RunTempoWavMetadata;
};

export function audioBufferToWavBlob(
  audioBuffer: AudioBuffer,
  metadata?: WavMetadata,
): Blob {
  const bytesPerSample = 2;
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const dataSize = frameCount * channelCount * bytesPerSample;
  const channels = Array.from({ length: channelCount }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  );

  const formatData = new Uint8Array(16);
  const formatView = new DataView(formatData.buffer);
  formatView.setUint16(0, 1, true);
  formatView.setUint16(2, channelCount, true);
  formatView.setUint32(4, sampleRate, true);
  formatView.setUint32(8, sampleRate * channelCount * bytesPerSample, true);
  formatView.setUint16(12, channelCount * bytesPerSample, true);
  formatView.setUint16(14, 16, true);

  const audioData = new Uint8Array(dataSize);
  const audioView = new DataView(audioData.buffer);
  let offset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clamp(channels[channel][frame] ?? 0, -1, 1);
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      audioView.setInt16(offset, intSample, true);
      offset += bytesPerSample;
    }
  }

  const chunks = [
    createRiffChunk("fmt ", formatData),
    createRiffChunk("data", audioData),
  ];
  const infoChunk = createInfoChunk(metadata);
  const id3Chunk = createId3Chunk(metadata);
  const runTempoChunk = createRunTempoChunk(metadata?.runTempo);

  if (infoChunk) {
    chunks.push(infoChunk);
  }
  if (id3Chunk) {
    chunks.push(id3Chunk);
  }
  if (runTempoChunk) {
    chunks.push(runTempoChunk);
  }

  const riffBody = concatBytes([asciiBytes("WAVE"), ...chunks]);
  const header = new Uint8Array(8);
  const headerView = new DataView(header.buffer);
  header.set(asciiBytes("RIFF"), 0);
  headerView.setUint32(4, riffBody.byteLength, true);

  const fileBytes = concatBytes([header, riffBody]);
  return new Blob([fileBytes.buffer as ArrayBuffer], { type: "audio/wav" });
}

function createRunTempoChunk(
  metadata: RunTempoWavMetadata | undefined,
): Uint8Array | null {
  if (!metadata) {
    return null;
  }

  return createRiffChunk(
    "rtmp",
    new TextEncoder().encode(JSON.stringify(metadata)),
  );
}

export function createWavFileName(songTitle: string, targetBpm: number): string {
  const safeTitle =
    songTitle
      .trim()
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/[._ ]+$/g, "")
      .slice(0, 120) || "RunTempo";
  const bpm = Math.round(targetBpm * 10) / 10;
  return `${safeTitle}_${bpm}bpm.wav`;
}

function createInfoChunk(metadata: WavMetadata | undefined): Uint8Array | null {
  const fields: Array<[string, string | undefined]> = [
    ["INAM", metadata?.title],
    ["IART", metadata?.artist],
    ["IPRD", metadata?.album],
  ];
  const entries = fields.flatMap(([id, value]) => {
    const trimmed = value?.trim();

    if (!trimmed) {
      return [];
    }

    return [
      createRiffChunk(
        id,
        concatBytes([new TextEncoder().encode(trimmed), new Uint8Array([0])]),
      ),
    ];
  });

  return entries.length > 0
    ? createRiffChunk("LIST", concatBytes([asciiBytes("INFO"), ...entries]))
    : null;
}

function createId3Chunk(metadata: WavMetadata | undefined): Uint8Array | null {
  if (!metadata) {
    return null;
  }

  const frames: Uint8Array[] = [];
  addTextFrame(frames, "TIT2", metadata.title);
  addTextFrame(frames, "TPE1", metadata.artist);
  addTextFrame(frames, "TALB", metadata.album);

  if (metadata.artwork?.data.byteLength) {
    const mimeType = metadata.artwork.mimeType.startsWith("image/")
      ? metadata.artwork.mimeType
      : "image/jpeg";
    const payload = concatBytes([
      new Uint8Array([3]),
      new TextEncoder().encode(mimeType),
      new Uint8Array([0, 3, 0]),
      metadata.artwork.data,
    ]);
    frames.push(createId3Frame("APIC", payload));
  }

  if (frames.length === 0) {
    return null;
  }

  const frameData = concatBytes(frames);
  const tagHeader = new Uint8Array(10);
  tagHeader.set(asciiBytes("ID3"), 0);
  tagHeader[3] = 4;
  tagHeader[4] = 0;
  tagHeader[5] = 0;
  tagHeader.set(encodeSynchsafe32(frameData.byteLength), 6);

  return createRiffChunk("id3 ", concatBytes([tagHeader, frameData]));
}

function addTextFrame(
  frames: Uint8Array[],
  id: string,
  value: string | undefined,
): void {
  const trimmed = value?.trim();

  if (trimmed) {
    frames.push(
      createId3Frame(
        id,
        concatBytes([new Uint8Array([3]), new TextEncoder().encode(trimmed)]),
      ),
    );
  }
}

function createId3Frame(id: string, payload: Uint8Array): Uint8Array {
  const header = new Uint8Array(10);
  header.set(asciiBytes(id), 0);
  header.set(encodeSynchsafe32(payload.byteLength), 4);
  return concatBytes([header, payload]);
}

function createRiffChunk(id: string, payload: Uint8Array): Uint8Array {
  const padding = payload.byteLength % 2;
  const chunk = new Uint8Array(8 + payload.byteLength + padding);
  const view = new DataView(chunk.buffer);
  chunk.set(asciiBytes(id), 0);
  view.setUint32(4, payload.byteLength, true);
  chunk.set(payload, 8);
  return chunk;
}

function encodeSynchsafe32(value: number): Uint8Array {
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ]);
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
