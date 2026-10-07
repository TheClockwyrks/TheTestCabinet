// Volute — the channel's geometry (specs/channel.md).
//
// A core's position on the channel is ONE NUMBER: its arc distance `s` from the
// inlet, walked along the twelve-vertex polyline. Every rule in the game reads
// and writes arc positions; this module is the only place that turns one into a
// field point, and it is a pure function of `CHANNEL` alone.
//
// The legs are derived once, at module load, from the vertex list, so the arc
// distances the specification tabulates are computed rather than restated.

import { CHANNEL, PATH_LENGTH } from "./constants";
import type { Point } from "./constants";

/** One leg of the channel: the run from a vertex to the next. */
export interface Leg {
  /** The leg's starting vertex. */
  readonly x: number;
  readonly y: number;
  /** The arc distance at the starting vertex. */
  readonly at: number;
  /** The leg's length. */
  readonly length: number;
  /** The leg's unit direction. */
  readonly dx: number;
  readonly dy: number;
}

function buildLegs(): Leg[] {
  const legs: Leg[] = [];
  let at = 0;
  for (let i = 0; i + 1 < CHANNEL.length; i += 1) {
    const from = CHANNEL[i];
    const to = CHANNEL[i + 1];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    legs.push({
      x: from.x,
      y: from.y,
      at,
      length,
      dx: (to.x - from.x) / length,
      dy: (to.y - from.y) / length,
    });
    at += length;
  }
  return legs;
}

/** The eleven legs, in order from the inlet. */
export const LEGS: readonly Leg[] = buildLegs();

/**
 * The leg an arc position lies on: the one whose starting vertex carries the
 * greatest arc distance not exceeding `s`.
 *
 * An arc position below `0` selects the first leg, so a core the train has not
 * yet carried past the inlet is drawn at the inlet; `PATH_LENGTH` selects the
 * final leg, so the intake's forward direction is that leg's.
 */
export function legAt(s: number): Leg {
  if (!(s > 0)) return LEGS[0];
  for (let i = LEGS.length - 1; i >= 0; i -= 1) {
    if (s >= LEGS[i].at) return LEGS[i];
  }
  return LEGS[0];
}

/**
 * The field point an arc position gives: the leg's starting vertex plus the
 * leg's unit direction times the remainder.
 *
 * An arc position below `0` clamps to the inlet, since the leg's remainder is
 * taken from `0` rather than from the negative position.
 */
export function pointAt(s: number): Point {
  const leg = legAt(s);
  const along = Math.max(0, s) - leg.at;
  return { x: leg.x + leg.dx * along, y: leg.y + leg.dy * along };
}

/** The channel's unit direction of travel at an arc position. */
export function forwardAt(s: number): Point {
  const leg = legAt(s);
  return { x: leg.dx, y: leg.dy };
}

/** The inlet, where the channel begins. */
export const INLET: Point = pointAt(0);
/** The intake, where the channel ends and a core spends a cell. */
export const INTAKE: Point = pointAt(PATH_LENGTH);
