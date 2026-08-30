// cursor/clamped-top — the cursor driven up rests on the band's top bound.
//
// specs/cursor.md: the cursor's centre is clamped to the band's four bounds,
// `CURSOR_Y_MIN` (672) among them, "so it never leaves the band. A movement held
// against a bound leaves the cursor resting exactly on that bound."
//
// WHY THIS PAIR POSES AT THE OPPOSITE BOUND RATHER THAN 120 UNITS INSIDE. The
// band is 32 units tall — `y` in [672, 704] (specs/board.md) — so it cannot hold
// the 120-unit inset the horizontal pair uses: `setCursor` applies the real
// clamp, and a pose 120 units inside a vertical bound would land silently on the
// other bound. The cursor is therefore posed at `CURSOR_Y_MAX`, the far side of
// the band, which is the widest vertical run the band has.
//
// The window is a whole second, thirteen times the 0.074 s a cursor at
// `CURSOR_SPEED` (430) takes to cross 32 units, so what is read is the clamp and
// not the rate.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_Y_MAX, CURSOR_Y_MIN } from "../../src/constants";
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

it("rests on CURSOR_Y_MIN with the up movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MAX);

  holdAction(h, "up");
  let arrived: number;
  let resting: number;
  try {
    await h.advance(HOLD_TICKS);
    arrived = h.snapshot().cursor.y;
    await h.advance(SETTLE_TICKS);
    resting = h.snapshot().cursor.y;
  } finally {
    releaseAction(h, "up");
  }
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    arrived,
    CURSOR_Y_MIN + CLAMP_TOLERANCE,
    "reached the bound within a second",
  );
  assertGreaterThanOrEqual(
    arrived,
    CURSOR_Y_MIN - CLAMP_TOLERANCE,
    "never left the band",
  );
  assertLessThanOrEqual(
    resting,
    CURSOR_Y_MIN + CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
  assertGreaterThanOrEqual(
    resting,
    CURSOR_Y_MIN - CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
});
