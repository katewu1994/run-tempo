import { z } from "zod";

const MUSICBRAINZ_API_ROOT = "https://musicbrainz.org/ws/2";
const COVER_ART_API_ROOT = "https://coverartarchive.org";
const MAX_CANDIDATES = 5;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1_050;

const lookupCache = new Map<
  string,
  { expiresAt: number; candidates: CoverArtCandidate[] }
>();
const pendingLookups = new Map<string, Promise<CoverArtCandidate[]>>();
let musicBrainzQueue: Promise<void> = Promise.resolve();
let nextMusicBrainzRequestAt = 0;

const lookupSchema = z.object({
  artist: z.string().trim().min(1).max(200),
  album: z.string().trim().min(1).max(200),
});

const musicBrainzResponseSchema = z.object({
  "release-groups": z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      score: z.number().optional(),
      "first-release-date": z.string().optional(),
      "artist-credit": z
        .array(
          z.object({
            name: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});

export type CoverArtCandidate = {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate: string | null;
  score: number | null;
  imageUrl: string;
};

export class CoverArtServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "CoverArtServiceError";
  }
}

export function parseCoverArtLookup(input: unknown): {
  artist: string;
  album: string;
} {
  return lookupSchema.parse(input);
}

export async function lookupCoverArt(args: {
  artist: string;
  album: string;
}): Promise<CoverArtCandidate[]> {
  const cacheKey = `${normalizeLookupValue(args.artist)}\u0000${normalizeLookupValue(args.album)}`;
  const cached = lookupCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.candidates;
  }

  const pending = pendingLookups.get(cacheKey);

  if (pending) {
    return pending;
  }

  const lookup = performCoverArtLookup(args).then((candidates) => {
    lookupCache.set(cacheKey, {
      candidates,
      expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
    });
    return candidates;
  });
  pendingLookups.set(cacheKey, lookup);

  try {
    return await lookup;
  } finally {
    pendingLookups.delete(cacheKey);
  }
}

async function performCoverArtLookup(args: {
  artist: string;
  album: string;
}): Promise<CoverArtCandidate[]> {
  const query = `artist:${quoteLucene(args.artist)} AND releasegroup:${quoteLucene(args.album)}`;
  const url = new URL(`${MUSICBRAINZ_API_ROOT}/release-group`);
  url.searchParams.set("query", query);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(MAX_CANDIDATES));

  const response = await scheduleMusicBrainzRequest(() =>
    fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          process.env.MUSICBRAINZ_USER_AGENT?.trim() ||
          "RunTempo/0.1.0 (cover-art lookup)",
      },
    }),
  );

  if (!response.ok) {
    throw new CoverArtServiceError(
      `MusicBrainz lookup failed with status ${response.status}.`,
      response.status === 429 || response.status === 503 ? 503 : 502,
    );
  }

  const parsed = musicBrainzResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new CoverArtServiceError("MusicBrainz returned an unexpected response.");
  }

  const candidates = await Promise.all(
    parsed.data["release-groups"].map(async (releaseGroup) => {
      const hasArtwork = await coverArtExists(releaseGroup.id);

      if (!hasArtwork) {
        return null;
      }

      return {
        releaseGroupId: releaseGroup.id,
        title: releaseGroup.title,
        artist:
          releaseGroup["artist-credit"]?.map((credit) => credit.name).join(" / ") ||
          args.artist,
        firstReleaseDate: releaseGroup["first-release-date"] ?? null,
        score: releaseGroup.score ?? null,
        imageUrl: `/api/cover-art/image/${releaseGroup.id}`,
      } satisfies CoverArtCandidate;
    }),
  );

  return candidates.filter(
    (candidate): candidate is CoverArtCandidate => candidate !== null,
  );
}

export async function fetchCoverArtImage(releaseGroupId: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  if (!z.string().uuid().safeParse(releaseGroupId).success) {
    throw new CoverArtServiceError("Invalid release group ID.", 400);
  }

  const response = await fetch(
    `${COVER_ART_API_ROOT}/release-group/${releaseGroupId}/front-500`,
    {
      headers: { Accept: "image/jpeg,image/png,image/*" },
      redirect: "follow",
    },
  );

  if (response.status === 404) {
    throw new CoverArtServiceError("Cover art was not found.", 404);
  }

  if (!response.ok) {
    throw new CoverArtServiceError(
      `Cover Art Archive request failed with status ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";

  if (!contentType.startsWith("image/")) {
    throw new CoverArtServiceError("Cover Art Archive returned a non-image response.");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new CoverArtServiceError("Cover image is too large.", 413);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new CoverArtServiceError("Cover image is too large.", 413);
  }

  return { bytes, contentType };
}

async function coverArtExists(releaseGroupId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${COVER_ART_API_ROOT}/release-group/${releaseGroupId}/front-500`,
      {
        method: "HEAD",
        redirect: "manual",
      },
    );

    return response.status === 307 || response.ok;
  } catch {
    return false;
  }
}

function quoteLucene(value: string): string {
  return `"${value.replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, "\\$&")}"`;
}

function normalizeLookupValue(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function scheduleMusicBrainzRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = musicBrainzQueue.then(async () => {
    const delayMs = Math.max(0, nextMusicBrainzRequestAt - Date.now());

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    nextMusicBrainzRequestAt = Date.now() + MUSICBRAINZ_REQUEST_INTERVAL_MS;
    return request();
  });

  musicBrainzQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
