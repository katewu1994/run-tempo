import type { SingleTrackBpmAnalysis } from "./singleTrackBpmTypes";

type WorkerResponse =
  | { result: SingleTrackBpmAnalysis; error?: never }
  | { result?: never; error: string };

export function analyzeSingleTrackBpm(
  audioBuffer: AudioBuffer,
  signal?: AbortSignal,
): Promise<SingleTrackBpmAnalysis> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const worker = new Worker(
    new URL("./singleTrackBpm.worker.ts", import.meta.url),
    { type: "module" },
  );
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel).slice(),
  );
  const transfer = channels.map((channel) => channel.buffer as ArrayBuffer);

  return new Promise<SingleTrackBpmAnalysis>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
      worker.terminate();
    };
    const settle = (
      callback: (value: SingleTrackBpmAnalysis) => void,
      value: SingleTrackBpmAnalysis,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const fail = (error: Error | DOMException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => fail(createAbortError());

    signal?.addEventListener("abort", handleAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.error) {
        fail(new Error(event.data.error));
        return;
      }

      if (event.data.result) {
        settle(resolve, event.data.result);
      }
    };
    worker.onerror = (event) => {
      fail(new Error(event.message || "BPM analysis worker failed."));
    };
    worker.postMessage(
      {
        sampleRate: audioBuffer.sampleRate,
        channels,
      },
      transfer,
    );
  });
}

function createAbortError(): DOMException {
  return new DOMException("BPM analysis was cancelled.", "AbortError");
}

