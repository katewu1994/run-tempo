export type TrackAudioMap = Record<string, AudioBuffer>;
export type TrackFileMap = Record<string, File>;

export type MultiBlockRenderOptions = {
  outputSampleRate?: number;
  masterGain: number;
  sourceGain: number;
  metronomeGain: number;
  preventClipping: boolean;
  normalizeSourceLoudness: boolean;
  targetSourceRms: number;
  minSourceNormalizationGain: number;
  maxSourceNormalizationGain: number;
};
