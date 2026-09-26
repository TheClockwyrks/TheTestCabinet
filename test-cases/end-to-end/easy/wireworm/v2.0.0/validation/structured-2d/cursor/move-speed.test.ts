// cursor/move-speed — a held movement key slides the cursor at CURSOR_SPEED.
//
// specs/cursor.md: "While a movement is held the cursor travels at
// `CURSOR_SPEED` (430) units per second, integrated against the delta time of
// each update. The rate is the same in every direction." So a key held for
// exactly one second moves the cursor exactly `CURSOR_SPEED` units, and the
// displacement over a known window is the direct reading of the rate.
//
// TWO HORIZONTAL PROBES, AND NO VERTICAL ONE. The player band is 32 units tall —
// `y` in [672, 704] (specs/board.md) — which a cursor at `CURSOR_SPEED` crosses
// in 0.074 s, so a vertical hold over any window worth measuring reports the
// clamp rather than the rate. Horizontally the band is the full width of the
// board, and both probes run from its centre: 640 ± 430 is 1070 and 210, well
// inside [`CURSOR_X_MIN`, `CURSOR_X_MAX`] (16, 1264), so neither probe ever
// touches a bound. That the cursor moves vertically at all is
// `controls.up-arrow` and `controls.down-arrow`'s requirement.
//
// THE READING IS A MAGNITUDE, NOT A SIGNED DISPLACEMENT. Which WAY a key sends
// the cursor is `controls.left-arrow`'s and `controls.right-arrow`'s
// requirement; a build that moved the wrong way at exactly the right rate is
// docked there and passes here, which is what keeps one defect from costing two
// grades. The `none` and `simple-2d` suites take the same magnitude.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureReplay,
  createHarness,
  holdActionFor,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The window each probe is held for, in frames: exactly one second. */
const HOLD_TICKS = TICK_HZ;

/**
 * How far the measured displacement may sit from `CURSOR_SPEED`, in logical
 * units: the 5% the review item states, over a window of exactly one second,
 * where the distance travelled and the rate are the same number.
 */
const SPEED_TOLERANCE = CURSOR_SPEED * 0.05;

/** Frames at rest between the two probes, so the replay reads as two holds. */
const SETTLE_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("travels CURSOR_SPEED units in a second, left and right", async () => {
  startPlaying(h);

  const probes = await captureReplay(h, "probe", async () => {
    h.debug.setCursor(BAND_CX, BAND_CY);
    const rightFrom = h.snapshot().cursor.x;
    await holdActionFor(h, "right", HOLD_TICKS);
    const rightTo = h.snapshot().cursor.x;

    await h.advance(SETTLE_TICKS);

    h.debug.setCursor(BAND_CX, BAND_CY);
    const leftFrom = h.snapshot().cursor.x;
    await holdActionFor(h, "left", HOLD_TICKS);
    const leftTo = h.snapshot().cursor.x;

    return { right: rightTo - rightFrom, left: leftTo - leftFrom };
  });

  assertLessThanOrEqual(
    Math.abs(Math.abs(probes.right) - CURSOR_SPEED),
    SPEED_TOLERANCE,
    `right for a second travelled ${probes.right}`,
  );
  assertLessThanOrEqual(
    Math.abs(Math.abs(probes.left) - CURSOR_SPEED),
    SPEED_TOLERANCE,
    `left for a second travelled ${probes.left}`,
  );
});
