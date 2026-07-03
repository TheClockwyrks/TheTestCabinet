import type { AnimationSpec, InterpSpec, KeyframeSpec } from "./contract";

/**
 * Sample an **F-curve** track at a time offset. A track is a list of
 * `{ tMs, value, interp, outHandle?, inHandle? }` keyframes; each keyframe's
 * `interp` sets how the curve **leaves** it (the segment from this key to the next),
 * so motion carries weight and snap instead of sliding linearly between poses.
 *
 * Per-segment interpolation (set by the *leaving* key `a`):
 * - `constant` — hold `a.value` until the next key (a step).
 * - `linear` — a straight line to the next key.
 * - `bezier` — a cubic Bézier through `A, A.out, B.in, B`, where `A.out`/`B.in`
 *   come from this key's `outHandle` and the next key's `inHandle` (each a
 *   `[dtMs, dvalue]` offset from its key); a `bezier` key with no handle uses a
 *   smooth Catmull-Rom-ish **auto tangent** from its neighbours.
 * - the `ease-in`/`ease-out`/`ease-in-out` **presets** expand to fixed Bézier
 *   handles (mirroring CSS `cubic-bezier`): `ease-in` = `cubic-bezier(0.42,0,1,1)`
 *   (slow out of A, fast into B — the "thump" of a foot-plant), `ease-out` =
 *   `cubic-bezier(0,0,0.58,1)` (fast out, slow in), `ease-in-out` =
 *   `cubic-bezier(0.42,0,0.58,1)` (both ends). A preset ignores any explicit
 *   handles on the key.
 *
 * Keyframes are expected in time order (as emitted by the contract). Behaviour:
 * - empty track → `0`; single keyframe → that keyframe's value.
 * - `timeMs` at or before the first keyframe → the first value; at or after the
 *   last keyframe → the last value (unless looping, see below).
 * - when `looping` is true and `periodMs` is positive, `timeMs` is wrapped into
 *   `[0, periodMs)` and, if the last keyframe ends before `periodMs`, the tail
 *   evaluates the wrap segment (last → first) honouring the last key's `interp`,
 *   so the loop is seamless.
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
    // Seamless wrap: the segment from the last keyframe back to the first, spanning
    // `[last.tMs, periodMs]`, using the last key's own interpolation.
    if (looping && periodMs > last.tMs) {
      const wrap: KeyframeSpec = {
        tMs: periodMs,
        value: first.value,
        interp: first.interp,
      };
      // Neighbours for auto tangents wrap around the loop: before `last` is the
      // penultimate key; after the wrapped `first` is the second key.
      return evalSegment(last, wrap, frames[n - 2] ?? null, frames[1] ?? null, t);
    }
    return last.value;
  }

  for (let i = 0; i < n - 1; i++) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (t >= a.tMs && t <= b.tMs) {
      const prev = i > 0 ? frames[i - 1]! : looping ? wrapBefore(frames, periodMs) : null;
      const next =
        i + 2 < n ? frames[i + 2]! : looping ? wrapAfter(frames, periodMs) : null;
      return evalSegment(a, b, prev, next, t);
    }
  }

  return last.value;
}

/** The synthetic neighbour *before* the first key when looping: the last key,
 * shifted one period earlier, so the auto tangent at the first key is continuous
 * across the loop seam. */
function wrapBefore(frames: readonly KeyframeSpec[], periodMs: number): KeyframeSpec {
  const last = frames[frames.length - 1]!;
  return { tMs: last.tMs - periodMs, value: last.value, interp: last.interp };
}

/** The synthetic neighbour *after* the last key when looping: the first key,
 * shifted one period later. */
function wrapAfter(frames: readonly KeyframeSpec[], periodMs: number): KeyframeSpec {
  const first = frames[0]!;
  return { tMs: first.tMs + periodMs, value: first.value, interp: first.interp };
}

/** Normalised preset handles in `(u, w)` space — `u` a fraction of the segment's
 * time span, `w` a fraction of its value span — mirroring CSS easing curves. */
const EASE_PRESETS: Record<
  "ease-in" | "ease-out" | "ease-in-out",
  { out: [number, number]; in: [number, number] }
> = {
  // cubic-bezier(0.42, 0, 1, 1): control points P1=(0.42,0), P2=(1,1).
  "ease-in": { out: [0.42, 0], in: [0, 0] },
  // cubic-bezier(0, 0, 0.58, 1): P1=(0,0), P2=(0.58,1) → in-offset from B=(−0.42,0).
  "ease-out": { out: [0, 0], in: [-0.42, 0] },
  // cubic-bezier(0.42, 0, 0.58, 1).
  "ease-in-out": { out: [0.42, 0], in: [-0.42, 0] },
};

/** Evaluate one F-curve segment `a → b` at time `t` (with `a.tMs <= t <= b.tMs`),
 * per `a.interp`. `prev`/`next` are the neighbouring keys used only for auto
 * tangents (either may be `null` at a non-looping boundary). */
function evalSegment(
  a: KeyframeSpec,
  b: KeyframeSpec,
  prev: KeyframeSpec | null,
  next: KeyframeSpec | null,
  t: number,
): number {
  const dt = b.tMs - a.tMs;
  if (dt <= 0) return b.value;

  switch (a.interp) {
    case "constant":
      return a.value;
    case "linear":
      return a.value + (b.value - a.value) * ((t - a.tMs) / dt);
    default:
      return evalBezier(a, b, prev, next, a.interp, t, dt);
  }
}

/** A cubic-Bézier segment `a → b`, its out-/in-handles resolved from an easing
 * preset, explicit handles, or auto tangents. Solves the Bézier's time parameter
 * for `t` (bisection, since the control points keep time monotonic), then reads the
 * value. */
function evalBezier(
  a: KeyframeSpec,
  b: KeyframeSpec,
  prev: KeyframeSpec | null,
  next: KeyframeSpec | null,
  interp: InterpSpec,
  t: number,
  dt: number,
): number {
  const dv = b.value - a.value;

  let aOut: [number, number];
  let bIn: [number, number];

  if (interp === "ease-in" || interp === "ease-out" || interp === "ease-in-out") {
    const preset = EASE_PRESETS[interp];
    aOut = [a.tMs + preset.out[0] * dt, a.value + preset.out[1] * dv];
    bIn = [b.tMs + preset.in[0] * dt, b.value + preset.in[1] * dv];
  } else {
    // `bezier`: explicit `[dtMs, dvalue]` handles, else an auto tangent from the
    // neighbouring keys (Catmull-Rom-ish), placed a third of the span out.
    aOut = a.outHandle
      ? [a.tMs + a.outHandle[0], a.value + a.outHandle[1]]
      : autoOut(a, b, prev, dt);
    bIn = b.inHandle
      ? [b.tMs + b.inHandle[0], b.value + b.inHandle[1]]
      : autoIn(a, b, next, dt);
  }

  return bezierValueAtTime(
    [a.tMs, a.value],
    aOut,
    bIn,
    [b.tMs, b.value],
    t,
  );
}

/** Auto out-handle at `a` for the segment `a → b`: slope from `a`'s neighbours,
 * a third of the segment out. */
function autoOut(
  a: KeyframeSpec,
  b: KeyframeSpec,
  prev: KeyframeSpec | null,
  dt: number,
): [number, number] {
  const slope = prev
    ? (b.value - prev.value) / (b.tMs - prev.tMs)
    : (b.value - a.value) / dt;
  const h = dt / 3;
  return [a.tMs + h, a.value + slope * h];
}

/** Auto in-handle at `b` for the segment `a → b`: slope from `b`'s neighbours,
 * a third of the segment back. */
function autoIn(
  a: KeyframeSpec,
  b: KeyframeSpec,
  next: KeyframeSpec | null,
  dt: number,
): [number, number] {
  const slope = next
    ? (next.value - a.value) / (next.tMs - a.tMs)
    : (b.value - a.value) / dt;
  const h = dt / 3;
  return [b.tMs - h, b.value - slope * h];
}

/** One coordinate of a cubic Bézier at parameter `s ∈ [0, 1]`. */
function cubic(p0: number, p1: number, p2: number, p3: number, s: number): number {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}

/** Value of a cubic Bézier `(time, value)` curve at a given query `time`: solve
 * `x(s) = time` for the parameter `s` by bisection (`x` is monotonic across a
 * well-formed segment), then evaluate `y(s)`. */
function bezierValueAtTime(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  time: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(p0[0], p1[0], p2[0], p3[0], mid) < time) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  return cubic(p0[1], p1[1], p2[1], p3[1], s);
}

/**
 * Sample a model {@link AnimationSpec} at a time offset into a map of joint values,
 * one per track — the values that pose the rig at this instant of the animation.
 * Every track shares the animation's period and loop flag. Feed the result to
 * {@link import("./hierarchy").poseRig} (as `caller`) or to `VoxelRig.playAnimation`.
 */
export function sampleAnimation(
  animation: AnimationSpec,
  timeMs: number,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const track of animation.tracks ?? []) {
    values[track.joint] = sampleKeyframes(
      track.keyframes,
      animation.periodMs,
      animation.looping,
      timeMs,
    );
  }
  return values;
}
