// Orrery — the sampled collision rule (specs/simulation.md "Collision").
//
// Within the motion step every mote's position is evaluated at the sample
// fractions `t = k / COLLISION_SAMPLES` for `k` from `1` to `COLLISION_SAMPLES`,
// IN ORDER. If at any sample two mote centers are strictly closer than
// `2 * MOTE_COLLIDE_R`, the run faults there and names every pair within the
// threshold at that sample. Every pair is checked, fixtures included.
//
// Two properties of the rule are load-bearing and easy to lose:
//
//   * The samples are walked in ascending order and the FIRST one within the
//     threshold wins, which may precede the nearest approach. Example A of the
//     specification is first within at `36.10` at `t = 3/8` and nearest at
//     `35.14` at `t = 4/8`, and the run stops at `3/8`.
//   * The last sample is `t = 1`, so a move ending on a hex another mote rests
//     on is a collision at distance `0` rather than two motes on one hex.
//
// The sample fractions are the ONLY places collision is decided. Nothing here
// reads a frame, a canvas, or the wall clock, so a run divided into one frame
// and a run divided into sixty reach the same verdict.

import { COLLISION_SAMPLES, MOTE_COLLIDE_R } from "./constants";
import type { StagePoint } from "./motion";

/** Two motes collide when their centers come closer than this. */
export const COLLISION_DISTANCE = 2 * MOTE_COLLIDE_R;

/** One mote's center at one sample fraction. */
export interface MotePoint extends StagePoint {
  /** The mote's id. */
  readonly mote: number;
}

/** A sample the collision rule stopped at. */
export interface CollisionSample {
  /** The sample's fraction, `k / COLLISION_SAMPLES`. */
  readonly fraction: number;
  /** Every mote of every pair within the threshold there, in ascending id order. */
  readonly motes: number[];
}

/** The `k`th sample's fraction, for `k` from `1` to `COLLISION_SAMPLES`. */
export function sampleFraction(k: number): number {
  return k / COLLISION_SAMPLES;
}

/** The distance between two mote centers, in the stage's logical units. */
export function separation(a: StagePoint, b: StagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Every mote of every pair within `COLLISION_DISTANCE` of another, in ascending
 * id order, and empty when the field is clear. Every pair is checked.
 */
export function collidingMotes(points: readonly MotePoint[]): number[] {
  const found = new Set<number>();
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (separation(points[i], points[j]) < COLLISION_DISTANCE) {
        found.add(points[i].mote);
        found.add(points[j].mote);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The first of the `COLLISION_SAMPLES` sample fractions at which two motes are
 * within the threshold, or `null` when the whole sweep is clear. `at` reports
 * every mote's center at one fraction.
 */
export function firstCollisionSample(
  at: (t: number) => MotePoint[],
): CollisionSample | null {
  for (let k = 1; k <= COLLISION_SAMPLES; k += 1) {
    const fraction = sampleFraction(k);
    const motes = collidingMotes(at(fraction));
    if (motes.length > 0) return { fraction, motes };
  }
  return null;
}
