import assert from "node:assert/strict";
import test from "node:test";
import { createMultiTrackAnalysisInput } from "../src/audio/multiTrackAnalysisQueue";

test("worker analysis input caps copied samples without changing source duration", () => {
  const sampleRate = 10;
  const sourceLength = sampleRate * 180;
  const left = Float32Array.from({ length: sourceLength }, (_, index) => index);
  const right = Float32Array.from({ length: sourceLength }, (_, index) => -index);
  const audioBuffer = {
    length: sourceLength,
    sampleRate,
    duration: 180,
    numberOfChannels: 2,
    getChannelData: (channel: number) => (channel === 0 ? left : right),
  } as unknown as AudioBuffer;
  const rawEnergyFeatures = {
    rms: 0.1,
    onsetDensity: 0.2,
    spectralCentroid: 0.3,
  };

  const input = createMultiTrackAnalysisInput(audioBuffer, 180, rawEnergyFeatures);

  assert.equal(input.durationSec, 180);
  assert.equal(input.sampleRate, sampleRate);
  assert.equal(input.embeddedCadenceBpm, 180);
  assert.deepEqual(input.rawEnergyFeatures, rawEnergyFeatures);
  assert.equal(input.channels.length, 2);
  assert.equal(input.channels[0]?.length, sampleRate * 120);
  assert.equal(input.channels[0]?.[0], 0);
  assert.equal(input.channels[0]?.at(-1), sampleRate * 120 - 1);
  assert.notEqual(input.channels[0], left);
});
