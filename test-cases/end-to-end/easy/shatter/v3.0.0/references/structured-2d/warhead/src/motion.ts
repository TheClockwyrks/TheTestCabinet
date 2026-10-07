// Shatter — the motion one tick produced, and the swept test read off it.
//
// `specs/collision.md` requires collision that is swept or continuous: two
// bodies whose paths over a tick bring them within the sum of their radii at any
// point of that tick collide on it, however fast either was travelling. That
// needs each body's motion over the tick as well as where it ended, and a body
// added part-way through a tick — a round leaving the nose, a fragment left by a
// split — moved nothing at all.
//
// The table below is that record, built fresh each tick by the integration and
// read by the collision pass. A body with no entry moved nothing, which is
// exactly right for one that was not there when the tick began.

import { STAR_X, STAR_Y } from "./constants";
import { deltaX, deltaY, sweptTime } from "./geometry";

/** Anything with a centre on the field. */
export interface Positioned {
  x: number;
  y: number;
}

/** How far one body travelled over the tick, on each axis. */
export interface Move {
  x: number;
  y: number;
}

/** Every body's motion over the current tick, keyed by the body itself. */
export type MoveTable = Map<Positioned, Move>;

const STILL: Move = { x: 0, y: 0 };

/** The star's core: fixed at the field's centre and never moving. */
export const CORE: Positioned = { x: STAR_X, y: STAR_Y };

/** Record how far a body travelled over this tick. */
export function recordMove(
  moves: MoveTable,
  body: Positioned,
  x: number,
  y: number,
): void {
  moves.set(body, { x, y });
}

/** How far a body travelled over this tick; nothing, for one that was added. */
export function moveOf(moves: MoveTable, body: Positioned): Move {
  return moves.get(body) ?? STILL;
}

/**
 * The fraction of the tick at which two bodies' circles first touched, or `null`
 * when they never did. Both paths are taken across the seams, so a pair touching
 * across a wrap collides like any other.
 */
export function sweptPair(
  moves: MoveTable,
  a: Positioned,
  b: Positioned,
  radius: number,
): number | null {
  const ma = moveOf(moves, a);
  const mb = moveOf(moves, b);
  return sweptTime(
    deltaX(a.x - ma.x, b.x - mb.x),
    deltaY(a.y - ma.y, b.y - mb.y),
    mb.x - ma.x,
    mb.y - ma.y,
    radius,
  );
}
