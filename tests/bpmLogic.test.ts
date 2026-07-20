import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEssentiaConsensus,
  buildTempoCnnEstimate,
  calculateIntervalStability,
  getTempoConfidenceLevel,
  mergeTempoAnalyses,
} from "../src/audio/bpmAnalysisMath";
import {
  getClickTempoBpm,
  getClickTempoOptions,
  getDetectorComparisonScores,
  getRecommendedClickSetup,
  getSingleTrackBpmCandidates,
  getSingleTrackBpmDecision,
} from "../src/audio/bpmCandidates";
import { analyzeSingleTrackChannels } from "../src/audio/singleTrackBpmCore";
import { getTempoRatio } from "../src/audio/tempo";

test("single-track candidates contain octave equivalents only", () => {
  assert.deepEqual(
    getSingleTrackBpmCandidates(120).map((candidate) => candidate.value),
    [60, 120, 240],
  );
});

test("confidence levels follow the Essentia multifeature guidance", () => {
  assert.equal(getTempoConfidenceLevel(null), "unavailable");
  assert.equal(getTempoConfidenceLevel(0.99), "very_low");
  assert.equal(getTempoConfidenceLevel(1.5), "low");
  assert.equal(getTempoConfidenceLevel(1.51), "good");
  assert.equal(getTempoConfidenceLevel(3.51), "excellent");
});

test("interval stability separates a steady pulse from tempo drift", () => {
  const steady = calculateIntervalStability([0.5, 0.501, 0.499, 0.5, 0.502]);
  const drifting = calculateIntervalStability([0.35, 0.45, 0.6, 0.75, 0.9]);

  assert.ok(steady !== null && steady > 0.95);
  assert.ok(drifting !== null && drifting < 0.3);
});

test("window consensus treats half-time and double-time as one tempo family", () => {
  const analysis = buildEssentiaConsensus([
    { bpm: 90, confidence: 2.8, intervalStability: 0.94 },
    { bpm: 180, confidence: 3, intervalStability: 0.96 },
    { bpm: 89.8, confidence: 2.6, intervalStability: 0.93 },
  ]);

  assert.ok(analysis);
  assert.ok(analysis.bpm !== null && Math.abs(analysis.bpm - 180) < 1);
  assert.equal(analysis.isReliable, true);
});

test("conflicting tempo families require manual confirmation", () => {
  const analysis = buildEssentiaConsensus([
    { bpm: 120, confidence: 4, intervalStability: 0.95 },
    { bpm: 180, confidence: 4, intervalStability: 0.95 },
    { bpm: 75, confidence: 4, intervalStability: 0.95 },
  ]);

  assert.ok(analysis);
  assert.equal(analysis.isReliable, false);
});

test("low-confidence consensus is never auto-accepted", () => {
  const analysis = buildEssentiaConsensus([
    { bpm: 172, confidence: 1.2, intervalStability: 0.98 },
    { bpm: 171.8, confidence: 1.3, intervalStability: 0.97 },
  ]);

  assert.ok(analysis);
  assert.equal(analysis.confidenceLevel, "low");
  assert.equal(analysis.isReliable, false);
});

test("TempoCNN aggregates octave-equivalent local estimates", () => {
  const estimate = buildTempoCnnEstimate([
    { bpm: 90, probability: 0.82 },
    { bpm: 180, probability: 0.88 },
    { bpm: 179, probability: 0.74 },
  ]);

  assert.ok(estimate);
  assert.ok(Math.abs(estimate.bpm - 180) <= 1);
  assert.ok(estimate.stability > 0.95);
  assert.equal(estimate.localEstimateCount, 3);
});

test("agreeing Essentia and TempoCNN results can promote a low result", () => {
  const primary = buildEssentiaConsensus([
    { bpm: 120, confidence: 1.2, intervalStability: 0.9 },
    { bpm: 120.4, confidence: 1.25, intervalStability: 0.92 },
  ]);
  const tempoCnn = buildTempoCnnEstimate([
    { bpm: 120, probability: 0.76 },
    { bpm: 121, probability: 0.72 },
    { bpm: 120, probability: 0.8 },
  ]);
  const merged = mergeTempoAnalyses(primary, tempoCnn);

  assert.ok(merged);
  assert.equal(merged.method, "essentia_tempocnn_hybrid");
  assert.equal(merged.detectorAgreement, true);
  assert.equal(merged.isReliable, true);
});

test("detector disagreement is never marked as reliable", () => {
  const primary = buildEssentiaConsensus([
    { bpm: 120, confidence: 1.4, intervalStability: 0.9 },
    { bpm: 120.2, confidence: 1.3, intervalStability: 0.9 },
  ]);
  const tempoCnn = buildTempoCnnEstimate([
    { bpm: 150, probability: 0.92 },
    { bpm: 150, probability: 0.9 },
  ]);
  const merged = mergeTempoAnalyses(primary, tempoCnn);

  assert.ok(merged);
  assert.equal(merged.detectorAgreement, false);
  assert.equal(merged.isReliable, false);
});

test("detector disagreement still produces a preselected audition candidate", () => {
  const primary = buildEssentiaConsensus([
    { bpm: 120, confidence: 1.1, intervalStability: 0.72 },
  ]);
  const tempoCnn = buildTempoCnnEstimate([
    { bpm: 150, probability: 0.9 },
    { bpm: 150, probability: 0.88 },
  ]);
  const merged = mergeTempoAnalyses(primary, tempoCnn);
  const decision = getSingleTrackBpmDecision(merged);

  assert.ok(merged);
  assert.equal(merged.detectorAgreement, false);
  assert.equal(decision.recommendedDetector, "tempocnn");
  assert.ok(
    decision.detectors.some(
      (detector) => detector.source === "essentia" && detector.bpm === 120,
    ),
  );
  assert.ok(
    decision.detectors.some(
      (detector) => detector.source === "tempocnn" && detector.bpm === 150,
    ),
  );
  assert.equal(
    decision.detectors.find((detector) => detector.source === "tempocnn")
      ?.recommended,
    true,
  );
});

test("the higher-confidence detector wins even when the other needs less stretch", () => {
  const primary = buildEssentiaConsensus([
    { bpm: 120, confidence: 1.5, intervalStability: 0.95 },
  ]);
  const tempoCnn = buildTempoCnnEstimate([
    { bpm: 150, probability: 0.35 },
    { bpm: 150, probability: 0.34 },
  ]);
  const merged = mergeTempoAnalyses(primary, tempoCnn);
  const decision = getSingleTrackBpmDecision(merged);

  assert.ok(merged);
  const scores = getDetectorComparisonScores(merged);
  assert.equal(merged.detectorAgreement, false);
  assert.ok(scores.essentia > scores.tempocnn);
  assert.ok(scores.essentia >= 0 && scores.essentia <= 1);
  assert.ok(scores.tempocnn >= 0 && scores.tempocnn <= 1);
  assert.equal(decision.recommendedDetector, "essentia");
  assert.equal(
    decision.detectors.find((detector) => detector.source === "essentia")
      ?.recommended,
    true,
  );
});

test("target cadence recommends a click relationship without changing the detector BPM", () => {
  const options = getClickTempoOptions(60, 180);

  assert.deepEqual(
    options.filter((option) => !option.advanced).map((option) => option.relation),
    ["1:1", "2:1", "3:1"],
  );
  assert.deepEqual(
    options.filter((option) => option.advanced).map((option) => option.relation),
    ["3:2"],
  );
  assert.equal(
    options.find((option) => option.relation === "3:1")?.recommended,
    true,
  );
  assert.equal(
    options.find((option) => option.relation === "3:1")?.bpm,
    180,
  );
});

test("click relationships derive metronome tempo from an unchanged song pulse", () => {
  assert.equal(getClickTempoBpm(60, "1:1"), 60);
  assert.equal(getClickTempoBpm(60, "2:1"), 120);
  assert.equal(getClickTempoBpm(60, "3:1"), 180);
  assert.equal(getClickTempoBpm(60, "3:2"), 90);
  assert.equal(getClickTempoBpm(120, "3:1"), 360);
});

test("3:1 remains available across the detector BPM range", () => {
  const options = getClickTempoOptions(180, 180);

  assert.equal(
    options.find((option) => option.relation === "3:1")?.bpm,
    540,
  );
});

test("target cadence derives the song speed needed by the selected click relationship", () => {
  const sourceClickBpm = 150;
  const targetCadence = 180;
  const tempoRatio = getTempoRatio(sourceClickBpm, targetCadence);

  assert.equal(tempoRatio, 1.2);
  assert.equal(sourceClickBpm * tempoRatio, targetCadence);
  assert.equal(getTempoRatio(720, 180), 0.25);
});

test("target cadence selects a relationship within the highest-confidence detector", () => {
  const recommendation = getRecommendedClickSetup(
    [
      {
        source: "essentia",
        bpm: 60,
        comparisonScore: 0.82,
        recommended: true,
      },
      {
        source: "tempocnn",
        bpm: 90,
        comparisonScore: 0.48,
        recommended: false,
      },
    ],
    180,
  );

  assert.ok(recommendation);
  assert.equal(recommendation.source, "essentia");
  assert.equal(recommendation.relation, "3:1");
  assert.equal(recommendation.clickBpm, 180);
});

test("detector confidence wins before an exact cadence match from a weaker model", () => {
  const recommendation = getRecommendedClickSetup(
    [
      {
        source: "essentia",
        bpm: 50,
        comparisonScore: 0.51,
        recommended: true,
      },
      {
        source: "tempocnn",
        bpm: 95,
        comparisonScore: 0.5,
        recommended: false,
      },
    ],
    190,
  );

  assert.ok(recommendation);
  assert.equal(recommendation.source, "essentia");
  assert.equal(recommendation.relation, "3:1");
  assert.equal(recommendation.clickBpm, 150);
});

test("strong consistent TempoCNN estimates work without a classic result", () => {
  const tempoCnn = buildTempoCnnEstimate([
    { bpm: 174, probability: 0.84 },
    { bpm: 174, probability: 0.86 },
    { bpm: 175, probability: 0.81 },
  ]);
  const merged = mergeTempoAnalyses(null, tempoCnn);

  assert.ok(merged);
  assert.equal(merged.method, "tempocnn");
  assert.equal(merged.isReliable, true);
});

test("analysis core detects a synthetic 120 BPM pulse train", async () => {
  const sampleRate = 44100;
  const samples = new Float32Array(sampleRate * 12);
  const beatLength = sampleRate / 2;
  const clickLength = Math.round(sampleRate * 0.025);

  for (let beatStart = 0; beatStart < samples.length; beatStart += beatLength) {
    for (let i = 0; i < clickLength && beatStart + i < samples.length; i += 1) {
      const envelope = Math.exp(-i / (sampleRate * 0.004));
      samples[beatStart + i] =
        Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * envelope;
    }
  }

  const analysis = await analyzeSingleTrackChannels({
    channels: [samples],
    sampleRate,
  });
  const octaveEquivalent = [60, 120, 240].some(
    (bpm) => analysis.bpm !== null && Math.abs(analysis.bpm - bpm) <= 2,
  );

  assert.equal(octaveEquivalent, true, `detected ${analysis.bpm ?? "no BPM"}`);
});
