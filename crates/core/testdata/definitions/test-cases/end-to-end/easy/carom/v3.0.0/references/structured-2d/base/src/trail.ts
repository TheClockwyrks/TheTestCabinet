// Carom — the ball's motion trail.
//
// The trail is a list of ball positions stamped with the simulation time they
// were recorded at, OLDEST FIRST, one sample per frame at whatever rate the
// engine is delivering frames. Everything older than TRAIL_TIME is dropped, so
// the trail is a fixed slice of TIME rather than a fixed number of samples —
// which is what makes the comet the ball's trail component draws from it
// stretch as the ball speeds up and collapse to nothing while the ball is held
// before a serve.
//
// The `Ball` actor owns the list (`src/ball.ts`); this module is the pure
// arithmetic over it, so the tests beside it need no world.

import { TRAIL_TIME } from "./constants";

/** One recorded ball position, used to draw the motion trail. */
export interface TrailSample {
  readonly x: number;
  readonly y: number;
  /** The simulation time, in seconds, at which the sample was recorded. */
  readonly t: number;
}

/**
 * A cap on retained history, not on the trail's length.
 *
 * The window is a slice of time and the frame rate is whatever the display
 * gives it, so the number of samples that slice holds varies. 256 covers
 * TRAIL_TIME even at the several-hundred-hertz end of that range, and costs a
 * few kilobytes.
 */
const MAX_SAMPLES = 256;

/**
 * The trail with a sample appended and everything outside the window dropped.
 */
export function recordSample(
  trail: readonly TrailSample[],
  sample: TrailSample,
): readonly TrailSample[] {
  return pruneTrail([...trail, sample], sample.t);
}

/** The trail without the samples older than TRAIL_TIME, or beyond the cap. */
export function pruneTrail(
  trail: readonly TrailSample[],
  now: number,
): readonly TrailSample[] {
  let drop = 0;
  while (drop < trail.length && now - trail[drop].t > TRAIL_TIME) drop++;
  const inWindow = drop > 0 ? trail.slice(drop) : trail;
  return inWindow.length > MAX_SAMPLES
    ? inWindow.slice(inWindow.length - MAX_SAMPLES)
    : inWindow;
}

/** The trail newest-first, which is the order the comet is built in. */
export function ribbon(trail: readonly TrailSample[]): TrailSample[] {
  return trail.slice().reverse();
}
