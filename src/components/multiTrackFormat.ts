import type {
  BpmInterpretation,
  CadenceRamp,
  RunningPlan,
  RunSegment,
  RunSegmentName,
  StretchDecision,
} from "../domain/mixTypes";
import type { AppCopy } from "../i18n";

export type MultiTrackCopy = AppCopy["multiTrack"];

export function getLocalizedPlanTitle(
  copy: MultiTrackCopy["runningPlan"],
  plan: RunningPlan,
): string {
  const key = plan.planId as keyof typeof copy.planTitles;
  return copy.planTitles[key] ?? plan.title;
}

export function getLocalizedSegmentName(
  segmentNames: MultiTrackCopy["runningPlan"]["segmentNames"],
  value: RunSegmentName | string,
): string {
  const key = value as keyof typeof segmentNames;
  return segmentNames[key] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

export function getLocalizedBpmInterpretation(
  interpretations: Record<BpmInterpretation, string>,
  value: BpmInterpretation,
): string {
  return interpretations[value];
}

export function formatSegmentCadence(segment: RunSegment): string {
  return formatCadenceTarget(segment.targetCadence, segment.cadenceRamp);
}

export function formatCadenceTarget(
  targetCadence: number,
  cadenceRamp?: CadenceRamp,
): string {
  if (cadenceRamp && cadenceRamp.start !== cadenceRamp.end) {
    return `${formatCadence(cadenceRamp.start)}-${formatCadence(
      cadenceRamp.end,
    )} spm`;
  }

  return `${formatCadence(targetCadence)} spm`;
}

export function getLocalizedStretchDecision(
  stretchDecisions: Record<StretchDecision, string>,
  value: StretchDecision,
): string {
  return stretchDecisions[value];
}

function formatCadence(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}
