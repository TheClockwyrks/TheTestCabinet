// Carom — what the three no-tunnel checks share. CASE-PROVIDED.
//
// specs/balls.md requires the ball to stay inside the field and on the outside
// of every paddle and obstacle at every speed up to `SPEED_CAP`, and fixes how:
// a frame is cut into `n = max(1, ceil(speed * dt / MAX_SUBSTEP))` sub-steps,
// so the ball's center never moves more than `MAX_SUBSTEP` units between two
// collision passes. Each check fires the ball at the ceiling speed at one kind
// of body and watches for it on the far side.
//
// WHY EACH PROBE RUNS TWICE. A browser hands a page whatever elapsed time the
// last frame really took. At the suite's own cadence a ball at the ceiling
// speed moves eight units a frame, less than the width of everything on the
// field, so a build that resolves collisions once per frame would pass by
// accident. The coarse step is an ordinary bad moment on a real machine (twenty
// frames a second), and there the ball would cross far more than an obstacle's
// width in one unbroken step: 49 units, which the sub-step rule cuts into 13.

import { SPEED_CAP } from "../constants";
import {
  ConstantClock,
  createHarness,
  startPlaying,
  TICK_MS,
} from "../harness";
import type { Harness } from "../harness";

/**
 * The two frame sizes each probe is driven at: the suite's own cadence, and a
 * frame long enough that one unbroken step of it carries the ball past a whole
 * obstacle.
 */
export const STEPS_MS = [TICK_MS, 50];

/**
 * The sweep cap for a probe: the frames its run-up takes at the ceiling speed,
 * plus room for the contact. Stated as a distance so it means the same thing at
 * every step size.
 */
export function framesFor(distance: number, stepMs: number): number {
  return Math.ceil((distance / SPEED_CAP) * (1000 / stepMs)) + 4;
}

/**
 * How much of the departing flight is recorded after the rebound, in ms of
 * GAME time. A duration rather than a frame count, because the probes run at
 * two very different frame sizes; short of the 0.47 s a ball at the ceiling
 * needs to cross half the field, so the recording ends with the ball in play.
 */
export const DEPARTURE_MS = 350;

/** A live match driven at `stepMs` frames, registered for disposal in `live`. */
export async function harnessAt(
  stepMs: number,
  live: Harness[],
): Promise<Harness> {
  const harness = await createHarness({ clock: new ConstantClock(stepMs) });
  live.push(harness);
  await startPlaying(harness);
  return harness;
}
