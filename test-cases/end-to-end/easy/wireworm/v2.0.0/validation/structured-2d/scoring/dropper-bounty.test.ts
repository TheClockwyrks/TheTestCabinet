// scoring/dropper-bounty — destroying a dropper pays SCORE_DROPPER, once.
//
// specs/scoring.md: "A dropper is destroyed" pays SCORE_DROPPER (200), and "a
// foe's bounty is paid on the bolt that destroys it, so the first bolt into a
// dropper pays nothing and the second pays SCORE_DROPPER". A dropper takes two
// bolts (specs/foes.md), so the whole event is the pair of shots below and the
// figure the point reads is what the run's score is worth once the dropper is
// gone. Every wrong model reads as a different number: paying the bounty on each
// bolt reads 400, paying another foe's bounty reads 300 or 1000, and paying
// nothing reads 0.
//
// The dropper is posed with both of its faculties held. Its travel would carry
// it out of the bolt's column, and faster still once the first bolt has landed,
// since a struck dropper falls at DROPPER_SPEED_HIT; its mind is the node it
// lays on the tile beneath it. Neither has anything to do with what its death
// pays, so the foe stands still on the tile it was placed on and the two shots
// are the only things in the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, SCORE_DROPPER } from "../../src/constants";
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
 * Where the dropper stands. Row 10 is in the open middle of the board, clear of
 * the entry row 0 and of the player band, rows 18 and 19 (specs/board.md).
 */
const FOE_COL = 20;
const FOE_ROW = 10;

/**
 * The tile each bolt is placed on: two rows below the foe, so a bolt starts 64
 * units beneath the foe's center and well outside the foe's box, which reaches
 * FOE_HALF (12) units from that center (specs/cursor.md).
 */
const BOLT_ROW = FOE_ROW + 2;

/** How many bolts a dropper takes (specs/foes.md). */
const BOLTS_TO_KILL = 2;

/**
 * How long a bolt is given to leave flight.
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

it("pays exactly SCORE_DROPPER across the two bolts a dropper takes", async () => {
  resetTo(harness);
  startPlaying(harness);

  const dropper = poseFoe(harness, "dropper", FOE_COL, FOE_ROW);
  harness.debug.setFoeTravel(dropper, false);
  harness.debug.setFoeMind(dropper, false);

  const before = harness.snapshot().score;
  for (let shot = 0; shot < BOLTS_TO_KILL; shot += 1) {
    poseBoltAtTile(harness, FOE_COL, BOLT_ROW);
    await harness.until((snapshot) => snapshot.bolts.length === 0, {
      maxFrames: BOLT_LIMIT_FRAMES,
    });
  }

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    SCORE_DROPPER,
    "the score the dropper's two bolts added between them",
  );
});
