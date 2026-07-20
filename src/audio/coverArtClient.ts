export type CoverArtCandidate = {
  releaseGroupId: string;
  title: string;
  artist: string;
  firstReleaseDate: string | null;
  score: number | null;
  imageUrl: string;
};

type CoverArtLookupResponse = {
  candidates?: CoverArtCandidate[];
  error?: string;
};

export async function lookupCoverArt(
  artist: string,
  album: string,
  signal?: AbortSignal,
): Promise<CoverArtCandidate[]> {
  const url = new URL("/api/cover-art/lookup", window.location.origin);
  url.searchParams.set("artist", artist);
  url.searchParams.set("album", album);

  const response = await fetch(`${url.pathname}${url.search}`, { signal });
  const body = (await response.json().catch(() => ({}))) as CoverArtLookupResponse;

  if (!response.ok) {
    throw new Error(body.error || "Unable to look up cover art.");
  }

  return Array.isArray(body.candidates) ? body.candidates : [];
}
