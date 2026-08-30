// scoring/fried-segment — a discharge pays SCORE_FRY for EVERY segment it destroys.
//
// specs/scoring.md: "A discharge destroys a worm segment" pays SCORE_FRY (10),
// and "SCORE_FRY is paid for every segment a discharge destroys, whatever its
// place in the chain". The figure is per segment rather than per discharge or
// per worm, so the scenario puts FOUR segments of one worm inside the reach of a
// single detonation and every wrong model reads as a different number: paying
// per discharge or per worm reads 15, paying nothing for the fry reads 5, and
// paying the figure four times over reads 45.
//
// One node stands on the board and one detonates, so the purge component of the
// award is fixed at SCORE_PURGE_NODE (5) and everything else in the reading is
// the fry. What a discharge pays per node is scoring/purge-node's requirement,
// and how far its reach carries is discharge/fries-segments-in-reach's; both are
// held constant here so the only free figure is the one this point names.
//
// The fifth segment stands one column beyond the reach, so a worm survives the
// discharge. A level clears on the step in which the LAST of its segments is
// removed (specs/progression.md), and the clear bonus would otherwise land in
// this same reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWormPath,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The critical node the bolt detonates. Row 12 leaves the bolt a clear climb
 * from the tile below it and keeps the worm above it clear of the player band,
 * rows 18 and 19 (specs/board.md).
 */
const NODE_COL = 20;
const NODE_ROW = 12;

/**
 * The row the worm is laid along: exactly DISCHARGE_RADIUS (2) rows above the
 * node, so a segment's Chebyshev distance from the detonated tile is decided by
 * its column alone (specs/discharge.md).
 */
const WORM_ROW = NODE_ROW - DISCHARGE_RADIUS;

/**
 * The four columns inside the reach, head first. Each lies within
 * DISCHARGE_RADIUS columns of the node, so each segment is destroyed.
 */
const FRIED_COLS = [
  NODE_COL + 1,
  NODE_COL,
  NODE_COL - 1,
  NODE_COL - 2,
] as const;

/** The tail column, one past the reach, whose segment survives the discharge. */
const SPARED_COL = NODE_COL - DISCHARGE_RADIUS - 1;

/**
 * What the discharge owes: SCORE_PURGE_NODE for the one node it removes, and
 * SCORE_FRY for each of the four segments it destroys (specs/scoring.md).
 */
const EXPECTED_AWARD = SCORE_PURGE_NODE + SCORE_FRY * FRIED_COLS.length;

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

it("pays SCORE_FRY once for each segment the discharge destroys", async () => {
  resetTo(harness);
  startPlaying(harness);

  const worm = poseWormPath(harness, [
    ...FRIED_COLS.map((c) => ({ c, r: WORM_ROW })),
    { c: SPARED_COL, r: WORM_ROW },
  ]);
  harness.debug.setWormStepping(worm, false);
  harness.debug.setNode(NODE_COL, NODE_ROW, CHARGE_MAX);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, NODE_COL, NODE_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_PURGE_NODE} for the node purged and ${SCORE_FRY} for each of the ` +
      `${FRIED_COLS.length} segments fried`,
  );
});
