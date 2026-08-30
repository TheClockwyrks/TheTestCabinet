// scoring/body-segment — a bolt into a body segment pays SCORE_BODY.
//
// specs/scoring.md fixes the figure: "A bolt destroys any other worm segment"
// pays SCORE_BODY (10), against SCORE_HEAD (100) for the head, and "nothing else
// scores" — the fresh inert node the dead segment leaves behind (specs/nodes.md)
// pays nothing. Three segments are posed and the middle one is shot, so the
// segment struck is neither the head nor the tail and every wrong model of the
// figure reads as a different number: a build paying the head figure for every
// segment reads 100, one paying nothing reads 0, and one that also paid for the
// node the segment left reads 11.
//
// The worm is posed with its step held. What a kill pays has nothing to do with
// how the worm winds, so with the step off the strike is the only thing in the
// scenario that can move the score. Three segments also keep the level from
// clearing on the removal: a level clears on the step in which the LAST of its
// segments goes (specs/progression.md), and its bonus would land in this same
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, SCORE_BODY } from "../../src/constants";
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
 * The row the worm is laid along, and the column its head stands in.
 *
 * Row 10 is in the open middle of the board: clear of the entry row 0 and of the
 * player band, rows 18 and 19 (specs/board.md), so the shot is decided by the
 * worm alone.
 */
const WORM_ROW = 10;
const HEAD_COL = 20;
const BODY_COL = HEAD_COL - 1;
const TAIL_COL = HEAD_COL - 2;

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

it("pays exactly SCORE_BODY for a body segment a bolt destroys", async () => {
  resetTo(harness);
  startPlaying(harness);

  const worm = poseWormPath(harness, [
    { c: HEAD_COL, r: WORM_ROW },
    { c: BODY_COL, r: WORM_ROW },
    { c: TAIL_COL, r: WORM_ROW },
  ]);
  harness.debug.setWormStepping(worm, false);

  const before = harness.snapshot().score;
  poseBoltAtTile(harness, BODY_COL, WORM_ROW + 1);
  await harness.until((snapshot) => snapshot.bolts.length === 0, {
    maxFrames: BOLT_LIMIT_FRAMES,
  });

  await harness.advance(1);
  captureStill(harness, "scored");

  assertEqual(
    harness.snapshot().score - before,
    SCORE_BODY,
    "the score the bolt into the middle segment added",
  );
});
