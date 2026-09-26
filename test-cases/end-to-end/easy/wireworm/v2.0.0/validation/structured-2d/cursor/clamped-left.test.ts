// cursor/clamped-left — the cursor driven left rests on the band's left bound.
//
// specs/cursor.md: the cursor's centre is clamped to the band's four bounds,
// `CURSOR_X_MIN` (16) among them, "so it never leaves the band. A movement held
// against a bound leaves the cursor resting exactly on that bound." The reading
// is therefore two-sided: the centre never goes below the bound, and with the
// key still held it sits exactly on it.
//
// WHY THE POSE IS 120 UNITS INSIDE THE BOUND. A clamp probe that starts far from
// the bound it tests quietly demands a speed of the build: the cursor has to
// cross the gap inside the window, so a build that clamps perfectly but moves
// slowly would fail a point about clamping. Posing the cursor 120 units inside
// the bound and holding for a whole second removes that: `CURSOR_SPEED` (430)
// covers the inset more than three times over, and even a build at a quarter of
// the rate arrives. The rate itself is `cursor.move-speed`'s requirement.
//
// The inset is the HORIZONTAL pair's alone. The band is only 32 units tall, so a
// 120-unit vertical inset falls outside the band, which `setCursor` fails loudly
// on; the vertical pair poses at the opposite bound instead.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_X_MIN } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
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

/**
 * How far inside the bound the cursor is posed, in logical units — the figure
 * the review item names, chosen so the probe measures the clamp and not the
 * rate.
 */
const INSET = 120;

/** The hold, in frames: one second, as the review item states. */
const HOLD_TICKS = TICK_HZ;

/**
 * Further frames the key stays down after the bound is reached, so the reading
 * is "resting on the bound with the movement still held" rather than "passing
 * it at the moment the window closed".
 */
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

it("rests on CURSOR_X_MIN with the left movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(CURSOR_X_MIN + INSET, BAND_CY);

  // Sampled every frame of the drive, so a cursor that passed the bound and
  // sprang back is read rather than missed between two samples.
  let lowest = h.snapshot().cursor.x;
  holdAction(h, "left");
  try {
    for (let frame = 0; frame < HOLD_TICKS + SETTLE_TICKS; frame += 1) {
      await h.advance(1);
      lowest = Math.min(lowest, h.snapshot().cursor.x);
    }
  } finally {
    releaseAction(h, "left");
  }
  const resting = h.snapshot().cursor.x;
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    Math.abs(resting - CURSOR_X_MIN),
    BOUND_TOLERANCE,
    `the cursor's centre x after ${HOLD_TICKS + SETTLE_TICKS} frames of ` +
      `held "left" movement, against CURSOR_X_MIN (${CURSOR_X_MIN}) — ` +
      `specs/cursor.md and specs/board.md`,
  );
  assertGreaterThanOrEqual(
    lowest,
    CURSOR_X_MIN - BOUND_TOLERANCE,
    "the lowest centre x the cursor reported at any frame of the hold, against " +
      `CURSOR_X_MIN (${CURSOR_X_MIN})`,
  );
});
