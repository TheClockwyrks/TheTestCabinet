// scoring/victory-bonus — winning pays SCORE_VICTORY per life remaining.
//
// specs/scoring.md: "The run is won" pays SCORE_VICTORY (250) times "the lives
// remaining", and "the victory bonus is paid on top of level 12's clear bonus".
// The run is posed with two lives left, so the figure scales and every wrong
// model reads as a different number: paying a flat 250 leaves the reading 250
// short, paying for the three lives a run starts with leaves it 250 over, and
// paying nothing for the victory leaves it 500 short.
//
// The run is won the way specs/progression.md says it is won: "the last worm
// segment of level 12 is removed". The board carries one worm of one segment at
// level TOTAL_LEVELS, which specs/worm.md calls a head alone, so the single bolt
// below is that removal. It therefore pays three figures at once — SCORE_HEAD
// for the kill, SCORE_LEVEL_CLEAR times 12 for the clear, and the victory bonus
// on top — and the reading is the sum; head-segment and level-clear-bonus grade
// the first two, and the victory bonus is what is left over.
//
// The worm is posed with its step held. Where the head winds has nothing to do
// with what victory pays, and with the step off the strike and the win it
// triggers are the only things in the scenario that can move the score.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  SCORE_HEAD,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  TOTAL_LEVELS,
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
 * The lives standing when the run is won. Two, so SCORE_VICTORY times the lives
 * is a different figure from SCORE_VICTORY itself and from the three lives a run
 * starts with (specs/progression.md).
 */
const LIVES_AT_VICTORY = 2;

/**
 * Where the worm's one segment stands. Row 10 is in the open middle of the
 * board, clear of the entry row 0 and of the player band, rows 18 and 19
 * (specs/board.md).
 */
const WORM_COL = 20;
const WORM_ROW = 10;

/**
 * What the whole scenario owes: SCORE_HEAD for the segment the bolt destroys,
 * SCORE_LEVEL_CLEAR times TOTAL_LEVELS for the clear that removal is, and
 * SCORE_VICTORY times the lives remaining on top of it (specs/scoring.md).
 */
const EXPECTED_AWARD =
  SCORE_HEAD +
  SCORE_LEVEL_CLEAR * TOTAL_LEVELS +
  SCORE_VICTORY * LIVES_AT_VICTORY;

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

it("pays SCORE_VICTORY per life on top of level 12's clear bonus", async () => {
  resetTo(harness);
  startPlaying(harness);
  harness.debug.setLevel(TOTAL_LEVELS);
  harness.debug.setLives(LIVES_AT_VICTORY);

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
    `${SCORE_HEAD} for the head shot, ` +
      `${SCORE_LEVEL_CLEAR * TOTAL_LEVELS} for clearing level ${TOTAL_LEVELS}, ` +
      `and ${SCORE_VICTORY * LIVES_AT_VICTORY} for the ${LIVES_AT_VICTORY} ` +
      `lives left`,
  );
});
