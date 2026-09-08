// cursor/clamped-top — the cursor's centre stops at the band's top bound.
//
// specs/cursor.md: "Its center is clamped to the band's four bounds ...
// `CURSOR_Y_MIN` (`672`) ... A movement held against a bound leaves the cursor
// resting exactly on that bound."
//
// THE POSE IS THE OPPOSITE BOUND, NOT AN INSET, AND THAT IS NOT AN OVERSIGHT.
// specs/board.md gives the cursor `y` in `[672, 704]` — a band 32 units tall —
// so the 120-unit inset `cursor.clamped-left` and `cursor.clamped-right` use
// cannot be posed on this axis: `setCursor` takes a position inside the band and
// fails loudly outside it, and 120 units below `CURSOR_Y_MIN` is outside the
// band, so the pose could not be made at all. Posing at `CURSOR_Y_MAX`
// outright is the widest separation the band allows, and it smuggles in no rate:
// crossing 32 units inside a one-second hold asks for 32 units per second, under
// a tenth of `CURSOR_SPEED`, where the hold is thirteen times the 0.074 s the
// band takes to cross at the stated rate.
//
// WHAT THIS DOES NOT DECIDE. That `ArrowUp` is the key that moves up is
// `controls.up-arrow`'s requirement, and the rate is `cursor.move-speed`'s —
// which is measured horizontally for exactly the reason above. This point reads
// one number: where the cursor's centre y came to rest.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key bound to `up` (specs/controls.md). */
const KEY = "ArrowUp";

/**
 * The hold, in frames of the harness's 120 Hz clock: exactly one second.
 *
 * The band is `CURSOR_Y_MAX - CURSOR_Y_MIN` (32) units tall, which a cursor
 * travelling at `CURSOR_SPEED` crosses in 0.074 s, so the drive leaves the
 * cursor pressed against the bound for essentially all of its length.
 */
const HOLD_TICKS = ticksFor(1);

/**
 * How far off the bound the resting centre may be, in logical units.
 *
 * specs/cursor.md states the rest as exact, so this allows floating-point
 * residue and nothing else. Half a unit is below one screen pixel, and the other
 * bound of this axis is 32 units away — sixty-four times the tolerance — so a
 * build clamped to the wrong end of the band cannot slip through it.
 */
const BOUND_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rests the cursor's centre on CURSOR_Y_MIN and takes it no further", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MAX);

  // Sampled every frame, so "goes no lower" is read across the whole drive and
  // not only at the end of it.
  let lowest = h.snapshot().cursor.y;
  h.hold(KEY);
  try {
    for (let frame = 0; frame < HOLD_TICKS; frame += 1) {
      await h.advance(1);
      lowest = Math.min(lowest, h.snapshot().cursor.y);
    }
  } finally {
    h.release(KEY);
  }
  captureStill(h, "clamped");

  const resting = h.snapshot().cursor.y;
  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_Y_MIN),
    BOUND_TOLERANCE,
    `the cursor's centre y after ${HOLD_TICKS} frames of held ${KEY} from ` +
      `CURSOR_Y_MAX (${CURSOR_Y_MAX}), against CURSOR_Y_MIN ` +
      `(${CURSOR_Y_MIN}) — specs/cursor.md and specs/board.md`,
  );
  assertGreaterThanOrEqual(
    lowest,
    CURSOR_Y_MIN - BOUND_TOLERANCE,
    "the lowest centre y the cursor reported at any frame of the hold, " +
      `against CURSOR_Y_MIN (${CURSOR_Y_MIN})`,
  );
});
