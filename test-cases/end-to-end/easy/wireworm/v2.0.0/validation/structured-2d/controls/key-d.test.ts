// controls/key-d — holding `KeyD` slides the cursor right.
//
// specs/controls.md binds the `right` action to `ArrowRight` and `KeyD`, gives
// that action one effect — "Moves the cursor right during play" — and has the
// four movement actions "read as holds: the cursor travels while a movement is
// held". So: pose live play with the cursor mid-band, hold the key, and read
// what the game did — its centre x rose, and its centre y did not move.
//
// `KeyD` is the SECOND of the two keys the `right` row binds. `ArrowRight` is
// controls/right-arrow's, and the two are separate points because a build that
// wired the arrows and forgot WASD must grade differently from one that wired
// neither — which is also why this point is capped `scuffed` where the arrow is
// `broken`: a player who lost only this half still has a way to move.
//
// WHAT THIS DOES NOT DECIDE. How FAST the cursor travels, which is
// cursor/move-speed's; where the band's right bound stops it, which is
// cursor/clamped-right's; and that the cursor STOPS when the key comes up, which
// is the `right` action's own behaviour and is read once, in
// controls/right-arrow. Both keys resolve to that one action, so re-reading it
// here would cost one build two points for one fault.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt and shuts the three world gates, so nothing arrives, enters or costs a
// life while the key is down: the cursor is the only thing on the board, and the
// only thing that can move it is the key this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_SPEED, TILE } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The second key specs/controls.md binds the `right` action to. */
const KEY = "KeyD";

/**
 * How long the key is held, in ticks.
 *
 * A quarter of a second. At `CURSOR_SPEED` (`430`, specs/cursor.md) that is
 * `107.5` units of travel, and the cursor starts `624` units from
 * `CURSOR_X_MAX` (`1264`), so a conforming build is nowhere near the bound when
 * the hold ends and this point never reads the clamp.
 */
const HOLD_TICKS = TICK_HZ / 4;

/**
 * The least rightward travel that reads as "it went that way", in logical units.
 *
 * Half a tile (`16`). Over `HOLD_TICKS` that is a floor of `64` units a second,
 * a seventh of the `CURSOR_SPEED` (`430`) specs/cursor.md fixes — far above any
 * rounding drift and far below the rate, because how FAST the cursor travels is
 * cursor/move-speed's point.
 */
const MOVED = TILE / 2;

/**
 * How far the untouched axis may drift, in logical units.
 *
 * Nothing in this scenario drives the vertical axis — no key on it is held, and
 * specs/controls.md gives `right` no vertical effect — so the only movement a
 * conforming build can show there is arithmetic noise. Half a unit is orders of
 * magnitude above that and far under the half-tile that would read as travel.
 */
const STILL = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("slides the cursor right while KeyD is held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);

  const before = h.snapshot();
  await holdFor(h, KEY, HOLD_TICKS);
  const moved = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture that
  // shows where the key put the cursor.
  captureStill(h, "moved");

  assertGreaterThanOrEqual(
    moved.cursor.x - before.cursor.x,
    MOVED,
    `logical units of RIGHTWARD travel over ${HOLD_TICKS} ticks with ` +
      `${KEY} held, at CURSOR_SPEED (${CURSOR_SPEED}) (specs/controls.md, ` +
      `specs/cursor.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(moved.cursor.y - before.cursor.y),
    STILL,
    "logical units the cursor's centre y moved under a purely horizontal " +
      "hold, which specs/controls.md gives no vertical effect",
  );
});
