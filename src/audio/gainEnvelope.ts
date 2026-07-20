export function linearFadeIn(positionSec: number, fadeInSec: number): number {
  if (fadeInSec <= 0) {
    return 1;
  }

  return clamp(positionSec / fadeInSec, 0, 1);
}

export function linearFadeOut(remainingSec: number, fadeOutSec: number): number {
  if (fadeOutSec <= 0) {
    return 1;
  }

  return clamp(remainingSec / fadeOutSec, 0, 1);
}

export function getBlockSourceGain(args: {
  timeInBlockSec: number;
  blockDurationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  baseGain: number;
}): number {
  const baseGain = Math.max(0, args.baseGain);
  const remainingSec = Math.max(0, args.blockDurationSec - args.timeInBlockSec);
  const fadeIn = linearFadeIn(args.timeInBlockSec, args.fadeInSec);
  const fadeOut = linearFadeOut(remainingSec, args.fadeOutSec);

  return clamp(baseGain * fadeIn * fadeOut, 0, baseGain);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
