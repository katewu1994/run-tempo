# v0.1 Technical Specification

## Product Scope

v0.1 is a browser-only **Single Track Cadence Mixer**. It validates the complete local audio chain before adding GPT-5.6 Terra planning, multi-track planning, cloud storage, or tempo-stretching DSP.

Supported flow:

```text
Upload audio -> Decode -> Estimate BPM -> Choose source BPM -> Set target BPM -> Apply simple tempo ratio -> Auto beat sync -> Generate metronome -> Preview mix -> Export WAV
```

## Confirmed Technology

- App framework: Vite + React + TypeScript
- Audio runtime: Web Audio API
- BPM analysis: simple local energy/onset autocorrelation detector
- Tempo adjustment: simple resampling with pitch change
- Beat alignment: automatic onset phase estimation, manual fallback, and offset nudge
- Export format: WAV, 16-bit PCM
- Backend: none
- Network requirement at runtime: none
- Recommended Node runtime: Node 20 LTS or Node 22 LTS. The local build was verified on Node 21.5.0, but Vite reports an engine warning for Node 21 because it is not an LTS line.

## Confirmed Package Baseline

- React 18
- Vite 6.4.3
- TypeScript 5
- `lucide-react` for UI icons

## Explicit Non-Goals

- GPT-5.6 Terra integration
- MP3 export
- Cloud upload
- Multi-song arrangement
- Production-grade beat-grid/downbeat detection
- Pitch-preserving tempo changes
- Automatic running plan generation

## Browser Audio Pipeline

1. `File.arrayBuffer()` reads the selected audio file.
2. `AudioContext.decodeAudioData()` creates an `AudioBuffer`.
3. `analyzeBpm()` downmixes to mono, downsamples for analysis, builds an energy onset envelope, and estimates tempo through autocorrelation.
4. `getBpmCandidates()` returns cadence interpretations within 40-240 BPM: `1:2`, `2:3`, `1:1`, `3:2`, and `2:1`. This covers triplet-style mappings such as `123.5 * 3 / 2 = 185.3`.
5. User confirms or manually enters the source BPM.
6. `getTempoRatio()` computes `targetBpm / selectedSourceBpm`, clamped to `0.5x-2x`.
7. `resampleTempo()` applies a simple speed change. This changes pitch by design in v0.1.
8. `estimateAutoBeatSync()` scans the first 60 seconds for strong onset peaks, maps them into the adjusted target-BPM grid, and picks the highest-scoring metronome phase offset.
9. User can rerun auto sync, manually mark a beat while the original song or mix preview is playing, or nudge offset in 25 ms steps.
10. `getFirstBeatOffsetMs()` converts a manually marked source time into a metronome phase offset after tempo adjustment.
11. User picks click style, click volume, accent frequency, and offset.
12. `createMetronomeBuffer()` generates a mono click track at the adjusted song duration and sample rate.
13. `mixAudio()` overlays the click on the tempo-adjusted song with clamped samples.
14. `audioBufferToWavBlob()` exports the mixed `AudioBuffer` as WAV.

## Core Types

```ts
type LoadedAudio = {
  fileName: string;
  arrayBuffer: ArrayBuffer;
  audioBuffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  numberOfChannels: number;
};

type BpmSettings = {
  detectedBpm: number | null;
  selectedSourceBpm: number | null;
  targetBpm: number;
};

type MetronomeSettings = {
  targetBpm: number;
  volume: number;
  clickStyle: "soft" | "sharp" | "wood";
  accentEvery: 0 | 2 | 4 | 8;
  offsetMs: number;
};
```

## Acceptance Criteria

- User can upload browser-decodable audio such as MP3, WAV, or M4A.
- The app displays filename, duration, sample rate, and channel count.
- The original song can be played in the browser.
- BPM analysis produces a detected BPM or a recoverable failure state.
- User can choose BPM candidates or manually enter source BPM.
- User can set target BPM to 180, 185, 190, or a custom value.
- User can preview a generated metronome independently.
- User can preview a 30-second song + click mix.
- App automatically estimates a click phase offset after audio analysis.
- User can rerun auto sync.
- User can mark a beat during playback as a fallback and apply that phase offset to preview/export.
- User can manually nudge metronome offset in 25 ms steps.
- User can export the full mix as a playable WAV file.

## Implementation Notes

- v0.1 alters song speed with simple resampling. It does not preserve pitch.
- The BPM detector is intentionally simple and should be treated as a helper, not authority.
- Manual source BPM correction is part of the main flow, not a fallback.
- Auto beat sync is a lightweight onset-phase estimator, not a full beat-grid or downbeat detector. Manual mark and offset nudge remain as fallbacks.
- The mix path clamps samples to `[-1, 1]` to avoid hard numeric overflow.
- Preview uses only the first 30 seconds to keep iteration fast; export renders the full duration.
