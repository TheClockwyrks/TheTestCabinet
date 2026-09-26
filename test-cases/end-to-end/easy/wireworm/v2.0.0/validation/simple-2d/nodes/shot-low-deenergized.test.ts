// nodes/shot-low-deenergized — a bolt into a charge-1 node leaves it standing at 0.
//
// specs/nodes.md fixes what a bolt does to a node by the charge it struck, and the
// second row of that table is charge `1`: "The node is left standing at charge
// `0`." A bolt "never raises a node's charge", and a charged node "is cleared by
// knocking its charge down one bolt at a time and removing it once it is inert" —
// so the strike is one step down the ramp, not a removal.
//
// THE WORLD IS ONE NODE AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the node the rule is
// about and a bolt four tiles below it in the same column. Nothing else stands in
// that column, so specs/cursor.md leaves the node as the first thing the bolt's
// centre reaches, and the bolt resolves against it and nothing else.
//
// STANDING AT 0 AND GONE ARE DIFFERENT ANSWERS. `chargeAt` reports `0` for a tile
// that holds an inert node and `null` for one that holds none, so a build that
// clears a charged node outright fails here and reads differently from a build
// that left it alone (`1`) or knocked it two levels (`null`).
//
// EACH ROW OF THE TABLE IS ITS OWN POINT, because a build can get one right and
// another wrong: `nodes.shot-inert-cleared` reads the row above this one,
// `nodes.shot-mid-deenergized` the row below, and `discharge.critical-detonates`
// the last.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertEqual } from "../assert";
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

/** The charge the node is posed at, and the charge the table leaves it at. */
const POSED_CHARGE = 1;
const AFTER_STRIKE = 0;

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

it("leaves a charge-1 node standing at charge 0 after a bolt", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);
  poseBolt(h, NODE_C, NODE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "deenergized");

  assertEqual(
    chargeAt(h.snapshot(), NODE_C, NODE_R),
    AFTER_STRIKE,
    `the node at (${NODE_C}, ${NODE_R}) after a bolt struck it at charge 1`,
  );
});
