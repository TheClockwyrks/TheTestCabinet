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

it("rests on CURSOR_Y_MAX with the down movement still held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MIN);

  holdAction(h, "down");
  let arrived: number;
  let resting: number;
  try {
    await h.advance(HOLD_TICKS);
    arrived = h.snapshot().cursor.y;
    await h.advance(SETTLE_TICKS);
    resting = h.snapshot().cursor.y;
  } finally {
    releaseAction(h, "down");
  }
  captureStill(h, "clamped");

  assertGreaterThanOrEqual(
    arrived,
    CURSOR_Y_MAX - CLAMP_TOLERANCE,
    "reached the bound within a second",
  );
  assertLessThanOrEqual(
    arrived,
    CURSOR_Y_MAX + CLAMP_TOLERANCE,
    "never left the band",
  );
  assertGreaterThanOrEqual(
    resting,
    CURSOR_Y_MAX - CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
  assertLessThanOrEqual(
    resting,
    CURSOR_Y_MAX + CLAMP_TOLERANCE,
    "still on the bound with the key held",
  );
});
