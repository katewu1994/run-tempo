export type TempoConfidenceLevel =
  | "unavailable"
  | "very_low"
  | "low"
  | "good"
  | "excellent";

export type SingleTrackBpmMethod =
  | "essentia_multifeature"
  | "essentia_tempocnn_hybrid"
  | "tempocnn"
  | "fallback_autocorrelation";

export type TempoWindowEstimate = {
  bpm: number;
  confidence: number;
  intervalStability: number | null;
};

export type TempoCnnLocalEstimate = {
  bpm: number;
  probability: number;
};

export type TempoCnnEstimate = {
  bpm: number;
  probability: number;
  stability: number;
  localEstimateCount: number;
};

export type SingleTrackBpmAnalysis = {
  bpm: number | null;
  confidence: number | null;
  confidenceLevel: TempoConfidenceLevel;
  tempoStability: number | null;
  windowAgreement: number | null;
  analyzedWindowCount: number;
  method: SingleTrackBpmMethod;
  tempoCnn: TempoCnnEstimate | null;
  detectorAgreement: boolean | null;
  isReliable: boolean;
};
