// cursor/clamped-bottom — the cursor driven down rests on the band's bottom
// bound, the floor.
//
// specs/cursor.md: the cursor's centre is clamped to the band's four bounds,
// `CURSOR_Y_MAX` (704) among them, "so it never leaves the band. A movement held
// against a bound leaves the cursor resting exactly on that bound."
//
// The cursor is posed at `CURSOR_Y_MIN`, the opposite bound, for the reason
// `cursor/clamped-top` states: the band is 32 units tall, so it cannot hold the
// 120-unit inset the horizontal pair uses, and the far side of the band is the
// widest vertical run there is. A whole second is thirteen times the 0.074 s a
// cursor at `CURSOR_SPEED` (430) takes to cross the band, so what is read is the
// clamp and not the rate.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The hold, in frames: one second, as the review item states. */
const HOLD_TICKS = TICK_HZ;

/** Further held frames, so the reading is a rest rather than a passing. */
const SETTLE_TICKS = 24;

/**
 * How far off the bound the resting centre may be, in logical units.
 *
 * specs/cursor.md states the rest as exact — "resting exactly on that bound" —
 * so this allows the residue of a clamp computed rather than written down, and
 * nothing else: half a unit is under a pixel of the 1280x720 stage. The `none`
 * and `simple-2d` suites read the same figure.
 */
const BOUND_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rests on CURSOR_Y_MAX with the down movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MIN);

  // Sampled every frame of the drive, so a cursor that passed the bound and
  // sprang back is read rather than missed between two samples.
  let highest = h.snapshot().cursor.y;
  holdAction(h, "down");
  try {
    for (let frame = 0; frame < HOLD_TICKS + SETTLE_TICKS; frame += 1) {
      await h.advance(1);
      highest = Math.max(highest, h.snapshot().cursor.y);
    }
  } finally {
    releaseAction(h, "down");
  }
  const resting = h.snapshot().cursor.y;
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_Y_MAX),
    BOUND_TOLERANCE,
    `the cursor's centre y after ${HOLD_TICKS + SETTLE_TICKS} frames of ` +
      `held "down" movement, against CURSOR_Y_MAX (${CURSOR_Y_MAX}) — ` +
      `specs/cursor.md and specs/board.md`,
  );
  assertLessThanOrEqual(
    highest,
    CURSOR_Y_MAX + BOUND_TOLERANCE,
    "the highest centre y the cursor reported at any frame of the hold, against " +
      `CURSOR_Y_MAX (${CURSOR_Y_MAX})`,
  );
});
