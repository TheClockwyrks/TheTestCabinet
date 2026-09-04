// nodes/shot-inert-cleared — a bolt into an inert node removes it.
//
// specs/nodes.md fixes what a bolt does to a node by the charge it struck, and
// the first row of that table is charge `0`: "The node is removed and its tile is
// left empty."
//
// THE WORLD IS ONE NODE AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the node the rule is
// about and a bolt four tiles below it in the same column. Nothing else stands in
// that column, so specs/cursor.md leaves the node as the first thing the bolt's
// centre reaches, and the bolt resolves against it and nothing else.
//
// AN EMPTY TILE AND AN INERT NODE ARE DIFFERENT ANSWERS. `chargeAt` reports `null`
// for a tile that holds no node and `0` for a tile that holds an inert one, so
// this point and its two siblings read as three different numbers: a build that
// de-energizes an inert node instead of removing it reads `0` here, and one that
// leaves it alone reads `0` as well while `nodes.shot-low-deenergized` and
// `nodes.shot-mid-deenergized` separate the two.
//
// WHAT THIS DOES NOT DECIDE. That the bolt travels, and that it is consumed by the
// first thing in its column, are `cursor.bolt-travels-up`'s and
// `cursor.bolt-stops-at-node`'s requirements; that the clearance scores `1` is
// `scoring.inert-node`'s. This point reads the tile alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
import { assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the node stands on, well clear of every edge and of the band. */
const NODE_C = 20;
const NODE_R = 10;

/** How far below the node the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the node, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the node's tile". Posed four tiles
 * below the node, its centre starts `3.5` tiles — `112` units — under that tile's
 * lower edge, which is `0.124` s of flight. Twice that is the budget, so a
 * conforming build has ample room and a build whose bolt never resolves still
 * reaches a verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes an inert node the bolt struck, leaving the tile empty", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, 0);
  poseBolt(h, NODE_C, NODE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "cleared");

  assertNull(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    `the node at (${NODE_C}, ${NODE_R}) after a bolt struck it inert`,
  );
});
