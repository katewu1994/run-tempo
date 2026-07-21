import assert from "node:assert/strict";
import test from "node:test";
import {
  createStandardizedBpmCandidates,
  parseStandardizedTrackCadence,
  readRunTempoWavMetadata,
} from "../src/audio/standardizedTrackLibrary";
import { audioBufferToWavBlob } from "../src/audio/exportWav";
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
  getLockedSelectionKey,
  mergeLockedSelections,
  moveSelection,
  replaceSelection,
} from "../src/planning/editSelectionPlan";

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

test("standardized cadence is read from Single Track output names", () => {
  assert.equal(parseStandardizedTrackCadence("Morning Run_180bpm.wav"), 180);
  assert.equal(parseStandardizedTrackCadence("Tempo_172.5BPM.WAV"), 172.5);
  assert.equal(parseStandardizedTrackCadence("Morning Run.wav"), null);
  assert.equal(parseStandardizedTrackCadence("Morning Run_300bpm.wav"), null);
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

test("standardized tracks outside the safe stretch range are not candidates", () => {
  assert.equal(
    scoreTrackForSegment(createTrack("standardized", 160), runningPlan.segments[0]),
    null,
  );
  assert.equal(
    scoreTrackForSegment(createTrack("standardized", 178), runningPlan.segments[0]),
    null,
  );
  assert.ok(scoreTrackForSegment(createTrack("standardized", 180), runningPlan.segments[0]));
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

test("coverage report separates missing, thin and covered cadences", () => {
  const plan: RunningPlan = {
    planId: "coverage",
    title: "Coverage",
    totalDurationSec: 120,
    segments: [
      { ...runningPlan.segments[0], segmentId: "s170", endSec: 60, targetCadence: 170 },
      { ...runningPlan.segments[0], segmentId: "s180", startSec: 60 },
    ],
  };
  const tracks = [createTrack("standardized", 170)];
  const candidateGroups = getTopCandidatesBySegment(tracks, plan, 10);
  const report = analyzeLibraryCoverage({ runningPlan: plan, tracks, candidateGroups });

  assert.deepEqual(report.missingCadences, [180]);
  assert.deepEqual(report.thinCadences, [170]);
  assert.equal(report.coveragePercent, 50);
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

test("locked tracks survive variant switching and sequence edits are deterministic", () => {
  const current = createPlanWithTrackIds(["a", "b"]);
  const target = createPlanWithTrackIds(["c", "d"]);
  const merged = mergeLockedSelections({
    currentPlan: current,
    targetPlan: target,
    lockedSelectionKeys: new Set([getLockedSelectionKey("steady", "b")]),
  });

  assert.deepEqual(
    merged.segmentPlans[0].rankedTrackSelections.map((item) => item.trackId),
    ["c", "b"],
  );

  const moved = moveSelection(merged, "steady", 1, 0);
  assert.deepEqual(
    moved.segmentPlans[0].rankedTrackSelections.map((item) => item.trackId),
    ["b", "c"],
  );

  const replaced = replaceSelection(moved, "steady", 1, {
    segmentId: "steady",
    trackId: "e",
    bestCandidateBpm: 180,
    interpretation: "1:1",
    cadenceFitScore: 100,
    energyFitScore: 90,
    stabilityScore: 100,
    stretchRiskScore: 100,
    totalScore: 97,
    requiredStretchPercent: 0,
  });
  assert.equal(replaced.segmentPlans[0].rankedTrackSelections[1].trackId, "e");
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
