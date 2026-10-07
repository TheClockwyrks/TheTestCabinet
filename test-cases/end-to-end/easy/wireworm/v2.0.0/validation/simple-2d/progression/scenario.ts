// Wireworm — the compound poses the `progression` checks share. CASE-PROVIDED.
//
// The debug surface is atomic by design (specs/instrumentation.md): every
// operation sets one field or adds one entity. A scenario that takes several of
// them in a fixed order therefore belongs beside the checks rather than inside
// each of them, and these two are the ones this group repeats.
//
// They are LOCAL to this group on purpose. Each FIXES ONLY GEOMETRY AND
// FACULTIES — which tile a segment stands on, which of its faculties are off,
// which column a bolt climbs. Not one of them carries a threshold, a duration or
// a tolerance: every figure a check asserts is stated in the check itself,
// derived from the spec figure it belongs to, so what a check requires is legible
// where the check is read.

import { poseBolt, poseWorm, tileOf, type Harness } from "../harness";

/**
 * How many tiles beneath its target {@link shootUpAt} poses its bolt.
 *
 * Far enough that the bolt is genuinely IN FLIGHT and resolves through the game's
 * own shot rules (specs/cursor.md) rather than starting already inside the tile
 * it is aimed at, and short enough that the flight is a fraction of a second.
 */
export const SHOT_GAP_ROWS = 3;

/**
 * Lay a single motionless worm segment inside the cursor's box, with the
 * cursor's contact test running, so the next update costs a life.
 *
 * `specs/cursor.md` states the contact: *a worm segment reaches the cursor when
 * the segment's tile overlaps the cursor's box*. The segment is laid on the tile
 * the cursor's own centre is standing on, so the overlap holds wherever in the
 * band the caller parked the cursor — call this AFTER any `setCursor`.
 *
 * BOTH FACULTIES ARE OFF. The segment neither steps nor follows, so the only rule
 * that can act on this board is the contact test, and a check that reads what the
 * contact did cannot be reading a worm that walked somewhere.
 *
 * `setCursorContact(true)` is the exception `startPlaying` names: the gate is
 * turned back on by the checks whose requirement the gate itself is.
 */
export function poseContact(h: Harness): number {
  h.debug.setCursorContact(true);
  const { x, y } = h.snapshot().cursor;
  const tile = tileOf(x, y);
  const id = poseWorm(h, tile.c, tile.r, 1);
  h.debug.setWormStepping(id, false);
  h.debug.setWormBody(id, false);
  return id;
}

/**
 * Lay a motionless worm of `length` segments, its head on `(c, r)`, and report
 * its id.
 *
 * {@link poseWorm} lays the body behind the head along its row and leaves both
 * faculties on; this turns both off, so the worm holds its tiles and is a target
 * and nothing else. A check about what REMOVING a segment does wants exactly
 * that: a worm that walked out from under the bolt would be a different scenario.
 */
export function poseStillWorm(
  h: Harness,
  c: number,
  r: number,
  length = 1,
): number {
  const id = poseWorm(h, c, r, length);
  h.debug.setWormStepping(id, false);
  h.debug.setWormBody(id, false);
  return id;
}

/**
 * Send one bolt up column `c`, from {@link SHOT_GAP_ROWS} tiles below row `r`.
 *
 * The bolt climbs and resolves through the game's own rules (specs/cursor.md), so
 * what removes the segment is a real shot rather than an operation that deletes
 * it.
 */
export function shootUpAt(h: Harness, c: number, r: number): number {
  return poseBolt(h, c, r + SHOT_GAP_ROWS);
}

/**
 * Turn the step and the body of every worm on the board off.
 *
 * Cutting a worm makes new worms (specs/worm.md), and the specification fixes
 * what a survivor inherits — the headings and the diving flag — without saying
 * anything about the two debug faculties, which are the harness's own handle
 * rather than a property of the game. A check that fires a SECOND bolt into a
 * survivor therefore re-poses the faculties first, so the survivor is standing
 * where the check left it whichever way a build carried them.
 */
export function stillEveryWorm(h: Harness): void {
  for (const worm of h.snapshot().worms) {
    h.debug.setWormStepping(worm.id, false);
    h.debug.setWormBody(worm.id, false);
  }
}
