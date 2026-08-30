// discharge/detonation — how this group sets a discharge off, and the two
// readings it takes off a snapshot. CASE-PROVIDED.
//
// Every point in this directory starts from one event, and only one: a bolt
// resolving against a critical node. `specs/nodes.md`'s bolt table fixes what
// that does — a bolt into a charge `3` node makes the node detonate, "as
// `specs/discharge.md` states" — and `specs/cursor.md` fixes how a bolt gets
// there: it climbs its column at `BOLT_SPEED` and resolves against the first
// node whose tile its centre is inside.
//
// So a scenario poses the critical node, puts a bolt on the centre of the tile
// directly BELOW it, and runs the frames the climb takes. The bolt is the real
// one — `addBolt` "then travels and resolves through the game's own shot rules"
// (`specs/instrumentation.md`) — so nothing here fabricates the detonation: the
// build's own shot code decides that it happens at all.
//
// This is a helper for THIS GROUP rather than for the shared harness, because it
// is the one compound move every point here makes and nothing outside here needs
// it. It fixes arrangement alone: not one threshold a point asserts is decided
// in this file.
//
// The two readings at the foot of the file are the same: local, because the
// shared harness carries `nodeAt`, `chargeAt` and `segmentTiles` but neither of
// these, and only this group asks for them. They read a snapshot and decide
// nothing.

import { BOLT_SPEED, CHARGE_MAX, TILE } from "../constants";
import {
  poseBolt,
  TICK_HZ,
  type ArcView,
  type Harness,
  type Tile,
  type WirewormSnapshot,
  type WormView,
} from "../harness";

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
 * Frames {@link detonate} runs: enough for the bolt's centre to cross into the
 * target tile and no more than it takes to leave again.
 *
 * The window is deliberately closed at the far end. Every frame of it has the
 * bolt's centre inside the tile the critical node stands on, so a build that
 * resolves a shot at any point in the tile resolves it here, and a build that
 * does not is never carried past the node into whatever else stands in the
 * column.
 */
export const FLIGHT_FRAMES = FRAMES_TO_ENTER + FRAMES_INSIDE - 1;

/**
 * Pose a critical node on tile `(c, r)`, fire a bolt into it, and run the frames
 * the shot takes to arrive.
 *
 * The caller has already posed whatever the point is about — the cluster around
 * the node, the worm standing in the blast — so the board the chain resolves on
 * is the one the point named. The column below `(c, r)` carries nothing but the
 * bolt in every scenario here, so the node the shot resolves against is this one.
 */
export async function detonate(
  h: Harness,
  c: number,
  r: number,
): Promise<void> {
  await h.debug.setNode(c, r, CHARGE_MAX);
  await poseBolt(h, c, r + 1);
  await h.advance(FLIGHT_FRAMES);
}

/** The worm holding a segment on tile `(c, r)`, or `undefined` when none does. */
export function wormOn(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): WormView | undefined {
  return snapshot.worms.find((worm) =>
    worm.segments.some((segment) => segment.c === c && segment.r === r),
  );
}

/** Whether the live arcs report a link between two tiles, in either order. */
export function arcJoins(
  snapshot: WirewormSnapshot,
  a: Tile,
  b: Tile,
): boolean {
  const same = (left: Tile, right: Tile): boolean =>
    left.c === right.c && left.r === right.r;
  return snapshot.arcs.some(
    (arc: ArcView) =>
      (same(arc.from, a) && same(arc.to, b)) ||
      (same(arc.from, b) && same(arc.to, a)),
  );
}
