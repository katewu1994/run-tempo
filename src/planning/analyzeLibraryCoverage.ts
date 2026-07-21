import type {
  CandidateScore,
  LibraryCoverageReport,
  RunningPlan,
  TrackFeature,
} from "../domain/mixTypes";
import { FREE_STRETCH_WARNING_PERCENT } from "./scoreCandidates";

export function analyzeLibraryCoverage(args: {
  runningPlan: RunningPlan;
  tracks: TrackFeature[];
  candidateGroups: Array<{
    segmentId: string;
    topCandidates: CandidateScore[];
  }>;
}): LibraryCoverageReport {
  const tracksById = new Map(args.tracks.map((track) => [track.trackId, track]));
  const candidatesBySegmentId = new Map(
    args.candidateGroups.map((group) => [group.segmentId, group.topCandidates]),
  );
  const cadenceGroups = new Map<
    number,
    {
      segmentIds: string[];
      trackIds: Set<string>;
      requiredStretchPercents: number[];
    }
  >();

  for (const segment of args.runningPlan.segments) {
    const cadence = Math.round(segment.targetCadence * 10) / 10;
    const group = cadenceGroups.get(cadence) ?? {
      segmentIds: [],
      trackIds: new Set<string>(),
      requiredStretchPercents: [],
    };
    group.segmentIds.push(segment.segmentId);

    for (const candidate of candidatesBySegmentId.get(segment.segmentId) ?? []) {
      group.trackIds.add(candidate.trackId);
      group.requiredStretchPercents.push(candidate.requiredStretchPercent);
    }

    cadenceGroups.set(cadence, group);
  }

  const items = [...cadenceGroups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([targetCadence, group]) => {
      const candidateTrackIds = [...group.trackIds];
      const finishedTrackCount = candidateTrackIds.filter(
        (trackId) => tracksById.get(trackId)?.sourceKind === "standardized",
      ).length;
      const rawTrackCount = candidateTrackIds.filter(
        (trackId) => tracksById.get(trackId)?.sourceKind === "raw",
      ).length;
      const minimumRequiredStretchPercent =
        group.requiredStretchPercents.length > 0
          ? Math.min(...group.requiredStretchPercents)
          : null;
      const status =
        candidateTrackIds.length === 0
          ? "missing" as const
          : minimumRequiredStretchPercent !== null &&
              minimumRequiredStretchPercent > FREE_STRETCH_WARNING_PERCENT
            ? "risky" as const
            : candidateTrackIds.length < 2
              ? "thin" as const
              : "covered" as const;

      return {
        targetCadence,
        segmentIds: group.segmentIds,
        candidateTrackIds,
        finishedTrackCount,
        rawTrackCount,
        minimumRequiredStretchPercent,
        status,
      };
    });
  const coveredCadenceCount = items.filter((item) => item.status !== "missing").length;
  const totalCadenceCount = items.length;

  return {
    items,
    coveredCadenceCount,
    totalCadenceCount,
    coveragePercent:
      totalCadenceCount > 0
        ? Math.round((coveredCadenceCount / totalCadenceCount) * 100)
        : 0,
    missingCadences: items
      .filter((item) => item.status === "missing")
      .map((item) => item.targetCadence),
    thinCadences: items
      .filter((item) => item.status === "thin")
      .map((item) => item.targetCadence),
    riskyCadences: items
      .filter((item) => item.status === "risky")
      .map((item) => item.targetCadence),
  };
}
