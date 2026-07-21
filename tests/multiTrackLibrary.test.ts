import assert from "node:assert/strict";
import test from "node:test";
import {
  createStandardizedBpmCandidates,
  parseStandardizedTrackCadence,
  readRunTempoWavMetadata,
} from "../src/audio/standardizedTrackLibrary";
import { audioBufferToWavBlob } from "../src/audio/exportWav";
import { detectEmbeddedClick } from "../src/audio/detectEmbeddedClick";
import { analyzeMusicalKey } from "../src/audio/analyzeMusicalKey";
import { addMetronomeGrid } from "../src/audio/createClickSamples";
import {
  buildRunningPlanFromSettings,
  DEFAULT_RUNNING_PLAN_SETTINGS,
} from "../src/domain/runningPlanBuilder";
import type {
  OpenAISelectionPlan,
  RunningPlan,
  TrackFeature,
} from "../src/domain/mixTypes";
import { buildExecutableMixPlan } from "../src/planning/buildExecutableMixPlan";
import { scoreTrackForSegment } from "../src/planning/scoreCandidates";
import { getTopCandidatesBySegment } from "../src/planning/scoreCandidates";
import { analyzeLibraryCoverage } from "../src/planning/analyzeLibraryCoverage";
import { createMixPlanVariants } from "../src/planning/createMixPlanVariants";
import {
  moveSelection,
} from "../src/planning/editSelectionPlan";
import {
  createMultiTrackDefaultName,
  normalizeMultiTrackWavFileName,
} from "../src/utils/multiTrackExport";

const runningPlan: RunningPlan = {
  planId: "test",
  title: "Test run",
  totalDurationSec: 120,
  segments: [
    {
      segmentId: "steady",
      name: "steady",
      startSec: 0,
      endSec: 120,
      targetCadence: 180,
      targetEnergyRange: { min: 40, max: 70 },
      maxStretchPercent: 5,
    },
  ],
};

test("multi-track export name uses plan mode, time, and planning direction", () => {
  assert.equal(
    createMultiTrackDefaultName("Constant", 15 * 60, "Balanced"),
    "Constant_15min_Balanced",
  );
  assert.equal(
    createMultiTrackDefaultName("Intervals", 30 * 60 + 15, "Energy flow"),
    "Intervals_30m15s_Energy-flow",
  );
  assert.equal(
    normalizeMultiTrackWavFileName(
      "Constant/15min:Balanced",
      "Constant_15min_Balanced.wav",
    ),
    "Constant_15min_Balanced.wav",
  );
});

test("standardized cadence is read from Single Track output names", () => {
  assert.equal(parseStandardizedTrackCadence("Morning Run_180bpm.wav"), 180);
  assert.equal(parseStandardizedTrackCadence("Tempo_172.5BPM.WAV"), 172.5);
  assert.equal(parseStandardizedTrackCadence("Morning Run.wav"), null);
  assert.equal(parseStandardizedTrackCadence("Morning Run_300bpm.wav"), null);
});

test("musical key analysis recognizes a synthetic C major triad", () => {
  const sampleRate = 11025;
  const samples = new Float32Array(sampleRate * 12);
  const frequencies = [261.6256, 329.6276, 391.9954];
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = frequencies.reduce(
      (sum, frequency) => sum + Math.sin((2 * Math.PI * frequency * index) / sampleRate),
      0,
    ) / frequencies.length;
  }
  const audioBuffer = {
    sampleRate,
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as AudioBuffer;

  const result = analyzeMusicalKey(audioBuffer);
  assert.equal(result?.tonic, "C");
  assert.equal(result?.mode, "major");
});

test("standardized tracks expose only their authoritative 1:1 cadence", () => {
  assert.deepEqual(createStandardizedBpmCandidates(180), [
    { bpm: 180, interpretation: "1:1" },
  ]);
});

test("standardized blocks keep their embedded click instead of adding one", () => {
  const track = createTrack("standardized", 180);
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [track],
    selectionPlan: createSelectionPlan(track.trackId),
    crossfadeSec: 6,
    allowLoop: true,
  });

  assert.ok(plan.blocks.length > 0);
  assert.ok(plan.blocks.every((block) => block.metronome.enabled === false));
});

test("click detector marks a repeating sharp click as suspected", () => {
  const sampleRate = 12_000;
  const channel = new Float32Array(sampleRate * 20);
  addMetronomeGrid({
    outputChannels: [channel],
    sampleRate,
    startSec: 0,
    endSec: 20,
    targetCadence: 180,
    clickStyle: "sharp_beep",
    clickVolume: 1,
    accentEvery: 0,
    gain: 1,
  });
  const audioBuffer = {
    duration: 20,
    length: channel.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => channel,
  } as unknown as AudioBuffer;

  const detection = detectEmbeddedClick(audioBuffer, 180);
  assert.equal(detection.status, "suspected");
  assert.ok(detection.confidence >= 0.58);
});

test("raw blocks still receive a generated click", () => {
  const track = createTrack("raw", 180);
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [track],
    selectionPlan: createSelectionPlan(track.trackId),
    crossfadeSec: 6,
    allowLoop: true,
  });

  assert.ok(plan.blocks.length > 0);
  assert.ok(plan.blocks.every((block) => block.metronome.enabled === true));
});

test("tracks with an embedded click only cover BPM adjustments within 5%", () => {
  assert.equal(
    scoreTrackForSegment(createTrack("standardized", 160), runningPlan.segments[0]),
    null,
  );
  assert.equal(
    scoreTrackForSegment(createTrack("standardized", 140), runningPlan.segments[0]),
    null,
  );
  assert.equal(scoreTrackForSegment(createTrack("standardized", 170), runningPlan.segments[0]), null);
  assert.ok(scoreTrackForSegment(createTrack("standardized", 172), runningPlan.segments[0]));
  assert.ok(scoreTrackForSegment(createTrack("standardized", 180), runningPlan.segments[0]));
  assert.ok(scoreTrackForSegment(createTrack("raw", 140), runningPlan.segments[0]));

  const confirmedRaw = {
    ...createTrack("raw", 90),
    embeddedClickStatus: "confirmed" as const,
    bpmCandidates: [
      { bpm: 90, interpretation: "1:1" as const },
      { bpm: 180, interpretation: "2:1" as const },
    ],
  };
  assert.equal(scoreTrackForSegment(confirmedRaw, runningPlan.segments[0]), null);
});

test("cadence fit uses relative tempo change instead of absolute BPM difference", () => {
  const lowTarget = {
    ...runningPlan.segments[0],
    targetCadence: 100,
  };
  const highTarget = {
    ...runningPlan.segments[0],
    targetCadence: 200,
  };
  const lowScore = scoreTrackForSegment(createTrack("raw", 90), lowTarget);
  const highScore = scoreTrackForSegment(createTrack("raw", 180), highTarget);

  assert.ok(lowScore);
  assert.ok(highScore);
  assert.ok(Math.abs(lowScore.cadenceFitScore - highScore.cadenceFitScore) < 0.001);
});

test("renderer rejects a manually selected embedded-click track beyond 5%", () => {
  const track = createTrack("standardized", 160);
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [track],
    selectionPlan: createSelectionPlan(track.trackId),
    crossfadeSec: 6,
    allowLoop: true,
  });
  assert.deepEqual(plan.blocks, []);
});

test("empty segment selections do not crash or create invalid blocks", () => {
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [createTrack("raw", 180)],
    selectionPlan: { mixTitle: "Empty", segmentPlans: [{ segmentId: "steady", rankedTrackSelections: [] }] },
    crossfadeSec: 6,
    allowLoop: true,
  });

  assert.deepEqual(plan.blocks, []);
  assert.equal(plan.totalDurationSec, runningPlan.totalDurationSec);
});

test("blocks are clipped to the segment and crossfades really overlap", () => {
  const track = { ...createTrack("raw", 180), durationSec: 40 };
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [track],
    selectionPlan: createSelectionPlan(track.trackId),
    crossfadeSec: 6,
    allowLoop: true,
  });

  assert.ok(plan.blocks.length > 1);
  assert.equal(plan.blocks.at(-1)?.mixEndSec, 120);
  assert.equal(plan.totalDurationSec, 120);
  assert.ok(plan.blocks[1].mixStartSec < plan.blocks[0].mixEndSec);
  assert.ok(plan.blocks[1].transition.crossfadeWithPreviousSec > 0);
  assert.ok(plan.blocks.every((block) => block.sourceEndSec <= track.durationSec));
});

test("the final song can finish beyond the plan when trimming is disabled", () => {
  const track = { ...createTrack("raw", 180), durationSec: 150 };
  const plan = buildExecutableMixPlan({
    runningPlan,
    tracks: [track],
    selectionPlan: createSelectionPlan(track.trackId),
    crossfadeSec: 6,
    allowLoop: true,
    trimToPlanDuration: false,
  });

  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.blocks[0].mixEndSec, 150);
  assert.equal(plan.blocks[0].sourceEndSec, 150);
  assert.equal(plan.totalDurationSec, 150);
});

test("progressive cadence is discretized into selectable fixed steps", () => {
  const plan = buildRunningPlanFromSettings({
    ...DEFAULT_RUNNING_PLAN_SETTINGS,
    mode: "progressive",
  });
  const progressiveSteps = plan.segments.filter((segment) =>
    segment.segmentId.startsWith("progressive-build-"),
  );

  assert.ok(progressiveSteps.length > 1);
  assert.ok(progressiveSteps.every((segment) => segment.cadenceRamp === undefined));
  for (let index = 1; index < progressiveSteps.length; index += 1) {
    assert.ok(
      Math.abs(progressiveSteps[index].targetCadence - progressiveSteps[index - 1].targetCadence) <= 5,
    );
  }
});

test("custom plan preserves part order, duration, type, and BPM", () => {
  const plan = buildRunningPlanFromSettings({
    ...DEFAULT_RUNNING_PLAN_SETTINGS,
    mode: "custom",
    custom: {
      parts: [
        { partId: "one", name: "warmup", durationMin: 3, bpm: 175 },
        { partId: "two", name: "tempo", durationMin: 4.5, bpm: 190 },
        { partId: "three", name: "cooldown", durationMin: 2, bpm: 180 },
      ],
    },
  });

  assert.equal(plan.totalDurationSec, 9.5 * 60);
  assert.deepEqual(plan.segments.map((segment) => segment.name), [
    "warmup", "tempo", "cooldown",
  ]);
  assert.deepEqual(plan.segments.map((segment) => segment.targetCadence), [
    175, 190, 180,
  ]);
});

test("RunTempo WAV metadata survives export and can drive folder import", async () => {
  const audioBuffer = {
    numberOfChannels: 1,
    sampleRate: 44_100,
    length: 1,
    getChannelData: () => new Float32Array([0]),
  } as AudioBuffer;
  const blob = audioBufferToWavBlob(audioBuffer, {
    runTempo: {
      version: 1,
      cadenceBpm: 176,
      clickEmbedded: true,
      clickStyle: "sharp",
      accentEvery: 2,
      clickVolume: 0.8,
      rawEnergyFeatures: { rms: 0.2, onsetDensity: 1.5, spectralCentroid: 0.4 },
    },
  });
  const file = Object.assign(blob, { name: "track-without-bpm.wav" }) as File;
  const metadata = await readRunTempoWavMetadata(file);

  assert.equal(metadata?.cadenceBpm, 176);
  assert.equal(metadata?.rawEnergyFeatures?.rms, 0.2);
});

test("coverage rejects locked-click stretches and warns above 15% for raw tracks", () => {
  const plan: RunningPlan = {
    planId: "coverage",
    title: "Coverage",
    totalDurationSec: 120,
    segments: [
      { ...runningPlan.segments[0], segmentId: "s170", endSec: 60, targetCadence: 170 },
      { ...runningPlan.segments[0], segmentId: "s220", startSec: 60, targetCadence: 220 },
    ],
  };
  const tracks = [createTrack("standardized", 170), createTrack("standardized", 172)];
  const candidateGroups = getTopCandidatesBySegment(tracks, plan, 10);
  const report = analyzeLibraryCoverage({ runningPlan: plan, tracks, candidateGroups });

  assert.deepEqual(report.missingCadences, [220]);
  assert.deepEqual(report.thinCadences, []);
  assert.deepEqual(report.riskyCadences, []);
  assert.equal(report.coveragePercent, 50);

  const rawTracks = [createTrack("raw", 170)];
  const rawCandidateGroups = getTopCandidatesBySegment(rawTracks, plan, 10);
  const rawReport = analyzeLibraryCoverage({
    runningPlan: plan,
    tracks: rawTracks,
    candidateGroups: rawCandidateGroups,
  });
  assert.deepEqual(rawReport.missingCadences, []);
  assert.deepEqual(rawReport.riskyCadences, [220]);
  assert.equal(rawReport.coveragePercent, 100);
});

test("three variants apply a global repeat gap across segment boundaries", () => {
  const plan: RunningPlan = {
    planId: "global-order",
    title: "Global order",
    totalDurationSec: 180,
    segments: ["a", "b", "c"].map((segmentId, index) => ({
      ...runningPlan.segments[0],
      segmentId,
      startSec: index * 60,
      endSec: (index + 1) * 60,
    })),
  };
  const tracks = [1, 2, 3, 4].map((index) => ({
    ...createTrack("standardized", 180),
    trackId: `track-${index}`,
    importKey: `track-${index}`,
    fileName: `Track ${index}_180bpm.wav`,
    relativePath: `Album ${index % 2}/Track ${index}_180bpm.wav`,
    normalizedEnergyScore: 35 + index * 15,
  }));
  const candidateGroups = getTopCandidatesBySegment(tracks, plan, 10);
  const variants = createMixPlanVariants({
    runningPlan: plan,
    tracks,
    candidateGroups,
    rules: {
      minRepeatGapTracks: 2,
      maxTracksPerSegment: 2,
      preferFolderVariety: true,
    },
  });

  assert.deepEqual(variants.map((variant) => variant.variantId), [
    "balanced",
    "energy",
    "variety",
  ]);

  for (const variant of variants) {
    const sequence = variant.selectionPlan.segmentPlans.flatMap((segment) =>
      segment.rankedTrackSelections.map((selection) => selection.trackId),
    );

    sequence.forEach((trackId, index) => {
      assert.ok(!sequence.slice(Math.max(0, index - 2), index).includes(trackId));
    });
  }
});

test("variant track counts adapt to each segment duration", () => {
  const plan: RunningPlan = {
    planId: "duration-aware",
    title: "Duration aware",
    totalDurationSec: 720,
    segments: [
      {
        ...runningPlan.segments[0],
        segmentId: "short",
        startSec: 0,
        endSec: 120,
      },
      {
        ...runningPlan.segments[0],
        segmentId: "long",
        startSec: 120,
        endSec: 720,
      },
    ],
  };
  const tracks = [1, 2, 3, 4, 5, 6].map((index) => ({
    ...createTrack("raw", 180),
    trackId: `duration-${index}`,
    importKey: `duration-${index}`,
    fileName: `Duration ${index}.wav`,
    durationSec: 180,
  }));
  const variants = createMixPlanVariants({
    runningPlan: plan,
    tracks,
    candidateGroups: getTopCandidatesBySegment(tracks, plan, 10),
    rules: {
      minRepeatGapTracks: 2,
      maxTracksPerSegment: 10,
      preferFolderVariety: true,
    },
  });

  for (const variant of variants) {
    const shortCount = variant.selectionPlan.segmentPlans.find(
      (segment) => segment.segmentId === "short",
    )?.rankedTrackSelections.length;
    const longCount = variant.selectionPlan.segmentPlans.find(
      (segment) => segment.segmentId === "long",
    )?.rankedTrackSelections.length;
    assert.equal(shortCount, 1);
    assert.ok((longCount ?? 0) >= 4);
  }
});

test("GPT preferred ranking guides all three variants", () => {
  const tracks = ["a", "b"].map((trackId) => ({
    ...createTrack("raw", 180),
    trackId,
    importKey: trackId,
    fileName: `${trackId}.wav`,
    durationSec: 180,
  }));
  const preferredSelectionPlan: OpenAISelectionPlan = {
    mixTitle: "GPT preference",
    segmentPlans: [
      {
        segmentId: "steady",
        rankedTrackSelections: ["b", "a"].map((trackId) => ({
          trackId,
          selectedBpmInterpretation: "1:1" as const,
          metronomePreference: {
            clickStyle: "sharp_beep" as const,
            clickVolume: 0.36,
            accentEvery: 4 as const,
          },
          reason: "GPT rank",
        })),
      },
    ],
  };
  const variants = createMixPlanVariants({
    runningPlan,
    tracks,
    candidateGroups: getTopCandidatesBySegment(tracks, runningPlan, 10),
    rules: {
      minRepeatGapTracks: 2,
      maxTracksPerSegment: 10,
      preferFolderVariety: true,
    },
    preferredSelectionPlan,
  });

  for (const variant of variants) {
    assert.equal(
      variant.selectionPlan.segmentPlans[0].rankedTrackSelections[0]?.trackId,
      "b",
    );
  }
});

test("drag reorder updates a segment deterministically", () => {
  const current = createPlanWithTrackIds(["a", "b"]);
  const moved = moveSelection(current, "steady", 1, 0);
  assert.deepEqual(
    moved.segmentPlans[0].rankedTrackSelections.map((item) => item.trackId),
    ["b", "a"],
  );
});

function createTrack(
  sourceKind: TrackFeature["sourceKind"],
  cadence: number,
): TrackFeature {
  return {
    trackId: `${sourceKind}-${cadence}`,
    importKey: `${sourceKind}-${cadence}`,
    fileName: `Track_${cadence}bpm.wav`,
    relativePath: null,
    sourceKind,
    embeddedCadenceBpm: sourceKind === "standardized" ? cadence : null,
    durationSec: 120,
    detectedBpm: cadence,
    bpmCandidates: [{ bpm: cadence, interpretation: "1:1" }],
    beatConfidence: sourceKind === "standardized" ? 1 : null,
    tempoStability: sourceKind === "standardized" ? 1 : null,
    rawEnergyFeatures: null,
    normalizedEnergyScore: 55,
  };
}

function createSelectionPlan(trackId: string): OpenAISelectionPlan {
  return {
    mixTitle: "Test mix",
    segmentPlans: [
      {
        segmentId: "steady",
        rankedTrackSelections: [
          {
            trackId,
            selectedBpmInterpretation: "1:1",
            metronomePreference: {
              clickStyle: "sharp_beep",
              clickVolume: 0.36,
              accentEvery: 4,
            },
            reason: "test",
          },
        ],
      },
    ],
  };
}

function createPlanWithTrackIds(trackIds: string[]): OpenAISelectionPlan {
  return {
    mixTitle: "Editable",
    segmentPlans: [
      {
        segmentId: "steady",
        rankedTrackSelections: trackIds.map((trackId) => ({
          trackId,
          selectedBpmInterpretation: "1:1" as const,
          metronomePreference: {
            clickStyle: "sharp_beep" as const,
            clickVolume: 0.36,
            accentEvery: 4 as const,
          },
          reason: "test",
        })),
      },
    ],
  };
}
