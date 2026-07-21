import type {
  EnergyStructureFeature,
  MoodFeature,
  MusicalKeyFeature,
  RawEnergyFeatures,
} from "../domain/mixTypes";

export const ANALYSIS_STAGES = [
  "bpm",
  "click",
  "energy",
  "mood",
  "key",
  "structure",
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];
export type AnalysisTimings = Partial<Record<AnalysisStage, number>> & {
  total: number;
};

export type MultiTrackAnalysisInput = {
  channels: Float32Array[];
  sampleRate: number;
  durationSec: number;
  embeddedCadenceBpm: number | null;
  rawEnergyFeatures: RawEnergyFeatures | null;
};

export type MultiTrackAnalysisResult = {
  detectedBpm: number | null;
  clickDetection: {
    status: "confirmed" | "suspected" | "not_detected";
    confidence: number;
  };
  rawEnergyFeatures: RawEnergyFeatures;
  mood: MoodFeature;
  musicalKey: MusicalKeyFeature | null;
  energyStructure: EnergyStructureFeature | null;
  timings: AnalysisTimings;
};

type AnalysisWorkerRequest = {
  type: "analyze";
  requestId: number;
  input: MultiTrackAnalysisInput;
};

type AnalysisWorkerResponse =
  | {
      type: "progress";
      requestId: number;
      stage: AnalysisStage;
    }
  | {
      type: "complete";
      requestId: number;
      result: MultiTrackAnalysisResult;
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };

type QueueTask = {
  requestId: number;
  input: MultiTrackAnalysisInput;
  resolve: (result: MultiTrackAnalysisResult) => void;
  reject: (error: Error) => void;
  onProgress?: (stage: AnalysisStage) => void;
  abortListener?: () => void;
  signal?: AbortSignal;
};

const MAX_ANALYSIS_SECONDS = 120;

/**
 * Keeps exactly one model-bearing worker alive. Analysis is deliberately
 * serial: multiple TensorFlow runtimes compete for CPU and memory, while this
 * queue reuses the initialized Essentia and MusiCNN runtimes for every track.
 */
export class MultiTrackAnalysisQueue {
  private worker: Worker | null = null;
  private activeTask: QueueTask | null = null;
  private readonly pendingTasks: QueueTask[] = [];
  private nextRequestId = 1;

  enqueue(
    input: MultiTrackAnalysisInput,
    options: {
      signal?: AbortSignal;
      onProgress?: (stage: AnalysisStage) => void;
    } = {},
  ): Promise<MultiTrackAnalysisResult> {
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    return new Promise((resolve, reject) => {
      const task: QueueTask = {
        requestId: this.nextRequestId,
        input,
        resolve,
        reject,
        onProgress: options.onProgress,
        signal: options.signal,
      };
      this.nextRequestId += 1;

      if (options.signal) {
        task.abortListener = () => this.cancelTask(task);
        options.signal.addEventListener("abort", task.abortListener, { once: true });
      }

      this.pendingTasks.push(task);
      this.startNextTask();
    });
  }

  cancelAll(): void {
    for (const task of this.pendingTasks.splice(0)) {
      this.finishTask(task);
      task.reject(createAbortError());
    }

    if (this.activeTask) {
      const task = this.activeTask;
      this.activeTask = null;
      this.finishTask(task);
      task.reject(createAbortError());
      this.resetWorker();
    }
  }

  dispose(): void {
    this.cancelAll();
    this.resetWorker();
  }

  private startNextTask(): void {
    if (this.activeTask) {
      return;
    }

    const task = this.pendingTasks.shift();

    if (!task) {
      return;
    }

    if (task.signal?.aborted) {
      this.finishTask(task);
      task.reject(createAbortError());
      this.startNextTask();
      return;
    }

    this.activeTask = task;
    const worker = this.getWorker();
    const request: AnalysisWorkerRequest = {
      type: "analyze",
      requestId: task.requestId,
      input: task.input,
    };
    const transfer = task.input.channels.map((channel) => channel.buffer);

    worker.postMessage(request, transfer);
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("./multiTrackAnalysis.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };
      this.worker.onerror = (event) => {
        this.failActiveTask(new Error(event.message || "Audio analysis worker failed."));
      };
    }

    return this.worker;
  }

  private handleWorkerMessage(message: AnalysisWorkerResponse): void {
    const task = this.activeTask;

    if (!task || task.requestId !== message.requestId) {
      return;
    }

    if (message.type === "progress") {
      task.onProgress?.(message.stage);
      return;
    }

    this.activeTask = null;
    this.finishTask(task);

    if (message.type === "complete") {
      task.resolve(message.result);
    } else {
      task.reject(new Error(message.message));
    }

    this.startNextTask();
  }

  private cancelTask(task: QueueTask): void {
    const pendingIndex = this.pendingTasks.indexOf(task);

    if (pendingIndex >= 0) {
      this.pendingTasks.splice(pendingIndex, 1);
      this.finishTask(task);
      task.reject(createAbortError());
      return;
    }

    if (this.activeTask === task) {
      this.activeTask = null;
      this.finishTask(task);
      task.reject(createAbortError());
      this.resetWorker();
      this.startNextTask();
    }
  }

  private failActiveTask(error: Error): void {
    const task = this.activeTask;

    if (!task) {
      return;
    }

    this.activeTask = null;
    this.finishTask(task);
    task.reject(error);
    this.resetWorker();
    this.startNextTask();
  }

  private finishTask(task: QueueTask): void {
    if (task.abortListener && task.signal) {
      task.signal.removeEventListener("abort", task.abortListener);
    }
  }

  private resetWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

/**
 * AudioBuffer instances are not transferable. Copy only the portion every
 * existing analysis path reads (the first 120 seconds), then transfer it to
 * the worker without retaining a second full-song copy on the main thread.
 */
export function createMultiTrackAnalysisInput(
  audioBuffer: AudioBuffer,
  embeddedCadenceBpm: number | null,
  rawEnergyFeatures: RawEnergyFeatures | null,
): MultiTrackAnalysisInput {
  const analysisLength = Math.min(
    audioBuffer.length,
    Math.floor(audioBuffer.sampleRate * MAX_ANALYSIS_SECONDS),
  );

  return {
    channels: Array.from(
      { length: audioBuffer.numberOfChannels },
      (_, channel) => audioBuffer.getChannelData(channel).slice(0, analysisLength),
    ),
    sampleRate: audioBuffer.sampleRate,
    durationSec: audioBuffer.duration,
    embeddedCadenceBpm,
    rawEnergyFeatures,
  };
}

function createAbortError(): DOMException {
  return new DOMException("Audio analysis was cancelled.", "AbortError");
}
