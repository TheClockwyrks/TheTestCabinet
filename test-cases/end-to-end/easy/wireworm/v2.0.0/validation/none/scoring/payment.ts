// scoring/payment — how this group fires the one event a point is about, and the
// window it reads the score across. CASE-PROVIDED.
//
// Nearly every figure `specs/scoring.md` fixes is paid on a BOLT resolving: into
// a segment, into a node, into a foe, or into a critical node whose detonation
// chains. So the one compound move this directory makes over and over is the
// same one — pose a bolt on the centre of the tile directly BELOW the thing the
// point is about and run the frames its climb takes — and it lives here rather
// than in the shared harness because only this group and the discharge group
// make it, and the discharge group has its own.
//
// The bolt is the real one. `addBolt` "then travels and resolves through the
// game's own shot rules" (`specs/instrumentation.md`), so nothing here fabricates
// a hit: the build's own shot code decides that the event happened at all, and
// its own scoring code decides what the event pays.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own, beside the figure
// `specs/scoring.md` fixes for it.

import { BOLT_SPEED, CHARGE_MAX, TILE } from "../constants";
import { poseBolt, TICK_HZ, type Harness } from "../harness";

/** Logical units a bolt climbs in one frame of the suite's clock. */
const CLIMB_PER_FRAME = BOLT_SPEED / TICK_HZ;

/**
 * Frames the bolt's centre needs to rise out of the tile it was posed on and
 * into the tile above it.
 *
 * It starts on that tile's centre, which is `TILE / 2` (`16`) units below the
 * boundary between the two (`specs/board.md`'s tile-to-stage map).
 */
const FRAMES_TO_ENTER = Math.ceil(TILE / 2 / CLIMB_PER_FRAME);

/**
 * Further frames the centre stays inside the target tile once it is in.
 *
 * The tile is `TILE` (`32`) units tall, so the centre is inside it for that many
 * units of climb.
 */
const FRAMES_INSIDE = Math.floor(TILE / CLIMB_PER_FRAME);

/**
 * Frames {@link shootInto} runs: enough for the bolt's centre to cross into the
 * target tile, and no more than it takes to leave again.
 *
 * The window is closed at the far end on purpose. Every frame of it has the
 * bolt's centre inside the target tile, so a build that resolves a shot anywhere
 * in the tile resolves it here, and a build that does not is never carried on up
 * the column into whatever else stands there. It is a closed window for a foe
 * too: a foe posed on a tile's centre carries its box `FOE_HALF` (`12`) units
 * either side of it (`specs/cursor.md`), which the climb is inside for the last
 * frames of the same window.
 *
 * This is geometry rather than a tolerance: it says where the bolt is when the
 * drive stops, not how far a build may miss a figure by.
 */
export const FLIGHT_FRAMES = FRAMES_TO_ENTER + FRAMES_INSIDE - 1;

/**
 * Pose a bolt one row below tile `(c, r)`, run its climb into that tile, and hand
 * back its id.
 *
 * The starting tile has to be one the bolt should not resolve against, which on a
 * board posed by `startPlaying` is any tile the point has not put something on.
 * The id is handed back so a point that must know the shot LANDED — one whose
 * figure is zero, where a bolt sailing on up the column would otherwise read as a
 * pass — can see the bolt leave flight.
 */
export async function shootInto(
  h: Harness,
  c: number,
  r: number,
): Promise<number> {
  const id = await poseBolt(h, c, r + 1);
  await h.advance(FLIGHT_FRAMES);
  return id;
}

/**
 * Pose a critical node on tile `(c, r)` and fire a bolt into it, so the chain
 * `specs/discharge.md` states resolves on whatever board the caller posed.
 *
 * `specs/nodes.md`'s bolt table is what makes this a detonation: a bolt into a
 * charge `3` node makes the node detonate.
 */
export async function detonateAt(
  h: Harness,
  c: number,
  r: number,
): Promise<void> {
  await h.debug.setNode(c, r, CHARGE_MAX);
  await shootInto(h, c, r);
}
