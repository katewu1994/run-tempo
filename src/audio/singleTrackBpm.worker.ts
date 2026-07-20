/// <reference lib="webworker" />

import { analyzeSingleTrackChannels } from "./singleTrackBpmCore";

type AnalyzeMessage = {
  sampleRate: number;
  channels: Float32Array[];
};

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  try {
    const result = await analyzeSingleTrackChannels(event.data);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "BPM analysis failed.",
    });
  }
};

export {};

