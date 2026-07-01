import type { AnimationSpec, AutoPlaySpec, KeyframeSpec } from "./contract";

/**
 * Sample a keyframe timeline at a time offset, with linear interpolation between
 * keyframes. Shared by a joint's auto-play {@link sampleClip} and a named
 * {@link sampleAnimation} track — both are a looping timeline of `{ tMs, value }`
 * keyframes over a period.
 *
 * Keyframes are expected in time order (as emitted by the contract). Behaviour:
 * - empty timeline → `0`; single keyframe → that keyframe's value.
 * - `timeMs` at or before the first keyframe → the first value; at or after the
 *   last keyframe → the last value (unless looping, see below).
 * - when `looping` is true and `periodMs` is positive, `timeMs` is wrapped into
 *   `[0, periodMs)` and, if the last keyframe ends before `periodMs`, the tail
 *   interpolates back toward the first keyframe so the loop is seamless.
 */
export function sampleKeyframes(
  frames: readonly KeyframeSpec[],
  periodMs: number,
  looping: boolean,
  timeMs: number,
): number {
  const n = frames.length;
  if (n === 0) return 0;

  const first = frames[0]!;
  if (n === 1) return first.value;
  const last = frames[n - 1]!;

  let t = timeMs;
  if (looping && periodMs > 0) {
    t = ((t % periodMs) + periodMs) % periodMs;
  }

  if (t <= first.tMs) return first.value;

  if (t >= last.tMs) {
    // Seamless wrap: interpolate from the last keyframe back to the first over
    // the remainder of the period.
    if (looping && periodMs > last.tMs) {
      const span = periodMs - last.tMs;
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

/**
 * Sample an auto-play clip at a time offset. A thin wrapper over
 * {@link sampleKeyframes} keyed on the clip's own period and loop flag.
 */
export function sampleClip(auto: AutoPlaySpec, timeMs: number): number {
  return sampleKeyframes(auto.keyframes, auto.periodMs, auto.looping, timeMs);
}

/**
 * Sample a named, predetermined {@link AnimationSpec} at a time offset into a map
 * of joint values, one per track — the caller values that pose the rig at this
 * instant of the animation. Every track shares the animation's period and loop
 * flag. Feed the result to {@link import("./hierarchy").poseRig} (as `caller`) or
 * to `VoxelRig.playAnimation`.
 */
export function sampleAnimation(
  animation: AnimationSpec,
  timeMs: number,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const track of animation.tracks) {
    values[track.joint] = sampleKeyframes(
      track.keyframes,
      animation.periodMs,
      animation.looping,
      timeMs,
    );
  }
  return values;
}
