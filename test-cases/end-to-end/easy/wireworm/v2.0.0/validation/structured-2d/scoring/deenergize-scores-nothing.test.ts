// scoring/deenergize-scores-nothing — knocking a node's charge down pays nothing.
//
// specs/scoring.md lists every figure the game pays and then closes the list:
// "Nothing else scores. A bolt that knocks a node's charge down one level pays
// nothing". The node is posed at charge 2, which specs/nodes.md leaves standing
// at charge 1 under a bolt, so the strike is a de-energizing rather than a
// removal or a detonation, and the score is required to be exactly where it was.
//
// The reading is a ZERO delta, so the check first establishes that the bolt
// resolved against the node at all: a build whose bolts pass through everything
// would leave the score alone for the wrong reason. The node's charge no longer
// standing at 2 is that evidence, and it separates a build that scored nothing
// because it de-energized from one that scored nothing because it never struck.
// What the charge falls TO is nodes/shot-mid-deenergized's requirement; this
// point reads only that the strike happened and what it paid.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The node the bolt de-energizes. Row 10 is in the open middle of the board,
 * clear of the entry row 0 and of the player band, rows 18 and 19
 * (specs/board.md), so the shot is decided by the node alone.
 */
const NODE_COL = 20;
const NODE_ROW = 10;

/**
 * Charged: the one posed charge from which "de-energized", "removed", "left
 * alone" and "detonated" all read as different states of the tile
 * (specs/nodes.md).
 */
const POSED_CHARGE = 2;

/** What a de-energizing pays (specs/scoring.md, "Nothing else scores"). */
const EXPECTED_AWARD = 0;

/**
 * How long the bolt is given to leave flight.
 *
 * A bolt climbs at BOLT_SPEED (900 units per second) and the board is BOARD_H
 * (640 units) tall (specs/cursor.md, specs/board.md), so one crosses the whole
 * board in 0.71 s. Twice that is the honest ceiling: past it the bolt has struck
 * something or passed the top of the board and gone, and the reading below is
 * taken either way.
 */
const BOLT_LIMIT_FRAMES = 2 * ticksFor(BOARD_H / BOLT_SPEED);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the score alone when a bolt knocks a node's charge down", async () => {
  resetTo(harness);
  startPlaying(harness);

  harness.debug.setNode(NODE_COL, NODE_ROW, POSED_CHARGE);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, NODE_COL, NODE_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "unchanged");

  const after = harness.snapshot();
  assertNotEqual(
    chargeAt(after, NODE_COL, NODE_ROW),
    POSED_CHARGE,
    "the bolt to have resolved against the charged node",
  );
  assertEqual(
    after.score - before,
    EXPECTED_AWARD,
    "the score the de-energizing added",
  );
});
