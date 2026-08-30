// cursor/bolt-vanishes-at-top — a bolt that reaches the top of the board leaves
// it.
//
// `specs/cursor.md`: "A bolt that reaches the top of the board without resolving
// against anything is gone: once its center passes `BOARD_Y` (`80`), it leaves
// the board and is removed from flight." `specs/board.md` puts the HUD bar in
// `y` in `[0, 80]` and states that no bolt is drawn in it.
//
// THE COLUMN IS EMPTY, so the only thing that can take the bolt out of flight is
// the top of the board. `startPlaying` clears the field and all three rosters,
// and this scenario adds one bolt and nothing else: a node, a segment or a foe
// anywhere above it would resolve the bolt early and this check would pass
// without the rule it decides ever having run.
//
// THE READING IS TAKEN EVERY FRAME, not once at the end. "Gone once its centre
// passes BOARD_Y" is a rule about where a bolt is allowed to be, and a build
// that carried its bolt up into the HUD bar for a while and dropped it
// afterwards would satisfy an end-of-window roster count while breaking the rule
// outright. So every frame of the climb is checked against the line, and the
// roster is read at the end.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_Y, BOLT_SPEED } from "../constants";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseBolt,
  seconds,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The column the bolt climbs, well clear of both side edges. */
const COLUMN = 12;

/** The row the bolt is posed on: the floor, whose centre y is 704. */
const START_ROW = 19;

/**
 * The drive, in frames of the harness's 100 Hz clock: 0.8 s.
 *
 * From row 19's centre (704) the line at `BOARD_Y` is 624 units up, which a bolt
 * at `BOLT_SPEED` crosses in 0.693 s. The drive runs 15% past that, so a build
 * whose bolt is a little slow still gets its bolt over the line inside the
 * window — the rate itself is `cursor.bolt-travels-up`'s requirement.
 */
const DRIVE_FRAMES = framesFor(0.8);

/** Bolts left in flight once the one posed has left the board. */
const BOLTS_AFTER = 0;

/**
 * How far past the line a bolt may still be REPORTED, in logical units.
 *
 * One frame of travel at `BOLT_SPEED` on the harness's clock, 9 units. The
 * removal is tested once per update, so a build that moves its bolts and tests
 * the line at the top of the following update reports the bolt one frame's
 * travel past `BOARD_Y` before dropping it — a ten-millisecond lag, and not the
 * defect this point exists to catch, which is a bolt that flies on into the HUD
 * bar and beyond.
 */
const OVERSHOOT = BOLT_SPEED / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the bolt out of flight as its centre passes BOARD_Y", async () => {
  await startPlaying(h);
  await poseBolt(h, COLUMN, START_ROW);

  let highestReached = (await h.snapshot()).bolts[0]?.y ?? BOARD_Y;
  for (let frame = 0; frame < DRIVE_FRAMES; frame += 1) {
    await h.advance(1);
    for (const bolt of (await h.snapshot()).bolts) {
      highestReached = Math.min(highestReached, bolt.y);
    }
  }
  await captureStill(h, "empty");

  assertGreaterThanOrEqual(
    highestReached,
    BOARD_Y - OVERSHOOT,
    "the highest a bolt's centre y was reported at any frame of the climb, " +
      `against BOARD_Y (${BOARD_Y}) — specs/cursor.md takes a bolt out of ` +
      "flight once its centre passes that line, and specs/board.md draws no " +
      "bolt in the HUD bar above it",
  );
  assertLength(
    (await h.snapshot()).bolts,
    BOLTS_AFTER,
    `bolts in flight after ${DRIVE_FRAMES} frames ` +
      `(${seconds(DRIVE_FRAMES)} s) up an empty column — at BOLT_SPEED ` +
      `(${BOLT_SPEED}) the one posed on row ${START_ROW} crosses BOARD_Y ` +
      "0.693 s in",
  );
});
