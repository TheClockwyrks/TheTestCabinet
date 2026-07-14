import type { AnimationSpec, KeyframeSpec } from "./contract";
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
export declare function sampleKeyframes(frames: readonly KeyframeSpec[], periodMs: number, looping: boolean, timeMs: number): number;
/**
 * Sample a model {@link AnimationSpec} at a time offset into a map of joint values,
 * one per track — the values that pose the rig at this instant of the animation.
 * Every track shares the animation's period and loop flag. Feed the result to
 * {@link import("./hierarchy").poseRig} (as `caller`) or to `VoxelRig.playAnimation`.
 */
export declare function sampleAnimation(animation: AnimationSpec, timeMs: number): Record<string, number>;
//# sourceMappingURL=clips.d.ts.map