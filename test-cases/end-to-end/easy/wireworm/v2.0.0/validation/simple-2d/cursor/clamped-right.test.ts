// cursor/clamped-right — the cursor's centre stops at the band's right bound.
//
// specs/cursor.md: "Its center is clamped to the band's four bounds ...
// `CURSOR_X_MAX` (`1264`) ... A movement held against a bound leaves the cursor
// resting exactly on that bound."
//
// THE POSE IS 120 UNITS INSIDE THE BOUND, for the reason `cursor.clamped-left`
// states: a probe that started from mid-band would have to cross 624 units to
// reach the bound, so it would fail any build whose movement rate was wrong
// while claiming to have measured the clamp. `cursor.move-speed` grades the rate,
// and this point grades where the cursor stops.
//
// WHAT THIS DOES NOT DECIDE. That `ArrowRight` is the key that moves right is
// `controls.right-arrow`'s requirement. This point reads one number: where the
// cursor's centre x came to rest.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_SPEED, CURSOR_X_MAX } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CY,
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key bound to `right` (specs/controls.md). */
const KEY = "ArrowRight";

/** How far inside the bound the cursor is posed, straight off the review item. */
const INSET = 120;

/**
 * The hold, in frames of the harness's 120 Hz clock: exactly one second.
 *
 * At `CURSOR_SPEED` that is 430 units of travel against a 120-unit inset, so the
 * cursor rests on the bound for the greater part of the drive.
 */
const HOLD_TICKS = ticksFor(1);

/**
 * How far off the bound the resting centre may be, in logical units.
 *
 * specs/cursor.md states the rest as exact, so this allows floating-point
 * residue and nothing else. Half a unit is below one screen pixel, and the
 * nearest other bound this case states is 656 units away.
 */
const BOUND_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rests the cursor's centre on CURSOR_X_MAX and takes it no further", async () => {
  startPlaying(h);
  h.debug.setCursor(CURSOR_X_MAX - INSET, BAND_CY);

  // Sampled every frame, so "goes no higher" is read across the whole drive.
  let highest = h.snapshot().cursor.x;
  h.hold(KEY);
  try {
    for (let frame = 0; frame < HOLD_TICKS; frame += 1) {
      await h.advance(1);
      highest = Math.max(highest, h.snapshot().cursor.x);
    }
  } finally {
    h.release(KEY);
  }
  captureStill(h, "clamped");

  const resting = h.snapshot().cursor.x;
  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_X_MAX),
    BOUND_TOLERANCE,
    `the cursor's centre x after ${HOLD_TICKS} frames of held ${KEY} from ` +
      `${CURSOR_X_MAX - INSET}, against CURSOR_X_MAX (${CURSOR_X_MAX}) — ` +
      `specs/cursor.md, and ${CURSOR_SPEED} units/s covers the ${INSET}-unit ` +
      "inset in 0.28 s",
  );
  assertLessThanOrEqual(
    highest,
    CURSOR_X_MAX + BOUND_TOLERANCE,
    "the highest centre x the cursor reported at any frame of the hold, " +
      `against CURSOR_X_MAX (${CURSOR_X_MAX})`,
  );
});
