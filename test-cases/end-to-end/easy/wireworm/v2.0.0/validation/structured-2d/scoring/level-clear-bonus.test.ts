// scoring/level-clear-bonus — clearing a level pays SCORE_LEVEL_CLEAR per level.
//
// specs/scoring.md: "A level is cleared" pays SCORE_LEVEL_CLEAR (100) times "the
// level just cleared". The level is posed at 4 rather than at 1, so the figure
// scales and every wrong model reads as a different number: paying a flat 100
// reads 200 across the whole scenario, paying for the level about to open reads
// 600, and paying nothing for the clear reads 100.
//
// The level is cleared the way specs/progression.md says it is cleared: "on the
// step in which the last of its worm segments is removed". The board carries one
// worm of one segment, which specs/worm.md calls a head alone, so the single
// bolt below is that removal. The kill therefore pays SCORE_HEAD as well, and
// the reading is the pair; head-segment grades the kill's own figure, and the
// clear bonus is what is left over.
//
// The worm is posed with its step held. Where the head winds has nothing to do
// with what the clear pays, and with the step off the strike and the clear it
// triggers are the only things in the scenario that can move the score.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  SCORE_HEAD,
  SCORE_LEVEL_CLEAR,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The level being cleared. Four, so SCORE_LEVEL_CLEAR times the level is a
 * different figure from SCORE_LEVEL_CLEAR itself, from the level above it, and
 * from the level below it.
 */
const CLEAR_LEVEL = 4;

/**
 * Where the worm's one segment stands. Row 10 is in the open middle of the
 * board, clear of the entry row 0 and of the player band, rows 18 and 19
 * (specs/board.md).
 */
const WORM_COL = 20;
const WORM_ROW = 10;

/**
 * What the whole scenario owes: SCORE_HEAD for the segment the bolt destroys,
 * which specs/worm.md makes the head of a one-segment worm, and
 * SCORE_LEVEL_CLEAR times CLEAR_LEVEL for the clear that removal is
 * (specs/scoring.md).
 */
const EXPECTED_AWARD = SCORE_HEAD + SCORE_LEVEL_CLEAR * CLEAR_LEVEL;

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

it("pays SCORE_LEVEL_CLEAR times the level on the clearing removal", async () => {
  resetTo(harness);
  startPlaying(harness);
  harness.debug.setLevel(CLEAR_LEVEL);

  const worm = poseWorm(harness, WORM_COL, WORM_ROW);
  harness.debug.setWormStepping(worm, false);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, WORM_COL, WORM_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    EXPECTED_AWARD,
    `${SCORE_HEAD} for the head shot and ` +
      `${SCORE_LEVEL_CLEAR * CLEAR_LEVEL} for clearing level ${CLEAR_LEVEL}`,
  );
});
