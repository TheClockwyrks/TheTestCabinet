// nodes/shared-tile-keeps-charge — a bolt into a shared tile leaves the charge alone.
//
// Two sentences of specs/nodes.md meet on one tile. On what a bolt does: "A bolt
// that resolves against a worm segment standing on a tile a node also occupies
// leaves that node's charge exactly as it was. The segment is what the bolt
// struck." And on how the field grows: "Where that tile already holds a node, no
// new node is laid and the standing node keeps the charge it had." specs/cursor.md
// fixes which of the two the bolt resolves against: "Where a worm segment and a
// node share a tile, the bolt resolves against the segment."
//
// THE NODE IS POSED AT CHARGE 2, and that is the whole point of the arrangement:
// `2` is the only charge from which every wrong model reads back as its own
// number. Left alone reads 2; a build that laid a fresh node over it reads 0; a
// build whose bolt resolved against the NODE instead of the segment reads 1, one
// step down specs/nodes.md's table; and a build that cleared or detonated the tile
// leaves it empty. Posed at `0` the first two answers would be the same value.
//
// THE TAIL IS WHAT SHARES THE TILE. A two-segment worm is posed with its head one
// tile along its heading and its tail on the node, and both of its faculties are
// off, so specs/instrumentation.md leaves it taking no step and following nothing:
// the bolt strikes the tail on the tile the pose put it on. The bolt is posed in
// that column four tiles below, and nothing else stands in the column, so the tail
// is the first thing its centre reaches.
//
// WHAT THIS DOES NOT DECIDE. That the strike leaves one worm a segment shorter
// with the same head is `worm.shot-tail-shortens`'s requirement, so a build that
// mishandles the shortening is docked there and not twice. This point asserts the
// CHARGE alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the node and the worm's tail share, clear of the edges and the band. */
const SHARED_C = 20;
const SHARED_R = 10;

/** The charge the shared node is posed and read at. */
const SHARED_CHARGE = 2;

/** How far below the shared tile the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the shared tile, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the segment's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the charge-2 node under a shot tail at charge 2", async () => {
  startPlaying(h);
  h.debug.setNode(SHARED_C, SHARED_R, SHARED_CHARGE);
  // `poseWorm` lays the body behind the head along its heading, so a two-segment
  // worm headed right from `SHARED_C + 1` puts its tail on the node's tile.
  const worm = poseWorm(h, SHARED_C + 1, SHARED_R, 2, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBolt(h, SHARED_C, SHARED_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "shared");

  assertEqual(
    chargeAt(h.snapshot(), SHARED_C, SHARED_R),
    SHARED_CHARGE,
    `the charge on the node at (${SHARED_C}, ${SHARED_R}) under the struck tail`,
  );
});
