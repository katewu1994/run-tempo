import assert from "node:assert/strict";
import test from "node:test";
import {
  audioBufferToWavBlob,
  createWavFileName,
} from "../src/audio/exportWav";

test("export filename uses song title and target BPM", () => {
  assert.equal(createWavFileName("アイドル", 180), "アイドル_180bpm.wav");
  assert.equal(
    createWavFileName('  Night / Run: "Mix"  ', 172.45),
    "Night _ Run_ _Mix_172.5bpm.wav",
  );
});

test("WAV export includes RIFF INFO and ID3 artwork metadata", async () => {
  const audioBuffer = {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 3,
    getChannelData: () => new Float32Array([0, 0.5, -0.5]),
  } as AudioBuffer;

  const blob = audioBufferToWavBlob(audioBuffer, {
    title: "夜のラン",
    artist: "Test Artist",
    album: "Test Album",
    artwork: {
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: "image/jpeg",
    },
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  assert.equal(ascii(bytes, 0, 4), "RIFF");
  assert.equal(ascii(bytes, 8, 4), "WAVE");
  assert.equal(view.getUint32(4, true), bytes.byteLength - 8);

  const chunks = readRiffChunks(bytes);
  assert.deepEqual(
    chunks.map((chunk) => chunk.id),
    ["fmt ", "data", "LIST", "id3 "],
  );

  const info = chunks.find((chunk) => chunk.id === "LIST");
  assert.ok(info);
  assert.equal(ascii(bytes, info.dataOffset, 4), "INFO");
  assert.ok(findAscii(bytes, "INAM") >= info.dataOffset);
  assert.ok(findAscii(bytes, "IART") >= info.dataOffset);
  assert.ok(findAscii(bytes, "IPRD") >= info.dataOffset);

  const id3 = chunks.find((chunk) => chunk.id === "id3 ");
  assert.ok(id3);
  assert.equal(ascii(bytes, id3.dataOffset, 3), "ID3");
  assert.ok(findAscii(bytes, "TIT2") >= id3.dataOffset);
  assert.ok(findAscii(bytes, "TPE1") >= id3.dataOffset);
  assert.ok(findAscii(bytes, "TALB") >= id3.dataOffset);
  assert.ok(findAscii(bytes, "APIC") >= id3.dataOffset);
});

test("plain WAV export keeps the original minimal chunk set", async () => {
  const audioBuffer = {
    numberOfChannels: 2,
    sampleRate: 48_000,
    length: 1,
    getChannelData: () => new Float32Array([0]),
  } as AudioBuffer;

  const bytes = new Uint8Array(
    await audioBufferToWavBlob(audioBuffer).arrayBuffer(),
  );

  assert.deepEqual(
    readRiffChunks(bytes).map((chunk) => chunk.id),
    ["fmt ", "data"],
  );
});

function readRiffChunks(bytes: Uint8Array): Array<{
  id: string;
  dataOffset: number;
  size: number;
}> {
  const view = new DataView(bytes.buffer);
  const chunks = [];
  let offset = 12;

  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    chunks.push({ id: ascii(bytes, offset, 4), dataOffset: offset + 8, size });
    offset += 8 + size + (size % 2);
  }

  return chunks;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function findAscii(bytes: Uint8Array, value: string): number {
  const needle = new TextEncoder().encode(value);

  for (let offset = 0; offset <= bytes.byteLength - needle.byteLength; offset += 1) {
    if (needle.every((byte, index) => bytes[offset + index] === byte)) {
      return offset;
    }
  }

  return -1;
}
