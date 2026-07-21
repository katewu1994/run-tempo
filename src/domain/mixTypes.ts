export type BpmInterpretation = "1:2" | "2:3" | "1:1" | "3:2" | "2:1";

export type BpmCandidate = {
  bpm: number;
  interpretation: BpmInterpretation;
};

export type RawEnergyFeatures = {
  rms: number;
  onsetDensity: number;
  spectralCentroid: number;
};

export type MusicalKeyFeature = {
  tonic: string;
  mode: "major" | "minor";
  confidence: number;
};

export type MoodLabel = "calm" | "focused" | "uplifting" | "intense";

export type MoodFeature = {
  label: MoodLabel;
  confidence: number;
  scores: Record<MoodLabel, number>;
  source: "musicnn" | "acoustic_fallback";
};

export type EnergyStructureShape = "flat" | "build" | "peak" | "release" | "arc";

export type EnergyStructureFeature = {
  openingEnergy: number;
  middleEnergy: number;
  peakEnergy: number;
  closingEnergy: number;
  dynamicRange: number;
  shape: EnergyStructureShape;
};

export type TrackSourceKind = "raw" | "standardized";

export type EmbeddedClickStatus = "confirmed" | "suspected" | "not_detected";

export type TrackFeature = {
  trackId: string;
  importKey: string;
  fileName: string;
  relativePath: string | null;
  sourceKind: TrackSourceKind;
  /**
   * Whether this source already carries a metronome. "suspected" is an
   * acoustic estimate only and deliberately does not change render behavior.
   */
  embeddedClickStatus?: EmbeddedClickStatus;
  embeddedClickConfidence?: number | null;
  embeddedCadenceBpm: number | null;
  durationSec: number;
  detectedBpm: number | null;
  bpmCandidates: BpmCandidate[];
  beatConfidence: number | null;
  tempoStability: number | null;
  rawEnergyFeatures: RawEnergyFeatures | null;
  energyFeatureSource?: "embedded" | "analyzed";
  normalizedEnergyScore: number | null;
  musicalKey?: MusicalKeyFeature | null;
  mood?: MoodFeature | null;
  energyStructure?: EnergyStructureFeature | null;
};

export type RunSegmentName =
  | "warmup"
  | "steady"
  | "tempo"
  | "recovery"
  | "finish"
  | "cooldown"
  | "custom";

export type CadenceRamp = {
  start: number;
  end: number;
  interpolation: "linear";
};

export type RunSegment = {
  segmentId: string;
  name: RunSegmentName;
  startSec: number;
  endSec: number;
  targetCadence: number;
  cadenceRamp?: CadenceRamp;
  targetEnergyRange: {
    min: number;
    max: number;
  };
  maxStretchPercent: number;
};

export type RunningPlan = {
  planId: string;
  title: string;
  totalDurationSec: number;
  segments: RunSegment[];
};

export type CandidateScore = {
  segmentId: string;
  trackId: string;
  bestCandidateBpm: number;
  interpretation: BpmInterpretation;
  cadenceFitScore: number;
  energyFitScore: number;
  structureFitScore: number;
  moodFitScore: number;
  /** Retained for backward-compatible planner payloads; no longer weighted. */
  stabilityScore: number;
  stretchRiskScore: number;
  totalScore: number;
  requiredStretchPercent: number;
};

export type MetronomeClickStyle =
  | "soft_hihat"
  | "wood_block"
  | "sharp_beep"
  | "low_tick";

export type MetronomePreference = {
  clickStyle: MetronomeClickStyle;
  clickVolume: number;
  accentEvery: 0 | 2 | 4 | 8;
};

export type OpenAISelectionPlan = {
  mixTitle: string;
  segmentPlans: Array<{
    segmentId: string;
    rankedTrackSelections: Array<{
      trackId: string;
      selectedBpmInterpretation: BpmInterpretation;
      metronomePreference: MetronomePreference;
      reason: string;
    }>;
  }>;
};

export type MixPlanStrategy = "balanced" | "energy" | "variety";

export type GlobalSequenceRules = {
  minRepeatGapTracks: number;
  maxTracksPerSegment: number;
  preferFolderVariety: boolean;
};

export type MixPlanVariant = {
  variantId: MixPlanStrategy;
  selectionPlan: OpenAISelectionPlan;
  summary: {
    uniqueTrackCount: number;
    selectionCount: number;
    repeatCount: number;
    averageCandidateScore: number;
  };
};

export type LibraryCoverageItem = {
  targetCadence: number;
  segmentIds: string[];
  candidateTrackIds: string[];
  finishedTrackCount: number;
  rawTrackCount: number;
  minimumRequiredStretchPercent: number | null;
  status: "missing" | "thin" | "risky" | "covered";
};

export type LibraryCoverageReport = {
  items: LibraryCoverageItem[];
  coveredCadenceCount: number;
  totalCadenceCount: number;
  coveragePercent: number;
  missingCadences: number[];
  thinCadences: number[];
  riskyCadences: number[];
};

export type StretchDecision = "no_stretch" | "safe_stretch" | "skip_stretch";

export type ExecutableMixPlan = {
  mixTitle: string;
  totalDurationSec: number;
  blocks: Array<{
    blockId: string;
    segmentId: string;
    trackId: string;
    mixStartSec: number;
    mixEndSec: number;
    sourceStartSec: number;
    sourceEndSec: number;
    targetCadence: number;
    cadenceRamp?: CadenceRamp;
    selectedSourceBpm: number;
    interpretation: BpmInterpretation;
    stretchRatio: number;
    stretchDecision: StretchDecision;
    metronome: {
      enabled: boolean;
      clickStyle: MetronomeClickStyle;
      clickVolume: number;
      accentEvery: 0 | 2 | 4 | 8;
      offsetMs: number;
    };
    transition: {
      fadeInSec: number;
      fadeOutSec: number;
      crossfadeWithPreviousSec: number;
    };
  }>;
};
