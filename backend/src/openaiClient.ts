import {
  repairAndValidateOpenAISelectionPlan,
  PlannerOutputValidationError,
} from "./validate.js";
import type {
  CandidateScore,
  OpenAISelectionPlan,
  PlannerInput,
  RunningPlan,
  TrackFeature,
} from "./schemas.js";

const DEFAULT_MODEL = "gpt-5.6-terra";
const RESPONSES_API_URL = "https://api.openai.com/v1/responses";

const SYSTEM_INSTRUCTION = `
You are the Run Tempo Mix Planner, an agentic running audio generator.

You receive:
1. A runner's workout plan.
2. Pre-analyzed audio track features.
3. Precomputed top candidate scores for each workout segment.

Your task:
Choose and rank suitable tracks for each segment.

Hard rules:
- Use only the provided trackIds.
- Do not invent tracks.
- Do not calculate stretchRatio.
- Do not calculate exact block durations.
- Do not output sourceStartSec, sourceEndSec, mixStartSec, or mixEndSec.
- Do not claim to listen to the audio.
- Prefer candidates with high totalScore.
- Prefer BPM candidates close to targetCadence.
- Tracks marked sourceKind "standardized" already contain their cadence click; treat their 1:1 embeddedCadenceBpm as authoritative.
- Confirmed-click tracks may change by at most 5%. Exclude them beyond that limit.
- Tracks without a confirmed click remain selectable at any stretch; over 15% is a warning, not a hard exclusion.
- Prefer lower energy for warmup/cooldown.
- Prefer higher energy for finish/tempo.
- Use structureFitScore and moodFitScore alongside cadence and energy.
- Prefer harmonically compatible consecutive musicalKey values when quality is comparable.
- Do not use tempo stability as a planning factor; RunTempo adds a cadence click later.
- Respect allowTrackReuse.
- Respect allowLoop. If it is true, return a strong unique ranking; the app can repeat the ranked tracks if the target duration is longer than the available audio.
- Respect maxTracksPerSegment.
- Avoid selecting a track again inside minRepeatGapTracks whenever the candidate pool allows it.
- When preferFolderVariety is true, prefer alternating source folders when quality is comparable.
- Use metronomePreference.clickStyle "sharp_beep" and accentEvery 4 for every selection.
- Return JSON only matching the schema.
`.trim();

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mixTitle", "segmentPlans"],
  properties: {
    mixTitle: { type: "string" },
    segmentPlans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["segmentId", "rankedTrackSelections"],
        properties: {
          segmentId: { type: "string" },
          rankedTrackSelections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "trackId",
                "selectedBpmInterpretation",
                "metronomePreference",
                "reason",
              ],
              properties: {
                trackId: { type: "string" },
                selectedBpmInterpretation: {
                  type: "string",
                  enum: ["1:2", "2:3", "1:1", "3:2", "2:1"],
                },
                metronomePreference: {
                  type: "object",
                  additionalProperties: false,
                  required: ["clickStyle", "clickVolume", "accentEvery"],
                  properties: {
                    clickStyle: {
                      type: "string",
                      enum: ["sharp_beep"],
                    },
                    clickVolume: { type: "number", minimum: 0.1, maximum: 1 },
                    accentEvery: { type: "integer", enum: [4] },
                  },
                },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export class OpenAIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIConfigurationError";
  }
}

export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

export async function createOpenAISelectionPlan(
  input: PlannerInput,
): Promise<OpenAISelectionPlan> {
  const apiKey = getOpenAIApiKey();
  const model = getOpenAIModel();
  const prompt = buildUserPrompt(input);
  const response = await callOpenAI(apiKey, model, prompt);
  const rawOutput = extractStructuredOutput(response);

  return repairAndValidateOpenAISelectionPlan(rawOutput, input);
}

function getOpenAIApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new OpenAIConfigurationError(
      "OPENAI_API_KEY is not configured for the planner backend.",
    );
  }

  return apiKey;
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<unknown> {
  const response = await fetch(
    process.env.OPENAI_BASE_URL?.trim() || RESPONSES_API_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        instructions: SYSTEM_INSTRUCTION,
        input: prompt,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "run_tempo_mix_plan",
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new OpenAIConfigurationError(
      `OpenAI Responses API request failed: ${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }

  return response.json();
}

function buildUserPrompt(input: PlannerInput): string {
  return [
    "Planner input JSON:",
    JSON.stringify(buildPromptPayload(input), null, 2),
  ].join("\n");
}

function buildPromptPayload(input: PlannerInput) {
  const tracksById = new Map(input.tracks.map((track) => [track.trackId, track]));

  return {
    runningPlan: minimizeRunningPlan(input.runningPlan),
    rules: input.rules,
    topCandidatesBySegment: input.topCandidatesBySegment.map((group) => ({
      segmentId: group.segmentId,
      topCandidates: group.topCandidates.map((candidate) =>
        minimizeCandidate(candidate, tracksById.get(candidate.trackId)),
      ),
    })),
  };
}

function minimizeRunningPlan(runningPlan: RunningPlan) {
  return {
    planId: runningPlan.planId,
    title: runningPlan.title,
    totalDurationSec: runningPlan.totalDurationSec,
    segments: runningPlan.segments.map((segment) => ({
      segmentId: segment.segmentId,
      name: segment.name,
      startSec: segment.startSec,
      endSec: segment.endSec,
      targetCadence: segment.targetCadence,
      cadenceRamp: segment.cadenceRamp,
      targetEnergyRange: segment.targetEnergyRange,
      maxStretchPercent: segment.maxStretchPercent,
    })),
  };
}

function minimizeCandidate(candidate: CandidateScore, track: TrackFeature | undefined) {
  return {
    trackId: candidate.trackId,
    fileName: track?.fileName ?? candidate.trackId,
    durationSec: track?.durationSec ?? null,
    sourceKind: track?.sourceKind ?? "raw",
    embeddedCadenceBpm: track?.embeddedCadenceBpm ?? null,
    bestCandidateBpm: candidate.bestCandidateBpm,
    interpretation: candidate.interpretation,
    normalizedEnergyScore: track?.normalizedEnergyScore ?? null,
    musicalKey: track?.musicalKey ?? null,
    mood: track?.mood ?? null,
    energyStructure: track?.energyStructure ?? null,
    totalScore: candidate.totalScore,
    cadenceFitScore: candidate.cadenceFitScore,
    energyFitScore: candidate.energyFitScore,
    structureFitScore: candidate.structureFitScore,
    moodFitScore: candidate.moodFitScore,
    requiredStretchPercent: candidate.requiredStretchPercent,
  };
}

function extractStructuredOutput(response: unknown): unknown {
  const parsedOutput = findParsedOutput(response);

  if (parsedOutput !== undefined) {
    return parsedOutput;
  }

  const responseText = extractResponseText(response);
  return parseJsonResponse(responseText);
}

function findParsedOutput(response: unknown): unknown {
  if (!isRecord(response)) {
    return undefined;
  }

  if (response.output_parsed !== undefined) {
    return response.output_parsed;
  }

  if (response.parsed !== undefined) {
    return response.parsed;
  }

  return undefined;
}

function extractResponseText(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (!isRecord(response)) {
    throw new PlannerOutputValidationError(
      "OpenAI returned an unsupported response shape.",
    );
  }

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  if (typeof response.text === "string") {
    return response.text;
  }

  if (typeof response.text === "function") {
    const value = response.text();

    if (typeof value === "string") {
      return value;
    }
  }

  const candidateText = extractCandidateText(response);

  if (candidateText) {
    return candidateText;
  }

  throw new PlannerOutputValidationError(
    "OpenAI response did not contain JSON text.",
  );
}

function extractCandidateText(response: Record<string, unknown>): string | null {
  if (!Array.isArray(response.candidates)) {
    return null;
  }

  for (const candidate of response.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) {
      continue;
    }

    const parts = candidate.content.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    const text = parts
      .flatMap((part) =>
        isRecord(part) && typeof part.text === "string" ? [part.text] : [],
      )
      .join("");

    if (text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

function parseJsonResponse(text: string): unknown {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new PlannerOutputValidationError(
      error instanceof Error
        ? `OpenAI returned invalid JSON: ${error.message}`
        : "OpenAI returned invalid JSON.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
