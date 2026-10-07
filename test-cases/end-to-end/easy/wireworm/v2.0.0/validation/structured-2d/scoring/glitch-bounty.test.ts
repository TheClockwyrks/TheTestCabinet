// scoring/glitch-bounty — destroying a glitch pays SCORE_GLITCH.
//
// specs/scoring.md: "A glitch is destroyed" pays SCORE_GLITCH (300), against
// SCORE_DROPPER (200) and SCORE_CORRUPTOR (1000) for the other two foes, and the
// bounty is "paid on the bolt that destroys it". A glitch takes one bolt
// (specs/foes.md), so the one shot below is the whole event and every wrong
// model reads as a different number: paying another foe's bounty reads 200 or
// 1000, and paying nothing reads 0.
//
// The glitch is posed with both of its faculties held. Its travel would carry it
// out of the bolt's column at GLITCH_H_SPEED and down the board at
// GLITCH_V_SPEED, and its mind is the darting and the eating; neither has
// anything to do with what its death pays, so the foe stands still on the tile
// it was placed on and the shot is the only thing in the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, SCORE_GLITCH } from "../constants";
import { assertEqual } from "../assert";
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

it("pays exactly SCORE_GLITCH for a glitch a bolt destroys", async () => {
  resetTo(harness);
  startPlaying(harness);

  const glitch = poseFoe(harness, "glitch", FOE_COL, FOE_ROW);
  harness.debug.setFoeTravel(glitch, false);
  harness.debug.setFoeMind(glitch, false);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, FOE_COL, BOLT_ROW);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    SCORE_GLITCH,
    "the score the glitch's death added",
  );
});
