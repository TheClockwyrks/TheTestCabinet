// scoring/deenergize-scores-nothing — knocking a node's charge down pays nothing.
//
// specs/scoring.md lists every figure the game pays and then closes the list:
// "Nothing else scores. A bolt that knocks a node's charge down one level pays
// nothing". The node is posed at charge `2`, which specs/nodes.md leaves standing
// at charge `1` under a bolt, so the strike is a de-energizing rather than a
// removal or a detonation, and the score is required to be exactly where it was.
//
// THE READING IS A ZERO DELTA, so the check first establishes that the bolt
// resolved against the node at all: a build whose bolts pass through everything
// would leave the score alone for the wrong reason and read as a pass. The node no
// longer standing at charge `2` is that evidence, and it separates a build that
// scored nothing because it de-energized from one that scored nothing because it
// never struck. What the charge falls TO is `nodes.shot-mid-deenergized`'s
// requirement; this point reads only that the strike happened and what it paid.
//
// CHARGE 2 IS THE DISTINGUISHING POSE. From it, "de-energized", "removed", "left
// alone" and "detonated" are four different states of the tile (specs/nodes.md),
// so a build that took the wrong branch is caught by the evidence line rather than
// slipping through the zero.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  chargeAt,
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

/**
 * Charged: the charge specs/nodes.md leaves standing at `1` under a bolt, so the
 * strike is a de-energizing and not a removal or a detonation.
 */
const POSED_CHARGE = 2;

/** What a de-energizing pays (specs/scoring.md, "Nothing else scores"). */
const EXPECTED_AWARD = 0;

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

it("leaves the score alone when a bolt knocks a node's charge down", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, POSED_CHARGE);

  const before = h.snapshot().score;
  poseBolt(h, NODE_C, NODE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "unchanged");

  const after = h.snapshot();
  assertNotEqual(
    chargeAt(after, NODE_C, NODE_R),
    POSED_CHARGE,
    `the bolt to have resolved against the charged node at (${NODE_C}, ${NODE_R})`,
  );
  assertEqual(
    after.score - before,
    EXPECTED_AWARD,
    "the score the de-energizing added",
  );
});
