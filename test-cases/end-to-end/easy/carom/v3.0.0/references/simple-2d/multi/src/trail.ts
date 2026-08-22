// Carom — a ball's motion trail.
//
// Every ball carries its own `trail`: its positions stamped with the simulation
// time they were recorded at, OLDEST FIRST, one sample per frame at whatever rate
// the engine is delivering frames. Everything older than TRAIL_TIME is dropped, so
// a trail is a fixed slice of TIME rather than a fixed number of samples — which
// is what makes the comet `src/render.ts` draws from it stretch as that ball
// speeds up and collapse to nothing while the ball waits at its home point.

import { TRAIL_TIME } from "./constants";
import type { BallState, TrailSample } from "./game";

/**
 * A cap on retained history, not on the trail's length.
 *
 * The window is a slice of time and the frame rate is whatever the display gives
 * it, so the number of samples that slice holds varies. 256 covers TRAIL_TIME even
 * at the several-hundred-hertz end of that range, and costs a few kilobytes.
 */
const MAX_SAMPLES = 256;

/** Record one ball's current position and drop everything outside the window. */
export function recordTrail(ball: BallState, now: number): void {
  ball.trail.push({ x: ball.x, y: ball.y, t: now });
  pruneTrail(ball.trail, now);
}

/** Drop the samples older than TRAIL_TIME, and any beyond the retention cap. */
export function pruneTrail(trail: TrailSample[], now: number): void {
  let drop = 0;
  while (drop < trail.length && now - trail[drop].t > TRAIL_TIME) drop++;
  if (drop > 0) trail.splice(0, drop);
  if (trail.length > MAX_SAMPLES) {
    trail.splice(0, trail.length - MAX_SAMPLES);
  }
}

/** The trail newest-first, which is the order the comet is built in. */
export function ribbon(trail: readonly TrailSample[]): TrailSample[] {
  return trail.slice().reverse();
}
