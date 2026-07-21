/// <reference lib="webworker" />

import { analyzeBpm } from "./analyzeBpm";
import { analyzeMood } from "./analyzeMood";
import { analyzeMusicalKey } from "./analyzeMusicalKey";
import { detectEmbeddedClick } from "./detectEmbeddedClick";
import {
  extractEnergyStructure,
  extractRawEnergyFeatures,
} from "./extractEnergyFeatures";
import type {
  AnalysisStage,
  AnalysisTimings,
  MultiTrackAnalysisInput,
  MultiTrackAnalysisResult,
} from "./multiTrackAnalysisQueue";

type AnalyzeMessage = {
  type: "analyze";
  requestId: number;
  input: MultiTrackAnalysisInput;
};

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  const { requestId, input } = event.data;

  try {
    const result = await analyzeTrack(input, (stage) => {
      workerScope.postMessage({ type: "progress", requestId, stage });
    });
    workerScope.postMessage({ type: "complete", requestId, result });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : "Audio analysis failed.",
    });
  }
};

async function analyzeTrack(
  input: MultiTrackAnalysisInput,
  onStage: (stage: AnalysisStage) => void,
): Promise<MultiTrackAnalysisResult> {
  const audioBuffer = createAudioBufferView(input);
  const timings: Partial<AnalysisTimings> = {};
  const startedAt = performance.now();
  const measure = async <T>(stage: AnalysisStage, callback: () => T | Promise<T>) => {
    onStage(stage);
    const stageStartedAt = performance.now();
    const result = await callback();
    timings[stage] = Math.round(performance.now() - stageStartedAt);
    return result;
  };

  const detectedBpm =
    input.embeddedCadenceBpm ??
    (await measure("bpm", async () => (await analyzeBpm(audioBuffer)).bpm));
  const clickDetection = await measure("click", () =>
    input.embeddedCadenceBpm !== null
      ? { status: "confirmed" as const, confidence: 1 }
      : detectEmbeddedClick(audioBuffer, detectedBpm),
  );
  const rawEnergyFeatures =
    input.rawEnergyFeatures ??
    (await measure("energy", () => extractRawEnergyFeatures(audioBuffer)));
  const mood = await measure("mood", () => analyzeMood(audioBuffer, rawEnergyFeatures));
  const musicalKey = await measure("key", () => analyzeMusicalKey(audioBuffer));
  const energyStructure = await measure("structure", () =>
    extractEnergyStructure(audioBuffer),
  );

  return {
    detectedBpm,
    clickDetection,
    rawEnergyFeatures,
    mood,
    musicalKey,
    energyStructure,
    timings: {
      ...timings,
      total: Math.round(performance.now() - startedAt),
    },
  };
}

function createAudioBufferView(input: MultiTrackAnalysisInput): AudioBuffer {
  const length = input.channels[0]?.length ?? 0;

  return {
    numberOfChannels: input.channels.length,
    length,
    sampleRate: input.sampleRate,
    duration: input.durationSec,
    getChannelData: (channel: number) => input.channels[channel] ?? new Float32Array(),
  } as unknown as AudioBuffer;
}
