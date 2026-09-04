// cursor/clamped-bottom — the cursor's centre stops at the band's floor bound.
//
// specs/cursor.md: "Its center is clamped to the band's four bounds ...
// `CURSOR_Y_MAX` (`704`) ... A movement held against a bound leaves the cursor
// resting exactly on that bound."
//
// THE POSE IS THE OPPOSITE BOUND, for the reason `cursor.clamped-top` states:
// the band is 32 units tall, so the 120-unit inset the horizontal pair uses
// cannot be posed on this axis at all — `setCursor` applies the real clamp and
// the pose would land on the bound being tested. Starting at `CURSOR_Y_MIN` is
// the widest separation the band allows, and crossing it inside a one-second
// hold asks for 32 units per second, under a tenth of `CURSOR_SPEED`.
//
// WHAT THIS DOES NOT DECIDE. That `ArrowDown` is the key that moves down is
// `controls.down-arrow`'s requirement. This point reads one number: where the
// cursor's centre y came to rest.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key bound to `down` (specs/controls.md). */
const KEY = "ArrowDown";

/**
 * The hold, in frames of the harness's 120 Hz clock: exactly one second.
 *
 * The band is 32 units tall, which a cursor travelling at `CURSOR_SPEED` crosses
 * in 0.074 s, so the drive leaves the cursor pressed against the bound for
 * essentially all of its length.
 */
const HOLD_TICKS = ticksFor(1);

/**
 * How far off the bound the resting centre may be, in logical units.
 *
 * specs/cursor.md states the rest as exact, so this allows floating-point
 * residue and nothing else. The other bound of this axis is 32 units away.
 */
const BOUND_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rests the cursor's centre on CURSOR_Y_MAX and takes it no further", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MIN);

  // Sampled every frame, so "goes no higher" is read across the whole drive.
  let highest = h.snapshot().cursor.y;
  h.hold(KEY);
  try {
    for (let frame = 0; frame < HOLD_TICKS; frame += 1) {
      await h.advance(1);
      highest = Math.max(highest, h.snapshot().cursor.y);
    }
  } finally {
    h.release(KEY);
  }
  captureStill(h, "clamped");

  const resting = h.snapshot().cursor.y;
  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_Y_MAX),
    BOUND_TOLERANCE,
    `the cursor's centre y after ${HOLD_TICKS} frames of held ${KEY} from ` +
      `CURSOR_Y_MIN (${CURSOR_Y_MIN}), against CURSOR_Y_MAX ` +
      `(${CURSOR_Y_MAX}) — specs/cursor.md and specs/board.md`,
  );
  assertLessThanOrEqual(
    highest,
    CURSOR_Y_MAX + BOUND_TOLERANCE,
    "the highest centre y the cursor reported at any frame of the hold, " +
      `against CURSOR_Y_MAX (${CURSOR_Y_MAX})`,
  );
});
