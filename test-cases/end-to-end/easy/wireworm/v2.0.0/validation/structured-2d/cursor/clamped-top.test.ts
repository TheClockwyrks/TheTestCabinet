// cursor/clamped-top — the cursor driven up rests on the band's top bound.
//
// specs/cursor.md: the cursor's centre is clamped to the band's four bounds,
// `CURSOR_Y_MIN` (672) among them, "so it never leaves the band. A movement held
// against a bound leaves the cursor resting exactly on that bound."
//
// WHY THIS PAIR POSES AT THE OPPOSITE BOUND RATHER THAN 120 UNITS INSIDE. The
// band is 32 units tall — `y` in [672, 704] (specs/board.md) — so it cannot hold
// the 120-unit inset the horizontal pair uses: `setCursor` takes a position
// inside the band and fails loudly outside it, so a pose 120 units inside a
// vertical bound could not be made at all. The cursor is posed at
// `CURSOR_Y_MAX` instead, the far side of
// the band, which is the widest vertical run the band has.
//
// The window is a whole second, thirteen times the 0.074 s a cursor at
// `CURSOR_SPEED` (430) takes to cross 32 units, so what is read is the clamp and
// not the rate.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
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

it("rests on CURSOR_Y_MIN with the up movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MAX);

  // Sampled every frame of the drive, so a cursor that passed the bound and
  // sprang back is read rather than missed between two samples.
  let lowest = h.snapshot().cursor.y;
  holdAction(h, "up");
  try {
    for (let frame = 0; frame < HOLD_TICKS + SETTLE_TICKS; frame += 1) {
      await h.advance(1);
      lowest = Math.min(lowest, h.snapshot().cursor.y);
    }
  } finally {
    releaseAction(h, "up");
  }
  const resting = h.snapshot().cursor.y;
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_Y_MIN),
    BOUND_TOLERANCE,
    `the cursor's centre y after ${HOLD_TICKS + SETTLE_TICKS} frames of ` +
      `held "up" movement, against CURSOR_Y_MIN (${CURSOR_Y_MIN}) — ` +
      `specs/cursor.md and specs/board.md`,
  );
  assertGreaterThanOrEqual(
    lowest,
    CURSOR_Y_MIN - BOUND_TOLERANCE,
    "the lowest centre y the cursor reported at any frame of the hold, against " +
      `CURSOR_Y_MIN (${CURSOR_Y_MIN})`,
  );
});
