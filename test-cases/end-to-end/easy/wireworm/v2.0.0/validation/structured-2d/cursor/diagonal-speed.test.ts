// cursor/diagonal-speed — a diagonal hold carries the cursor no faster than a
// straight one.
//
// specs/cursor.md: "Two perpendicular movements held together move the cursor
// along the diagonal at that same `CURSOR_SPEED`, so each axis contributes
// `CURSOR_SPEED / sqrt(2)` (about `304`) units per second rather than the full
// `430`." That per-axis figure is what this reads.
//
// WHY THE HORIZONTAL COMPONENT IS THE ONE MEASURED. The player band is 32 units
// tall (specs/board.md), so the vertical component of a one-second diagonal
// clamps out after 32 units and a total-path figure is unreachable inside the
// band. The horizontal component is not clamped anywhere near: the hold runs
// from the band's centre and 640 + 304 is 944, well inside `CURSOR_X_MAX`
// (1264) — and so is the 430 an unnormalized diagonal would give, so the two
// models are told apart by the number rather than by a bound.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CURSOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  holdBothFor,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The window both keys are held for, in frames: exactly one second. */
const HOLD_TICKS = TICK_HZ;

/**
 * What one second of a normalized diagonal contributes on one axis, in logical
 * units: `CURSOR_SPEED / sqrt(2)`, about 304. An unnormalized diagonal would
 * contribute the full `CURSOR_SPEED` (430) instead.
 */
const AXIS_TRAVEL = CURSOR_SPEED / Math.SQRT2;

/**
 * How far the measured horizontal travel may sit from that figure, in logical
 * units: the 5% the review item states. It is a quarter of the gap between the
 * normalized figure and the 430 an unnormalized diagonal gives, so the two
 * cannot be confused.
 */
const AXIS_TOLERANCE = AXIS_TRAVEL * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves CURSOR_SPEED / sqrt(2) horizontally over a diagonal second", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);
  const from = h.snapshot().cursor.x;

  await holdBothFor(h, BINDINGS.right[0], BINDINGS.up[0], HOLD_TICKS);
  // The MAGNITUDE of the horizontal travel: which way the pair of keys sent the
  // cursor is `controls.right-arrow`'s and `controls.up-arrow`'s requirement, and
  // reading the sign here would dock one defect twice. The `none` and `simple-2d`
  // suites take the same magnitude.
  const travelled = Math.abs(h.snapshot().cursor.x - from);
  captureStill(h, "diagonal");

  assertLessThanOrEqual(
    Math.abs(travelled - AXIS_TRAVEL),
    AXIS_TOLERANCE,
    `right and up together for a second travelled ${travelled} horizontally`,
  );
});
