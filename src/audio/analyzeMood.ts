import type { MoodFeature, MoodLabel, RawEnergyFeatures } from "../domain/mixTypes";

const SAMPLE_RATE = 16000;
const TAGS = ["rock", "pop", "alternative", "indie", "electronic", "female vocalists", "dance", "00s", "alternative rock", "jazz", "beautiful", "metal", "chillout", "male vocalists", "classic rock", "soul", "indie rock", "Mellow", "electronica", "80s", "folk", "90s", "chill", "instrumental", "punk", "oldies", "blues", "hard rock", "ambient", "acoustic", "experimental", "female vocalist", "guitar", "Hip-Hop", "70s", "party", "country", "easy listening", "sexy", "catchy", "funk", "electro", "heavy metal", "Progressive rock", "60s", "rnb", "indie pop", "sad", "House", "happy"];
const GROUPS: Record<MoodLabel, string[]> = {
  calm: ["chillout", "Mellow", "chill", "ambient", "acoustic", "easy listening", "beautiful", "sad"],
  focused: ["instrumental", "electronic", "electronica", "ambient", "Progressive rock", "jazz"],
  uplifting: ["happy", "party", "dance", "catchy", "pop", "funk", "soul", "indie pop"],
  intense: ["metal", "hard rock", "heavy metal", "punk", "electro", "House", "Hip-Hop", "rock"],
};

type MoodRuntime = {
  extractor: { computeFrameWise(audio: Float32Array): unknown };
  model: { predict(input: unknown, zeroPadding?: boolean): Promise<number[][]> };
};
type EssentiaWasmRuntime = {
  calledRun?: boolean;
  onRuntimeInitialized?: () => void;
};
let runtimePromise: Promise<MoodRuntime> | null = null;

export async function analyzeMood(
  audioBuffer: AudioBuffer,
  fallbackFeatures: RawEnergyFeatures | null,
): Promise<MoodFeature> {
  try {
    const runtime = await getRuntime();
    const input = runtime.extractor.computeFrameWise(resampleMono(audioBuffer, SAMPLE_RATE, 60));
    const predictions = await runtime.model.predict(input, true);
    const averages = TAGS.map((_, index) =>
      predictions.reduce((sum, row) => sum + (row[index] ?? 0), 0) / Math.max(1, predictions.length),
    );
    return deriveMoodProfile(averages, "musicnn");
  } catch (error) {
    console.warn("MusiCNN mood analysis unavailable; using acoustic fallback.", error);
    return deriveAcousticMood(fallbackFeatures);
  }
}

export function deriveMoodProfile(
  tagScores: number[],
  source: MoodFeature["source"] = "musicnn",
): MoodFeature {
  const raw = Object.fromEntries(
    (Object.keys(GROUPS) as MoodLabel[]).map((label) => {
      const indices = GROUPS[label].map((tag) => TAGS.indexOf(tag)).filter((index) => index >= 0);
      const score = indices.reduce((sum, index) => sum + (tagScores[index] ?? 0), 0) / indices.length;
      return [label, Math.max(0.001, score)];
    }),
  ) as Record<MoodLabel, number>;
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const scores = Object.fromEntries(
    (Object.keys(raw) as MoodLabel[]).map((label) => [label, (raw[label] / total) * 100]),
  ) as Record<MoodLabel, number>;
  const label = (Object.keys(scores) as MoodLabel[]).sort((a, b) => scores[b] - scores[a])[0] ?? "focused";
  return { label, confidence: scores[label] / 100, scores, source };
}

function deriveAcousticMood(features: RawEnergyFeatures | null): MoodFeature {
  const energy = features ? Math.min(1, features.rms * 4 + features.onsetDensity * 0.08) : 0.5;
  return deriveMoodProfile(TAGS.map((tag) => {
    if (GROUPS.intense.includes(tag)) return energy;
    if (GROUPS.uplifting.includes(tag)) return 0.35 + energy * 0.45;
    if (GROUPS.calm.includes(tag)) return 1 - energy;
    if (GROUPS.focused.includes(tag)) return 0.55;
    return 0;
  }), "acoustic_fallback");
}

async function getRuntime(): Promise<MoodRuntime> {
  if (!runtimePromise) runtimePromise = (async () => {
    const [tf, wasm, modelModule] = await Promise.all([
      import("@tensorflow/tfjs"),
      import("essentia.js/dist/essentia-wasm.es.js"),
      import("essentia.js/dist/essentia.js-model.es.js"),
    ]);
    await tf.ready();
    await waitForEssentiaRuntime(wasm.EssentiaWASM as EssentiaWasmRuntime);
    const extractor = new modelModule.EssentiaTFInputExtractor(wasm.EssentiaWASM, "musicnn");
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const model = new modelModule.TensorflowMusiCNN(tf, `${base}models/musicnn/msd/model.json`);
    await model.initialize();
    return { extractor, model };
  })();
  return runtimePromise;
}

function waitForEssentiaRuntime(runtime: EssentiaWasmRuntime): Promise<void> {
  if (runtime.calledRun) return Promise.resolve();
  return new Promise((resolve) => {
    const previous = runtime.onRuntimeInitialized;
    runtime.onRuntimeInitialized = () => {
      previous?.();
      resolve();
    };
  });
}

function resampleMono(audioBuffer: AudioBuffer, targetRate: number, maxSeconds: number): Float32Array {
  const length = Math.min(Math.floor(audioBuffer.duration * targetRate), maxSeconds * targetRate);
  const output = new Float32Array(length);
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index));
  const ratio = audioBuffer.sampleRate / targetRate;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    let sample = 0;
    for (const channel of channels) sample += (channel[left] ?? 0) * (1 - fraction) + (channel[left + 1] ?? 0) * fraction;
    output[index] = sample / Math.max(1, channels.length);
  }
  return output;
}
