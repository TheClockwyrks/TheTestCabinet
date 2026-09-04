// scoring/fried-segment — a discharge pays SCORE_FRY for EVERY segment it destroys.
//
// specs/scoring.md: "A discharge destroys a worm segment" pays `SCORE_FRY` (`10`),
// and the figure is paid "for every segment a discharge destroys, whatever its
// place in the chain". It is per segment rather than per discharge or per worm, so
// the scenario puts FOUR segments of one worm inside the reach of a single
// detonation and every wrong model reads as a different number: paying per
// discharge or per worm reads `15`, paying nothing for the fry reads `5`, and
// paying twice over reads `85`.
//
// ONE NODE STANDS AND ONE DETONATES, so the purge half of the award is pinned at
// `SCORE_PURGE_NODE` (`5`) and everything else in the reading is the fry. What a
// discharge pays per node is `scoring.purge-node`'s requirement and how far its
// reach carries is `discharge.fries-segments-in-reach`'s; both are held constant
// here so the only free figure is the one this point names. The fried segments
// leave nothing behind (specs/discharge.md), so no laid node can pay either.
//
// THE FIFTH SEGMENT STANDS ONE COLUMN BEYOND THE REACH, so a worm survives the
// discharge. A level clears on the step in which the LAST of its segments is
// removed (specs/progression.md), and the clear bonus would otherwise land in this
// same reading.
//
// THE WORM STANDS STILL. Both faculties are off, so specs/instrumentation.md
// leaves it taking no step and following nothing: each segment is where the pose
// put it when the chain resolves, and the discharge is the only thing in the
// scenario that can move the score.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
  SCORE_FRY,
  SCORE_PURGE_NODE,
  TILE,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The critical node the bolt detonates.
 *
 * Row 12 leaves the bolt a clear climb from four tiles below it and keeps the worm
 * two rows above it clear of the entry row `0` and of the player band, rows `18`
 * and `19` (specs/board.md).
 */
const NODE_C = 20;
const NODE_R = 12;

/**
 * The row the worm is laid along: exactly `DISCHARGE_RADIUS` (`2`) rows above the
 * node, so a segment's Chebyshev distance from the detonated tile is decided by
 * its column alone (specs/discharge.md).
 */
const WORM_R = NODE_R - DISCHARGE_RADIUS;

/**
 * Where the worm is posed, and how long it is.
 *
 * `poseWorm` lays the body behind the head along the row, so a head at
 * `NODE_C + 1` heading right occupies columns `21, 20, 19, 18, 17`. The first four
 * lie within `DISCHARGE_RADIUS` columns of the node and are fried; the fifth, at
 * `DISCHARGE_RADIUS + 1` columns away, is spared and keeps the level open.
 */
const HEAD_C = NODE_C + 1;
const WORM_LENGTH = 5;
const FRIED_SEGMENTS = 4;

/**
 * What the discharge owes: `SCORE_PURGE_NODE` for the one node it removes and
 * `SCORE_FRY` for each of the four segments it destroys (specs/scoring.md).
 */
const EXPECTED_AWARD = SCORE_PURGE_NODE + SCORE_FRY * FRIED_SEGMENTS;

/** How far below the critical node the bolt is posed, in tiles. */
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

it("pays SCORE_FRY once for each segment the discharge destroys", async () => {
  startPlaying(h);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  h.debug.setNode(NODE_C, NODE_R, CHARGE_MAX);

  const before = h.snapshot().score;
  poseBolt(h, NODE_C, NODE_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "scored");

  assertEqual(
    h.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_PURGE_NODE} for the one node purged and ${SCORE_FRY} for each of ` +
      `the ${FRIED_SEGMENTS} segments fried`,
  );
});
