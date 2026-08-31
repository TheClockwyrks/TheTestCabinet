// flight — the specification's own model of how the ship moves, and the one
// reading a held rotation needs. Local to this group.
//
// WHY THIS IS HERE AND NOT IN THE HARNESS. Nothing below arranges anything: the
// harness already poses the ship (`startPlaying`, `poseShip`) and already drives
// a held key (`holdAction`, `holdActionFor`, `sampleEvery`). What only this group
// needs is the ARITHMETIC of `specs/ship.md`'s "Inertial flight" table — what the
// drag leaves of a speed over a stretch of game time, what a burn from rest
// reaches, and how far a facing turned over a hold — and that belongs beside the
// checks that read it.
//
// NO THRESHOLD LIVES HERE. Every function answers what the specification says
// the value IS. How far a build may fall from it is each check's own figure,
// derived in the check from the percentage its review item states.
//
// THE MODEL IS THE SPECIFICATION'S, NOT THE REFERENCE'S. `specs/simulation.md`
// runs the game in whole ticks of `TICK_DT` and puts the ship's control forces
// first in the tick; `specs/ship.md` orders the ship's own step as rotation,
// thrust, drag, cap. So one tick of an un-thrusting body is a multiplication by
// `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)`, and one tick of a burn is
// `(v + SHIP_THRUST * TICK_DT) * that`. {@link keptOver} and {@link burnFromRest}
// are those two sentences and nothing else.

import { SHIP_DRAG_HALFLIFE, SHIP_THRUST, TICK_DT } from "../../src/constants";
import { angleDelta } from "../geometry";
import {
  holdAction,
  releaseAction,
  sampleEvery,
  type Action,
  type Harness,
} from "../harness";

/**
 * The fraction of its speed an un-thrusting ship keeps over `seconds` of game
 * time.
 *
 * `specs/ship.md`, the Drag row: the velocity is multiplied by
 * `0.5 ^ (TICK_DT / SHIP_DRAG_HALFLIFE)` each tick, so over `n` ticks it is
 * multiplied by `0.5 ^ (n * TICK_DT / SHIP_DRAG_HALFLIFE)` — which is
 * `0.5 ^ (seconds / SHIP_DRAG_HALFLIFE)` exactly, with no dependence on how the
 * stretch was cut into ticks. That exactness is why the same expression serves a
 * reading taken at half a half-life and one taken at a whole one.
 */
export function keptOver(seconds: number): number {
  return Math.pow(0.5, seconds / SHIP_DRAG_HALFLIFE);
}

/** What one tick of drag alone leaves of a speed. */
export const KEPT_PER_TICK: number = keptOver(TICK_DT);

/**
 * The speed a ship burning from rest along a fixed facing reaches after `ticks`
 * whole ticks, by the specification's own per-tick composition.
 *
 * `specs/ship.md` applies the thrust acceleration first and the drag second, so
 * each tick is `v <- (v + SHIP_THRUST * TICK_DT) * KEPT_PER_TICK`. The speed cap
 * never binds here: the series converges on `SHIP_THRUST * SHIP_DRAG_HALFLIFE /
 * ln 2` (about `2077`) but a burn of a second or two is nowhere near it, and
 * every caller checks its own figure against `SHIP_MAX`.
 *
 * Summed as the game sums it rather than in the closed form, because a check
 * that asserts what a build in whole ticks produces should be held against what
 * the specification in whole ticks produces. The two differ by under a tenth of
 * a percent over a second, which is the reason a check's tolerance can be read
 * as room for the build's arithmetic rather than for the model.
 */
export function burnFromRest(ticks: number): number {
  let speed = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    speed = (speed + SHIP_THRUST * TICK_DT) * KEPT_PER_TICK;
  }
  return speed;
}

/**
 * Hold a rotation action down for `frames` frames and answer the TOTAL SIGNED
 * TURN the facing made over them, in radians. Positive is clockwise, as
 * `specs/overview.md` measures angles.
 *
 * WHY A SUM OF SAMPLED STEPS AND NOT A SINGLE DIFFERENCE. `SHIP_TURN` is `300`
 * degrees a second, so a second of turning is a swing of `300` degrees — and the
 * difference between two facings can only ever be read in `(-180, +180]`, since
 * an angle carries no memory of how many times it has been round. A single
 * reading at the end of the second therefore reports `-300` as `+60`, which is
 * exactly what a build turning `60` degrees the WRONG WAY would report. Summing
 * the steps between samples keeps the winding, so the two are different numbers.
 *
 * `stride` is what makes each step unambiguous: at the specified rate a stride
 * of `stride / TICK_HZ` seconds is a step of `SHIP_TURN * stride / TICK_HZ`, and
 * as long as that stays well under 180 degrees the unwrapping is the only
 * reading. Callers pass a stride small enough that even a build turning several
 * times the stated rate is read as the number it actually turned.
 *
 * The release is in a `finally`, so a scenario that failed mid-hold does not
 * leave the key down for the next one. A build that never normalizes its facing
 * and one that keeps it in range are read the same, because only the step
 * between consecutive samples is ever taken.
 */
export async function turnedThrough(
  h: Harness,
  action: Action,
  frames: number,
  stride: number,
): Promise<number> {
  holdAction(h, action);
  try {
    const facings = await sampleEvery(
      h,
      frames,
      stride,
      (snapshot) => snapshot.ship.angle,
    );
    let turned = 0;
    for (let i = 1; i < facings.length; i += 1) {
      turned += angleDelta(facings[i - 1], facings[i]);
    }
    return turned;
  } finally {
    releaseAction(h, action);
  }
}
