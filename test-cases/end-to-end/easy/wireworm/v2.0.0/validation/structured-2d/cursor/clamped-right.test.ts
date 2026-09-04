// cursor/clamped-right — the cursor driven right rests on the band's right
// bound.
//
// specs/cursor.md: the cursor's centre is clamped to the band's four bounds,
// `CURSOR_X_MAX` (1264) among them, "so it never leaves the band. A movement
// held against a bound leaves the cursor resting exactly on that bound." The
// reading is two-sided: the centre never goes above the bound, and with the key
// still held it sits exactly on it.
//
// The pose is 120 units inside the bound for the reason `cursor/clamped-left`
// states: a horizontal clamp probe that starts far from its bound demands a
// minimum speed of the build, and the rate is `cursor.move-speed`'s
// requirement, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_X_MAX } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CY,
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** How far inside the bound the cursor is posed, in logical units. */
const INSET = 120;

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

it("rests on CURSOR_X_MAX with the right movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(CURSOR_X_MAX - INSET, BAND_CY);

  // Sampled every frame of the drive, so a cursor that passed the bound and
  // sprang back is read rather than missed between two samples.
  let highest = h.snapshot().cursor.x;
  holdAction(h, "right");
  try {
    for (let frame = 0; frame < HOLD_TICKS + SETTLE_TICKS; frame += 1) {
      await h.advance(1);
      highest = Math.max(highest, h.snapshot().cursor.x);
    }
  } finally {
    releaseAction(h, "right");
  }
  const resting = h.snapshot().cursor.x;
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_X_MAX),
    BOUND_TOLERANCE,
    `the cursor's centre x after ${HOLD_TICKS + SETTLE_TICKS} frames of ` +
      `held "right" movement, against CURSOR_X_MAX (${CURSOR_X_MAX}) — ` +
      `specs/cursor.md and specs/board.md`,
  );
  assertLessThanOrEqual(
    highest,
    CURSOR_X_MAX + BOUND_TOLERANCE,
    "the highest centre x the cursor reported at any frame of the hold, against " +
      `CURSOR_X_MAX (${CURSOR_X_MAX})`,
  );
});
