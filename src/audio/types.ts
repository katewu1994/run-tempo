export type LoadedAudio = {
  fileName: string;
  arrayBuffer: ArrayBuffer;
  audioBuffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
};

export type BpmAnalysis = {
  bpm: number | null;
};

export type BpmSettings = {
  detectedBpm: number | null;
  selectedSourceBpm: number | null;
  targetBpm: number;
};

export type ClickStyle = "soft" | "sharp" | "wood";

export type AccentEvery = 0 | 2 | 4;

export type MetronomeSettings = {
  targetBpm: number;
  volume: number;
  clickStyle: ClickStyle;
  accentEvery: AccentEvery;
  offsetMs: number;
};
