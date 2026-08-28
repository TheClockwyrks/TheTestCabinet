// Fathom — the sonar wavefront (`specs/sensing.md`).
//
// A pulse is not an expanding circle. It travels outward through the corridors,
// bending at bends and entering no space rock seals off, so near tiles are
// reached before far ones. The geometry is the corridor flood grouped by distance
// (`floodBuckets`); this module turns that static geometry into a moving front
// and reports the tiles the front newly swept over on each step, so the game
// reveals terrain and marks hunters exactly as the front reaches them.
//
// The forager's pulse and a Gloamfin's ping are the same wavefront and differ
// only in what the game does with what the front sweeps over.

import {
  SONAR_RANGE_BASE,
  SONAR_RANGE_MIN,
  SONAR_WAVE_SPEED,
} from "./constants";
import { floodBuckets } from "./maze";
import type {
  MazeState,
  PulseSource,
  PulseState,
  PulseTint,
  Tile,
} from "./state";

/** The pulse's path range `E` at depth `d` (`specs/progression.md`). */
export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/** A wavefront cast from `(tx, ty)`, its flood computed once, its front at zero. */
export function castPulse(
  maze: MazeState,
  tx: number,
  ty: number,
  range: number,
  source: PulseSource,
  tint: PulseTint,
  emitter: number | null,
): PulseState {
  return {
    source,
    tint,
    ox: tx,
    oy: ty,
    front: 0,
    range,
    delivered: 0,
    buckets: floodBuckets(maze, tx, ty, range),
    emitter,
    caughtForager: false,
  };
}

/** A pulse advanced by `dt`, with the tiles its front newly swept over. */
export interface PulseStep {
  readonly pulse: PulseState;
  /** The tiles the front reached this step, nearest first. */
  readonly crossed: readonly Tile[];
}

/**
 * The pulse after `dt` seconds.
 *
 * The front stands `SONAR_WAVE_SPEED * t` corridor steps out `t` seconds after
 * the pulse, and every bucket it has passed is handed over exactly once, nearest
 * first, so nothing is revealed or marked twice and nothing is skipped.
 */
export function advancePulse(pulse: PulseState, dt: number): PulseStep {
  const front = pulse.front + SONAR_WAVE_SPEED * dt;
  const reach = Math.min(pulse.buckets.length - 1, Math.floor(front));
  const crossed: Tile[] = [];
  for (let d = pulse.delivered + 1; d <= reach; d++)
    crossed.push(...pulse.buckets[d]);
  return {
    pulse: { ...pulse, front, delivered: Math.max(pulse.delivered, reach) },
    crossed,
  };
}

/** Whether the pulse's front has passed its range, which takes it off the board. */
export function pulseSpent(pulse: PulseState): boolean {
  return pulse.front > pulse.range;
}

/** How far the front is from the origin along the corridors, or `null` off it. */
export function pulseDistanceTo(
  pulse: PulseState,
  tx: number,
  ty: number,
): number | null {
  for (let d = 0; d < pulse.buckets.length; d++) {
    for (const tile of pulse.buckets[d]) {
      if (tile.tx === tx && tile.ty === ty) return d;
    }
  }
  return null;
}

/** Whether the front has already swept over `(tx, ty)`. */
export function pulseReached(
  pulse: PulseState,
  tx: number,
  ty: number,
): boolean {
  const distance = pulseDistanceTo(pulse, tx, ty);
  return distance !== null && pulse.front >= distance;
}
