// scoring/bonus-life — crossing a multiple of BONUS_LIFE_EVERY through play grants a life.
//
// specs/scoring.md: "One extra life is granted each time the score crosses a
// multiple of BONUS_LIFE_EVERY (12,000) through play." The score is posed 50
// short of the first multiple and a real scoring event carries it across: a
// glitch's bounty of SCORE_GLITCH (300) takes 11,950 to 12,250, which is over
// the boundary and well short of the next one, so exactly one multiple is
// crossed and exactly one life is owed.
//
// The lives are posed at 1 rather than at the three a run starts with
// (specs/progression.md), so every wrong model reads as a different number: a
// build that grants no life reads 1, one that grants a life for every multiple
// BELOW the new score rather than for the ones crossed reads 2 as well but is
// separated by the sibling point below, and one that hands the run a fresh set
// of starting lives reads 3.
//
// The crossing is made THROUGH PLAY. The other direction — that posing the score
// across the boundary with setScore grants nothing, because the award belongs to
// the scoring path — is instrumentation/set-score-grants-no-life.
//
// The glitch is posed with both of its faculties held. Its travel would carry it
// out of the bolt's column and its mind is the darting and the eating; neither
// has anything to do with the life the award earns, so the foe stands still on
// the tile it was placed on and the shot is the only thing in the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, BONUS_LIFE_EVERY } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseFoe,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The score the run is posed at: 50 short of the first multiple of
 * BONUS_LIFE_EVERY, so any of the game's figures carries it across and none of
 * them carries it across a second multiple.
 */
const POSED_SCORE = BONUS_LIFE_EVERY - 50;

/**
 * The lives standing before the award. One, so the life granted reads apart from
 * the three a run starts with (specs/progression.md).
 */
const LIVES_BEFORE = 1;

/** How many multiples the award crosses, and so how many lives it owes. */
const LIVES_GRANTED = 1;

/**
 * Where the glitch stands. Row 10 is in the open middle of the board, clear of
 * the entry row 0 and of the player band, rows 18 and 19 (specs/board.md).
 */
const FOE_COL = 20;
const FOE_ROW = 10;

/**
 * The tile the bolt is placed on: two rows below the foe, so it starts 64 units
 * beneath the foe's center and well outside the foe's box, which reaches
 * FOE_HALF (12) units from that center (specs/cursor.md).
 */
const BOLT_ROW = FOE_ROW + 2;

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

it("grants one life when real scoring carries the score across 12,000", async () => {
  resetTo(harness);
  startPlaying(harness);
  harness.debug.setScore(POSED_SCORE);
  harness.debug.setLives(LIVES_BEFORE);

  const glitch = poseFoe(harness, "glitch", FOE_COL, FOE_ROW);
  harness.debug.setFoeTravel(glitch, false);
  harness.debug.setFoeMind(glitch, false);

  poseBoltAtTile(harness, FOE_COL, BOLT_ROW);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "bonus");

  const after = harness.snapshot();
  assertGreaterThanOrEqual(
    after.score,
    BONUS_LIFE_EVERY,
    "the kill to have carried the score across BONUS_LIFE_EVERY",
  );
  assertEqual(
    after.lives,
    LIVES_BEFORE + LIVES_GRANTED,
    "one extra life for the multiple the award crossed",
  );
});
