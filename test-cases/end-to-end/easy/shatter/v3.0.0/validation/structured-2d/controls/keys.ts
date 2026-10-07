// Shatter — what a HELD key does to the ship, read tick by tick, for the six
// `controls/*` points about a hold.
//
// `specs/controls.md` reads rotation and thrust as HOLDS: "the ship turns and
// accelerates for as long as the key is down and stops the moment it is
// released." So each of those six checks is the same measurement in three
// stretches — the ship at rest with nothing down, the ship with one key held, and
// the ship at rest again after it comes up — and what each of them asserts is a
// reading taken across one of those stretches.
//
// ONE TICK PER SAMPLE, AND WHY IT MATTERS FOR THE TURN. A facing is an ANGLE, and
// an angle read at two moments says only where the ship was pointing, never which
// way it swung to get there: a build that turned `300` degrees one way and one
// that turned `60` the other end up pointing the same direction. The turn is
// therefore accumulated from the SIGNED difference between CONSECUTIVE ticks
// (`geometry.ts`'s `angleDelta`, positive clockwise because the field's y axis
// runs down), which is unambiguous as long as no single tick turns more than half
// a revolution — `21_600` degrees per second, some seventy times the rate
// `specs/ship.md` fixes. Sampling every tick is what buys that margin, and it
// costs nothing: these spans are a second of game time at most.
//
// NOTHING HERE IS A THRESHOLD. Every bound the six checks assert is stated in the
// check that asserts it, derived from a figure or a rule `specs/ship.md` and
// `specs/controls.md` state. What lives here is the READING those checks share,
// and no other group in this suite takes it, so it sits beside them rather than
// in the shared harness.

import { angleDelta, speedOf } from "../geometry";
import { sampleEvery, type Harness } from "../harness";
import type { ShatterSnapshot } from "../surface";

/**
 * Read something off the game every tick of a span, with `code` held down for the
 * whole of it — or with nothing held at all, where `code` is omitted.
 *
 * The first reading is taken BEFORE any frame runs, so it is the ship as the span
 * was entered rather than the ship one tick into it. The release is in a
 * `finally`, so a span that failed does not leave the key down for the next one.
 */
async function across<T>(
  h: Harness,
  ticks: number,
  code: string | undefined,
  read: (snapshot: ShatterSnapshot) => T,
): Promise<T[]> {
  if (code !== undefined) h.hold(code);
  try {
    return await sampleEvery(h, ticks, 1, read);
  } finally {
    if (code !== undefined) h.release(code);
  }
}

/** How the ship's facing moved across one span. */
export interface Turn {
  /** The facing at each tick, oldest first, exactly as the build reported it. */
  angles: number[];
  /** Each tick's signed turn, in radians. Positive is CLOCKWISE. */
  steps: number[];
  /** The whole span's signed turn, in radians. Positive is CLOCKWISE. */
  total: number;
  /** The largest single tick's turn, signed. Positive is CLOCKWISE. */
  mostClockwise: number;
  /** The smallest single tick's turn, signed. Negative is COUNTER-CLOCKWISE. */
  mostCounterClockwise: number;
}

/** The turn the ship made across `ticks`, with `code` held for the whole span. */
export async function turnAcross(
  h: Harness,
  ticks: number,
  code?: string,
): Promise<Turn> {
  const angles = await across(h, ticks, code, (s) => s.ship.angle);
  const steps = angles.slice(1).map((angle, i) => angleDelta(angles[i], angle));
  return {
    angles,
    steps,
    total: steps.reduce((sum, step) => sum + step, 0),
    mostClockwise: steps.length === 0 ? 0 : Math.max(...steps),
    mostCounterClockwise: steps.length === 0 ? 0 : Math.min(...steps),
  };
}

/** How the ship's motion went across one span. */
export interface Burn {
  /** The speed at each tick, built from the reported velocity, oldest first. */
  speeds: number[];
  /** Whether the build reported thrust being applied, at each tick. */
  thrusting: boolean[];
  /** The speed at the end of the span, in units per second. */
  ended: number;
  /**
   * The largest rise in speed from one tick to the next, in units per second.
   *
   * Negative across a span in which the speed only ever fell, which is what an
   * un-thrusting ship does: `specs/ship.md` has drag take a fixed fraction of the
   * velocity every tick and nothing but thrust adds to it.
   */
  biggestRise: number;
  /** Whether thrust was reported on the last tick of the span. */
  endedThrusting: boolean;
}

/** The ship's motion across `ticks`, with `code` held for the whole span. */
export async function burnAcross(
  h: Harness,
  ticks: number,
  code?: string,
): Promise<Burn> {
  const samples = await across(h, ticks, code, (s) => ({
    speed: speedOf(s.ship),
    thrusting: s.ship.thrusting,
  }));
  const speeds = samples.map((one) => one.speed);
  const rises = speeds.slice(1).map((speed, i) => speed - speeds[i]);
  return {
    speeds,
    thrusting: samples.map((one) => one.thrusting),
    ended: speeds[speeds.length - 1],
    biggestRise: rises.length === 0 ? 0 : Math.max(...rises),
    endedThrusting: samples[samples.length - 1].thrusting,
  };
}
