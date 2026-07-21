export class YoutubeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeImportError";
  }
}

export async function importYoutubeAudio(
  youtubeUrl: string,
  signal?: AbortSignal,
): Promise<File> {
  const response = await fetch("/api/youtube/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: youtubeUrl }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new YoutubeImportError(
      payload?.error ?? "Unable to import audio from this YouTube link.",
    );
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new YoutubeImportError("YouTube returned an empty audio file.");
  }

  const encodedFileName = response.headers.get("X-Audio-Filename");
  const fileName = decodeFileName(encodedFileName) ?? "youtube-audio.mp3";

  return new File([blob], fileName, {
    type: blob.type || "audio/mpeg",
  });
}

function decodeFileName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
