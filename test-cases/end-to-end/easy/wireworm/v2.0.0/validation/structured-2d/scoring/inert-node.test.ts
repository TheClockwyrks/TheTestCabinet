// scoring/inert-node — a bolt into an inert node pays SCORE_INERT_NODE.
//
// specs/scoring.md: "A bolt removes an inert node" pays SCORE_INERT_NODE (1).
// One node is posed at charge 0, which specs/nodes.md is the charge a bolt
// removes the node at, and nothing else stands on the board — so every wrong
// model reads as a different number: paying nothing reads 0, paying the purge
// figure a discharge pays per node reads 5, and paying a segment's figure reads
// 10 or 100.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, SCORE_INERT_NODE } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The node the bolt removes. Row 10 is in the open middle of the board, clear of
 * the entry row 0 and of the player band, rows 18 and 19 (specs/board.md), so
 * the shot is decided by the node alone.
 */
const NODE_COL = 20;
const NODE_ROW = 10;

/** Inert, which is the one charge a bolt removes a node at (specs/nodes.md). */
const INERT_CHARGE = 0;

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

it("pays exactly SCORE_INERT_NODE for an inert node a bolt removes", async () => {
  resetTo(harness);
  startPlaying(harness);

  harness.debug.setNode(NODE_COL, NODE_ROW, INERT_CHARGE);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, NODE_COL, NODE_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    SCORE_INERT_NODE,
    "the score the bolt into the inert node added",
  );
});
