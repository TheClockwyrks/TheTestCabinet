// Carom — the ball's motion trail.
//
// The trail is `CaromState.trail`: ball positions stamped with the simulation time
// they were recorded at, OLDEST FIRST, one sample per frame at whatever rate the
// runtime is delivering frames. Everything older than TRAIL_TIME is dropped, so the
// trail is a fixed slice of TIME rather than a fixed number of samples — which is
// what makes the comet `src/render.ts` draws from it stretch as the ball speeds up
// and collapse to nothing while the ball is held before a serve.

import { TRAIL_TIME } from "./constants";
import type { CaromState, TrailSample } from "./game";

/**
 * A cap on retained history, not on the trail's length.
 *
 * The window is a slice of time and the frame rate is whatever the display gives
 * it, so the number of samples that slice holds varies. 256 covers TRAIL_TIME even
 * at the several-hundred-hertz end of that range, and costs a few kilobytes.
 */
const MAX_SAMPLES = 256;

/** Record the ball's current position and drop everything outside the window. */
export function recordTrail(state: CaromState): void {
  state.trail.push({ x: state.ball.x, y: state.ball.y, t: state.simTime });
  pruneTrail(state.trail, state.simTime);
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
