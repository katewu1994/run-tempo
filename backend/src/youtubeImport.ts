import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MAX_DURATION_SECONDS = 15 * 60;
const IMPORT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_STDERR_LENGTH = 12_000;

export class YoutubeImportServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YoutubeImportServiceError";
  }
}

export type ImportedYoutubeAudio = {
  filePath: string;
  fileName: string;
  cleanup: () => Promise<void>;
};

export function parseYoutubeUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new YoutubeImportServiceError("Enter a YouTube URL.", 400);
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new YoutubeImportServiceError("Enter a valid YouTube URL.", 400);
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isYoutubeHost =
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be";

  if (!isYoutubeHost || !["http:", "https:"].includes(url.protocol)) {
    throw new YoutubeImportServiceError("Only YouTube links are supported.", 400);
  }

  return url.toString();
}

export async function importYoutubeAudio(
  youtubeUrl: string,
): Promise<ImportedYoutubeAudio> {
  const workDir = await mkdtemp(join(tmpdir(), "run-tempo-youtube-"));
  let keepWorkDir = false;

  try {
    await runYtDlp(youtubeUrl, workDir);

    const files = await readdir(workDir);
    const audioFile = files.find((file) => file.endsWith(".mp3"));
    const infoFile = files.find((file) => file.endsWith(".info.json"));

    if (!audioFile) {
      throw new YoutubeImportServiceError(
        "YouTube did not return a usable audio track.",
        502,
      );
    }

    const title = await readVideoTitle(infoFile ? join(workDir, infoFile) : null);
    keepWorkDir = true;

    return {
      filePath: join(workDir, audioFile),
      fileName: `${sanitizeFileName(title ?? "youtube-audio")}.mp3`,
      cleanup: () => rm(workDir, { recursive: true, force: true }),
    };
  } finally {
    if (!keepWorkDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function runYtDlp(youtubeUrl: string, workDir: string): Promise<void> {
  const executable = resolveYtDlpExecutable();
  const args = [
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    "--write-info-json",
    "--match-filter",
    `duration <= ${MAX_DURATION_SECONDS}`,
    "--max-filesize",
    "50M",
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5",
    "--output",
    join(workDir, "audio.%(ext)s"),
    youtubeUrl,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new YoutubeImportServiceError(
          "YouTube import timed out. Try a shorter video.",
          504,
        ),
      );
    }, IMPORT_TIMEOUT_MS);

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_LENGTH) {
        stderr += chunk;
      }
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(
          new YoutubeImportServiceError(
            "YouTube importing is not installed on this server.",
            503,
          ),
        );
        return;
      }

      finish(error);
    });

    child.once("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }

      const normalizedError = stderr.toLowerCase();
      if (
        normalizedError.includes("does not pass filter") ||
        normalizedError.includes("larger than max-filesize")
      ) {
        finish(
          new YoutubeImportServiceError(
            "Use a YouTube video shorter than 15 minutes.",
            413,
          ),
        );
        return;
      }

      finish(
        new YoutubeImportServiceError(
          "Unable to import this YouTube video. It may be private, restricted, or unavailable.",
          502,
        ),
      );
    });
  });
}

function resolveYtDlpExecutable(): string {
  const configuredPath = process.env.YT_DLP_PATH?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const localCandidates = [
    resolve(process.cwd(), ".venv/bin/yt-dlp"),
    resolve(process.cwd(), "backend/.venv/bin/yt-dlp"),
  ];
  const localExecutable = localCandidates.find((candidate) => existsSync(candidate));

  return localExecutable ?? "yt-dlp";
}

async function readVideoTitle(infoPath: string | null): Promise<string | null> {
  if (!infoPath) {
    return null;
  }

  try {
    const metadata = JSON.parse(await readFile(infoPath, "utf8")) as {
      title?: unknown;
    };
    return typeof metadata.title === "string" ? metadata.title : null;
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return sanitized || "youtube-audio";
}
