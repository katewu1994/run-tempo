import type { LoadedAudio } from "./types";

export async function decodeAudioFile(
  file: File,
  audioContext: AudioContext,
): Promise<LoadedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const decodeBuffer = arrayBuffer.slice(0);
  const audioBuffer = await decodeAudioData(audioContext, decodeBuffer);

  return {
    fileName: file.name,
    arrayBuffer,
    audioBuffer,
    durationSec: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    numberOfChannels: audioBuffer.numberOfChannels,
  };
}

/**
 * Decode audio in a way that works across browsers.
 *
 * Chrome/Firefox return a Promise from decodeAudioData, but some browsers
 * (notably Safari) only invoke the success/error callbacks and never resolve
 * the returned Promise — which leaves the UI stuck on "loading" forever.
 * We support both signatures and guarantee the returned Promise always settles.
 */
function decodeAudioData(
  audioContext: AudioContext,
  buffer: ArrayBuffer,
): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;

    const onSuccess = (decoded: AudioBuffer) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(decoded);
    };

    const onError = (error: DOMException | Error | null) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        error ?? new Error("Unable to decode this audio file."),
      );
    };

    try {
      const maybePromise = audioContext.decodeAudioData(
        buffer,
        onSuccess,
        onError,
      );

      // Modern browsers also resolve via the returned Promise.
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(onSuccess, onError);
      }
    } catch (error) {
      onError(error instanceof Error ? error : null);
    }
  });
}
