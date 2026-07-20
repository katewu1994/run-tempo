import type { RawEnergyFeatures, TrackFeature } from "../domain/mixTypes";

type EnergyDimension = keyof RawEnergyFeatures;

const ENERGY_WEIGHTS: Record<EnergyDimension, number> = {
  rms: 0.45,
  onsetDensity: 0.35,
  spectralCentroid: 0.2,
};

export function normalizeTrackEnergy(tracks: TrackFeature[]): TrackFeature[] {
  const ranges = getEnergyRanges(tracks);

  return tracks.map((track) => {
    if (!track.rawEnergyFeatures) {
      return {
        ...track,
        normalizedEnergyScore: 50,
      };
    }

    const rmsScore = normalizeDimension(
      track.rawEnergyFeatures.rms,
      ranges.rms.min,
      ranges.rms.max,
    );
    const onsetScore = normalizeDimension(
      track.rawEnergyFeatures.onsetDensity,
      ranges.onsetDensity.min,
      ranges.onsetDensity.max,
    );
    const brightnessScore = normalizeDimension(
      track.rawEnergyFeatures.spectralCentroid,
      ranges.spectralCentroid.min,
      ranges.spectralCentroid.max,
    );

    return {
      ...track,
      normalizedEnergyScore:
        rmsScore * ENERGY_WEIGHTS.rms +
        onsetScore * ENERGY_WEIGHTS.onsetDensity +
        brightnessScore * ENERGY_WEIGHTS.spectralCentroid,
    };
  });
}

function getEnergyRanges(tracks: TrackFeature[]): Record<
  EnergyDimension,
  { min: number; max: number }
> {
  return {
    rms: getDimensionRange(tracks, "rms"),
    onsetDensity: getDimensionRange(tracks, "onsetDensity"),
    spectralCentroid: getDimensionRange(tracks, "spectralCentroid"),
  };
}

function getDimensionRange(
  tracks: TrackFeature[],
  dimension: EnergyDimension,
): { min: number; max: number } {
  const values = tracks
    .map((track) => track.rawEnergyFeatures?.[dimension])
    .filter((value): value is number => Number.isFinite(value));

  if (values.length === 0) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function normalizeDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || min === max) {
    return 50;
  }

  return ((value - min) / (max - min)) * 100;
}
