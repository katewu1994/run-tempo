import type { BpmCandidateSource } from "../audio/bpmCandidates";
import type { AccentEvery, ClickStyle } from "../audio/types";

export type SingleTrackSessionSettings = {
  targetBpm: number;
  preferredDetector: BpmCandidateSource | null;
  masterGain: number;
  clickVolume: number;
  clickStyle: ClickStyle;
  accentEvery: AccentEvery;
};

const STORAGE_KEY = "run-tempo:single-track-settings:v1";

export const DEFAULT_SINGLE_TRACK_SESSION_SETTINGS: SingleTrackSessionSettings = {
  targetBpm: 180,
  preferredDetector: null,
  masterGain: 1,
  clickVolume: 1,
  clickStyle: "sharp",
  accentEvery: 2,
};

const DETECTOR_SOURCES: BpmCandidateSource[] = ["essentia", "tempocnn", "fallback"];
const CLICK_STYLES: ClickStyle[] = ["soft", "sharp", "wood"];
const ACCENT_VALUES: AccentEvery[] = [0, 2, 4];

export function loadSingleTrackSessionSettings(): SingleTrackSessionSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SINGLE_TRACK_SESSION_SETTINGS;
  }

  try {
    const parsed: unknown = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "null",
    );

    if (!isSessionSettings(parsed)) {
      return DEFAULT_SINGLE_TRACK_SESSION_SETTINGS;
    }

    return parsed;
  } catch {
    return DEFAULT_SINGLE_TRACK_SESSION_SETTINGS;
  }
}

export function saveSingleTrackSessionSettings(
  settings: SingleTrackSessionSettings,
) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The app remains usable when storage is disabled or unavailable.
  }
}

function isSessionSettings(value: unknown): value is SingleTrackSessionSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<SingleTrackSessionSettings>;
  return (
    isNumberInRange(settings.targetBpm, 40, 240) &&
    (settings.preferredDetector === null ||
      DETECTOR_SOURCES.includes(settings.preferredDetector as BpmCandidateSource)) &&
    isNumberInRange(settings.masterGain, 0, 2) &&
    isNumberInRange(settings.clickVolume, 0, 2) &&
    CLICK_STYLES.includes(settings.clickStyle as ClickStyle) &&
    ACCENT_VALUES.includes(settings.accentEvery as AccentEvery)
  );
}

function isNumberInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
