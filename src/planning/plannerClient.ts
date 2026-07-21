import type {
  CandidateScore,
  OpenAISelectionPlan,
  RunningPlan,
  RunSegment,
  TrackFeature,
} from "../domain/mixTypes";

export type PlannerInput = {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  topCandidatesBySegment: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
  rules: {
    allowTrackReuse: boolean;
    allowLoop: boolean;
    maxTracksPerSegment: number;
    preferStableCadenceGrid: boolean;
    minRepeatGapTracks: number;
    preferFolderVariety: boolean;
  };
};

export interface MixPlannerClient {
  createSelectionPlan(input: PlannerInput): Promise<OpenAISelectionPlan>;
}

export type PlannerMode = "mock" | "openai";
export type PlannerApiStatus = {
  status: "connected" | "unavailable";
  model: string | null;
};

const DEFAULT_DEV_PLANNER_API_BASE_URL = "http://localhost:8080";
const configuredPlannerApiBaseUrl =
  import.meta.env.VITE_PLANNER_API_BASE_URL?.trim() ?? "";

export const PLANNER_API_BASE_URL =
  configuredPlannerApiBaseUrl ||
  (import.meta.env.DEV ? DEFAULT_DEV_PLANNER_API_BASE_URL : "");

export const DEFAULT_PLANNER_MODE: PlannerMode = "openai";

export async function getPlannerApiStatus(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<PlannerApiStatus> {
  try {
    const response = await fetch(
      buildPlannerUrl(baseUrl, "/api/openai/status"),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal,
      },
    );

    if (!response.ok) {
      return { status: "unavailable", model: null };
    }

    const body = (await response.json()) as unknown;

    if (!isPlannerApiStatus(body)) {
      return { status: "unavailable", model: null };
    }

    return body;
  } catch {
    return { status: "unavailable", model: null };
  }
}

export class MockMixPlannerClient implements MixPlannerClient {
  async createSelectionPlan(input: PlannerInput): Promise<OpenAISelectionPlan> {
    const usedTrackIds = new Set<string>();
    const segmentPlans = input.runningPlan.segments.map((segment) => {
      const topCandidates =
        input.topCandidatesBySegment.find(
          (group) => group.segmentId === segment.segmentId,
        )?.topCandidates ?? [];
      const selections: OpenAISelectionPlan["segmentPlans"][number]["rankedTrackSelections"] =
        [];

      for (const candidate of topCandidates) {
        if (
          !input.rules.allowTrackReuse &&
          usedTrackIds.has(candidate.trackId)
        ) {
          continue;
        }

        selections.push({
          trackId: candidate.trackId,
          selectedBpmInterpretation: candidate.interpretation,
          metronomePreference: {
            clickStyle: "sharp_beep",
            clickVolume: getSegmentClickVolume(segment),
            accentEvery: 4,
          },
          reason: getCandidateReason(candidate),
        });
        usedTrackIds.add(candidate.trackId);

        if (selections.length >= input.rules.maxTracksPerSegment) {
          break;
        }
      }

      return {
        segmentId: segment.segmentId,
        rankedTrackSelections: selections,
      };
    });

    return {
      mixTitle: `${input.runningPlan.title} mock mix`,
      segmentPlans,
    };
  }
}

export class HttpMixPlannerClient implements MixPlannerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 30000,
  ) {}

  async createSelectionPlan(input: PlannerInput): Promise<OpenAISelectionPlan> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;

    try {
      response = await fetch(
        buildPlannerUrl(this.baseUrl, "/api/openai/mix-plan"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(
          `OpenAI planner timed out after ${Math.round(this.timeoutMs / 1000)} seconds.`,
        );
      }

      throw new Error(
        error instanceof Error
          ? `OpenAI planner request failed: ${error.message}`
          : "OpenAI planner request failed.",
      );
    } finally {
      window.clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(await formatPlannerHttpError(response));
    }

    return response.json() as Promise<OpenAISelectionPlan>;
  }
}

function buildPlannerUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  return normalizedBaseUrl ? `${normalizedBaseUrl}${path}` : path;
}

function isPlannerApiStatus(value: unknown): value is PlannerApiStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value.status === "connected" || value.status === "unavailable") &&
    "model" in value &&
    (typeof value.model === "string" || value.model === null)
  );
}

async function formatPlannerHttpError(response: Response): Promise<string> {
  const fallback = `OpenAI planner request failed: ${response.status} ${response.statusText}`;

  try {
    const body = (await response.json()) as unknown;

    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return `${fallback}: ${body.error}`;
    }
  } catch {
    // The response may not be JSON.
  }

  return fallback;
}

function getSegmentClickVolume(segment: RunSegment): number {
  if (
    segment.name === "warmup" ||
    segment.name === "recovery" ||
    segment.name === "cooldown"
  ) {
    return 0.25;
  }

  if (segment.name === "tempo" || segment.name === "finish") {
    return 0.38;
  }

  return 0.32;
}

function getCandidateReason(candidate: CandidateScore): string {
  return [
    `total ${formatScore(candidate.totalScore)}`,
    `BPM fit ${formatScore(candidate.cadenceFitScore)} at ${candidate.bestCandidateBpm.toFixed(1)} BPM`,
    `energy fit ${formatScore(candidate.energyFitScore)}`,
    `structure fit ${formatScore(candidate.structureFitScore)}`,
    `mood fit ${formatScore(candidate.moodFitScore)}`,
    `stretch ${candidate.requiredStretchPercent.toFixed(1)}%`,
  ].join("; ");
}

function formatScore(value: number): string {
  return Math.round(value).toString();
}
