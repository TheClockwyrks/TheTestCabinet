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
// The inset is the HORIZONTAL pair's alone. The band is only 32 units tall, so
// `setCursor` would clamp a 120-unit vertical inset straight onto the opposite
// bound; the vertical pair poses at the opposite bound instead.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_X_MIN } from "../../src/constants";
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
 * How far off the bound the centre may rest, in logical units.
 *
 * specs/cursor.md fixes the resting place exactly — "resting exactly on that
 * bound" — so the only room here is the floating-point noise a clamp of the
 * form `max(CURSOR_X_MIN, x)` cannot produce and an equivalent arithmetic
 * might.
 */
const CLAMP_TOLERANCE = 1e-6;

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

  holdAction(h, "left");
  let arrived: number;
  let resting: number;
  try {
    await h.advance(HOLD_TICKS);
    arrived = h.snapshot().cursor.x;
    await h.advance(SETTLE_TICKS);
    resting = h.snapshot().cursor.x;
  } finally {
    releaseAction(h, "left");
  }
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    arrived,
    CURSOR_X_MIN + CLAMP_TOLERANCE,
    "reached the bound within a second",
  );
  assertGreaterThanOrEqual(
    arrived,
    CURSOR_X_MIN - CLAMP_TOLERANCE,
    "never left the band",
  );
  assertLessThanOrEqual(
    resting,
    CURSOR_X_MIN + CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
  assertGreaterThanOrEqual(
    resting,
    CURSOR_X_MIN - CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
});
