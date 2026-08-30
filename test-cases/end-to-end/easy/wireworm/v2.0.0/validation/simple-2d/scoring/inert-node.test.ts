// scoring/inert-node — a bolt into an inert node pays SCORE_INERT_NODE.
//
// specs/scoring.md: "A bolt removes an inert node" pays `SCORE_INERT_NODE` (`1`).
// The node is posed at charge `0`, which specs/nodes.md makes the one charge a
// bolt REMOVES a node at, so the strike is the event this figure is written for.
//
// THE WORLD IS ONE NODE AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back the node the rule is
// about and a bolt four tiles below it in the same column. Every wrong model of
// the figure therefore reads as a different number: paying nothing reads `0`,
// paying the `SCORE_PURGE_NODE` (`5`) a discharge pays per node reads `5`, and
// paying a segment's figure reads `10` or `100`.
//
// WHAT THIS DOES NOT DECIDE. That the tile is left empty is
// `nodes.shot-inert-cleared`'s requirement. This point reads the score alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, SCORE_INERT_NODE, TILE } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The tile the node stands on.
 *
 * Row 10 is in the open middle of the board: clear of the entry row `0` and of the
 * player band, rows `18` and `19` (specs/board.md), so the shot is decided by the
 * node alone.
 */
const NODE_C = 20;
const NODE_R = 10;

/** Inert, which is the one charge a bolt removes a node at (specs/nodes.md). */
const INERT_CHARGE = 0;

/** How far below the node the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the node, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the node's tile". Posed four tiles
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

it("pays exactly SCORE_INERT_NODE for an inert node a bolt removes", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, INERT_CHARGE);

  const before = h.snapshot().score;
  poseBolt(h, NODE_C, NODE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    SCORE_INERT_NODE,
    "the score the bolt into the inert node added",
  );
});
