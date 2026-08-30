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

/** How far inside the bound the cursor is posed, in logical units. */
const INSET = 120;

/** The hold, in frames: one second, as the review item states. */
const HOLD_TICKS = TICK_HZ;

/** Further held frames, so the reading is a rest rather than a passing. */
const SETTLE_TICKS = 24;

/**
 * How far off the bound the centre may rest, in logical units. specs/cursor.md
 * fixes the resting place exactly, so the only room is floating-point noise.
 */
const CLAMP_TOLERANCE = 1e-6;

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

  holdAction(h, "right");
  let arrived: number;
  let resting: number;
  try {
    await h.advance(HOLD_TICKS);
    arrived = h.snapshot().cursor.x;
    await h.advance(SETTLE_TICKS);
    resting = h.snapshot().cursor.x;
  } finally {
    releaseAction(h, "right");
  }
  captureStill(h, "clamped");

  assertGreaterThanOrEqual(
    arrived,
    CURSOR_X_MAX - CLAMP_TOLERANCE,
    "reached the bound within a second",
  );
  assertLessThanOrEqual(
    arrived,
    CURSOR_X_MAX + CLAMP_TOLERANCE,
    "never left the band",
  );
  assertGreaterThanOrEqual(
    resting,
    CURSOR_X_MAX - CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
  assertLessThanOrEqual(
    resting,
    CURSOR_X_MAX + CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
});
