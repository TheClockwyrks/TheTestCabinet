// Carom — a ball's motion trail.
//
// Every ball carries its own `trail`: its positions stamped with the simulation
// time they were recorded at, OLDEST FIRST, one sample per frame at whatever rate
// the engine is delivering frames. Everything older than TRAIL_TIME is dropped, so
// a trail is a fixed slice of TIME rather than a fixed number of samples — which
// is what makes the comet `src/render.ts` draws from it stretch as that ball
// speeds up and collapse to nothing while the ball waits at its home point.
//
// A trail is a readonly array: recording a sample builds a new one rather than
// appending to the old, which is what lets the state it belongs to be a value.

import { TRAIL_TIME } from "./constants";
import type { BallState, TrailSample } from "./game";

/**
 * The ball with its current position recorded and everything outside the window
 * dropped.
 */
export function recordTrail(ball: BallState, now: number): BallState {
  const trail = pruneTrail(
    [...ball.trail, { x: ball.x, y: ball.y, t: now }],
    now,
  );
  return { ...ball, trail };
}

/** The trail without the samples older than TRAIL_TIME. */
export function pruneTrail(
  trail: readonly TrailSample[],
  now: number,
): readonly TrailSample[] {
  let drop = 0;
  while (drop < trail.length && now - trail[drop].t > TRAIL_TIME) drop++;
  return drop > 0 ? trail.slice(drop) : trail;
}

/** The trail newest-first, which is the order the comet is built in. */
export function ribbon(trail: readonly TrailSample[]): TrailSample[] {
  return trail.slice().reverse();
}
