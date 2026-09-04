// cursor/diagonal-speed — two movements held together are no faster than one.
//
// `specs/cursor.md`: "Two perpendicular movements held together move the cursor
// along the diagonal at that same `CURSOR_SPEED`, so each axis contributes
// `CURSOR_SPEED / sqrt(2)` (about `304`) units per second rather than the full
// `430`."
//
// THE HORIZONTAL COMPONENT IS THE READABLE ONE. `specs/board.md` gives the band
// 32 units of vertical travel, so the vertical component of a one-second
// diagonal clamps out after 0.105 s and a total-path figure is unreachable
// inside the band. The horizontal component is under no such bound, and it is
// exactly what separates the two models: a build that normalized the diagonal
// covers 304 units, and a build that gave each axis the full rate covers 430.
// Those are 126 units apart, eight times the margin below.
//
// THE VERTICAL CLAMP CANNOT REACH THE READING. Each axis of the diagonal is
// resolved from the held direction, so clamping the y component against
// `CURSOR_Y_MIN` leaves the x component exactly what it was — and a build that
// instead shortened its whole step when one axis hit a bound would come in under
// 304 and be caught, which is the correct verdict: it is no longer moving at
// `CURSOR_SPEED` along the diagonal.
//
// THE START IS MID-BAND AND THE END IS 320 UNITS CLEAR OF `CURSOR_X_MAX`, so the
// horizontal clamp `cursor.clamped-right` grades never enters this reading. The
// board is empty, as `startPlaying` leaves it.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CX, BAND_CY, CURSOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  seconds,
  startPlaying,
  type Harness,
} from "../harness";

/** The keys bound to `right` and `up` (`specs/controls.md`). */
const KEYS = ["ArrowRight", "ArrowUp"] as const;

/** The hold, in frames of the harness's 100 Hz clock: exactly one second. */
const HOLD_FRAMES = framesFor(1);

/**
 * How far the cursor's centre x travels under a diagonal hold, in logical units.
 *
 * `CURSOR_SPEED / sqrt(2)` — the per-axis contribution `specs/cursor.md` states
 * — integrated over the window's own duration. About 304 units.
 */
const EXPECTED_TRAVEL = (CURSOR_SPEED / Math.SQRT2) * seconds(HOLD_FRAMES);

/**
 * The review item's margin: five percent of the expected travel, about 15 units.
 *
 * The wrong model this point exists to catch — each axis given the full
 * `CURSOR_SPEED` — reads 430, which is 126 units out and eight margins away.
 */
const TRAVEL_TOLERANCE = EXPECTED_TRAVEL * 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the cursor CURSOR_SPEED / sqrt(2) horizontally under a diagonal hold", async () => {
  await startPlaying(h);
  await h.debug.setCursor(BAND_CX, BAND_CY);

  const before = (await h.snapshot()).cursor.x;
  await h.holdFor(KEYS, HOLD_FRAMES);
  await captureStill(h, "diagonal");

  const travelled = Math.abs((await h.snapshot()).cursor.x - before);
  assertLessThanOrEqual(
    Math.abs(travelled - EXPECTED_TRAVEL),
    TRAVEL_TOLERANCE,
    `the distance the cursor's centre x covered over ${HOLD_FRAMES} frames ` +
      `(${seconds(HOLD_FRAMES)} s) of ${KEYS.join(" and ")} held together, ` +
      `against CURSOR_SPEED / sqrt(2) (${EXPECTED_TRAVEL.toFixed(2)}) — ` +
      `specs/cursor.md; an unnormalized diagonal would read ${CURSOR_SPEED}`,
  );
});
