import type { AutoPlaySpec } from "./contract";

/**
 * Sample an auto-play clip at a time offset, with linear interpolation between
 * keyframes.
 *
 * Keyframes are expected in time order (as emitted by the contract). Behaviour:
 * - empty clip → `0`; single keyframe → that keyframe's value.
 * - `timeMs` at or before the first keyframe → the first value; at or after the
 *   last keyframe → the last value (unless looping, see below).
 * - when {@link AutoPlaySpec.looping} is true and {@link AutoPlaySpec.periodMs}
 *   is positive, `timeMs` is wrapped into `[0, periodMs)` and, if the last
 *   keyframe ends before `periodMs`, the tail interpolates back toward the first
 *   keyframe so the loop is seamless.
 */
export function sampleClip(auto: AutoPlaySpec, timeMs: number): number {
  const frames = auto.keyframes;
  const n = frames.length;
  if (n === 0) return 0;

  const first = frames[0]!;
  if (n === 1) return first.value;
  const last = frames[n - 1]!;

  const period = auto.periodMs;
  let t = timeMs;
  if (auto.looping && period > 0) {
    t = ((t % period) + period) % period;
  }

  if (t <= first.tMs) return first.value;

  if (t >= last.tMs) {
    // Seamless wrap: interpolate from the last keyframe back to the first over
    // the remainder of the period.
    if (auto.looping && period > last.tMs) {
      const span = period - last.tMs;
      const frac = (t - last.tMs) / span;
      return last.value + (first.value - last.value) * frac;
    }
    return last.value;
  }

  for (let i = 0; i < n - 1; i++) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (t >= a.tMs && t <= b.tMs) {
      const span = b.tMs - a.tMs;
      if (span <= 0) return b.value;
      const frac = (t - a.tMs) / span;
      return a.value + (b.value - a.value) * frac;
    }
  }

  return last.value;
}
