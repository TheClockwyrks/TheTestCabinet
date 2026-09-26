// cursor/move-speed — a held movement key moves the cursor at CURSOR_SPEED.
//
// `specs/cursor.md`: "While a movement is held the cursor travels at
// `CURSOR_SPEED` (`430`) units per second, integrated against the delta time of
// each update. The rate is the same in every direction."
//
// TWO HORIZONTAL PROBES, AND NO VERTICAL ONE. `specs/board.md` confines the
// cursor's centre y to `[672, 704]`, a band 32 units tall, which a cursor moving
// at the stated rate crosses in 0.074 s. A one-second vertical hold would
// therefore measure the clamp and report 32 units per second on a build that was
// exactly right — so the rate is read on the axis that has room for it, and the
// vertical keys are graded for DIRECTION by `controls.up-arrow` and
// `controls.down-arrow`.
//
// BOTH PROBES START MID-BAND AND END WELL CLEAR OF A BOUND. `BAND_CX` is 640, so
// a correct build finishes at 210 going left and 1070 going right, each 194
// units inside the bound it is heading for. A build 40% faster than the
// specification would still not reach a bound inside the window, so nothing this
// point reads can be blunted by the clamp `cursor.clamped-left` and
// `cursor.clamped-right` grade.
//
// THE READING IS A MAGNITUDE, NOT A SIGNED DISPLACEMENT. Which way a key sends
// the cursor is `controls.left-arrow`'s and `controls.right-arrow`'s
// requirement; a build that moved the wrong way at exactly the right rate is
// docked there and passes here, which is what keeps one defect from costing two
// grades.
//
// THE WORLD IS THE CURSOR ALONE, as `startPlaying` leaves it: no node, no
// segment, no foe and no bolt, so nothing on the board can reach the cursor
// while the key is held.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CX, BAND_CY, CURSOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";

/** The keys bound to `left` and `right` (`specs/controls.md`). */
const LEFT_KEY = "ArrowLeft";
const RIGHT_KEY = "ArrowRight";

/** The measured hold, in frames of the harness's 100 Hz clock: one second. */
const HOLD_FRAMES = framesFor(1);

/**
 * How far the cursor travels in the measured window, in logical units.
 *
 * `CURSOR_SPEED` integrated over the window's own duration rather than over the
 * nominal one second, so the figure is what the build was actually given: the
 * harness's clock divides a second into whole frames exactly, but the derivation
 * holds however the window rounds.
 */
const EXPECTED_TRAVEL = CURSOR_SPEED * seconds(HOLD_FRAMES);

/**
 * The review item's margin: five percent of the expected travel.
 *
 * 21.5 units on a 430-unit reading. Wide enough to absorb a build that
 * integrates its own frame's delta in a slightly different order, and far too
 * narrow to admit a wrong rate: the nearest plausible wrong answer is the
 * unnormalized diagonal `cursor.diagonal-speed` grades, 126 units away.
 */
const TRAVEL_TOLERANCE = EXPECTED_TRAVEL * 0.05;

/**
 * Frames of stillness recorded either side of the measured hold.
 *
 * They reach no assertion — the measurement is the displacement across the hold
 * alone. What they give the reviewer is context: a cursor at rest before the key
 * goes down and at rest after it comes up is what makes the span between them
 * read as the key's doing rather than as a jump cut.
 */
const REST_FRAMES = framesFor(0.1);

let h: Harness;

/** Hold `key` for the measured window and report how far the centre x moved. */
async function travelWhileHeld(key: string): Promise<number> {
  const before = (await h.snapshot()).cursor.x;
  await h.hold(key);
  try {
    await h.advance(HOLD_FRAMES);
  } finally {
    await h.release(key);
  }
  return Math.abs((await h.snapshot()).cursor.x - before);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("travels CURSOR_SPEED units in a second of held left", async () => {
  await startPlaying(h);
  await h.debug.setCursor(BAND_CX, BAND_CY);

  // The recorded probe. The rightward probe below measures the same figure and
  // needs no second recording of it, so the review item's one output is this one.
  const travelled = await captureReplay(h, "probe", async () => {
    await h.advance(REST_FRAMES);
    const moved = await travelWhileHeld(LEFT_KEY);
    await h.advance(REST_FRAMES);
    return moved;
  });

  assertLessThanOrEqual(
    Math.abs(travelled - EXPECTED_TRAVEL),
    TRAVEL_TOLERANCE,
    `the distance the cursor's centre x covered over ${HOLD_FRAMES} frames ` +
      `(${seconds(HOLD_FRAMES)} s) of held ${LEFT_KEY} from mid-band, against ` +
      `CURSOR_SPEED (${CURSOR_SPEED}) units per second — specs/cursor.md`,
  );
});

it("travels CURSOR_SPEED units in a second of held right", async () => {
  await startPlaying(h);
  await h.debug.setCursor(BAND_CX, BAND_CY);

  const travelled = await travelWhileHeld(RIGHT_KEY);

  assertLessThanOrEqual(
    Math.abs(travelled - EXPECTED_TRAVEL),
    TRAVEL_TOLERANCE,
    `the distance the cursor's centre x covered over ${HOLD_FRAMES} frames ` +
      `(${seconds(HOLD_FRAMES)} s) of held ${RIGHT_KEY} from mid-band, ` +
      `against CURSOR_SPEED (${CURSOR_SPEED}) units per second — ` +
      "specs/cursor.md",
  );
});
