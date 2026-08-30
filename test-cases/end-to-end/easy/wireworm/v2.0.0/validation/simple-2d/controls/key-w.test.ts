// controls/key-w — holding `KeyW` lifts the cursor up the band.
//
// specs/controls.md binds the `up` action to `ArrowUp` and `KeyW`, gives that
// action one effect during play — "Moves the cursor up inside the band during
// play" — and has the four movement actions "read as holds: the cursor travels
// while a movement is held". specs/cursor.md fixes the band the travel happens
// in: the cursor's centre y is clamped between `CURSOR_Y_MIN` (`672`) and
// `CURSOR_Y_MAX` (`704`). So: pose live play with the cursor on the band's
// floor, hold the key, and read what the game did — its centre y fell, and its
// centre x did not move.
//
// `KeyW` is the SECOND of the two keys the `up` row binds. `ArrowUp` is
// controls/up-arrow's, and the two are separate points because a build that
// wired the arrows and forgot WASD must grade differently from one that wired
// neither — which is also why this point is capped `scuffed` where the arrow is
// `broken`: a player who lost only this half still has a way to move.
//
// THE CURSOR STARTS ON `CURSOR_Y_MAX`, NOT MID-BAND. The band is `32` units
// tall, so mid-band leaves only `16` units of headroom; posed on the floor there
// are `32`, which is the whole of the room the specification gives this
// direction.
//
// WHAT THIS DOES NOT DECIDE. How FAST the cursor travels, which is
// cursor/move-speed's, and where the band's top stops it, which is
// cursor/clamped-top's. The bound below is a quarter of the band over half a
// second, so the only thing that can fail here is the direction the key drives.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt and shuts the three world gates, so nothing arrives, enters or costs a
// life while the key is down: the cursor is the only thing on the board, and the
// only thing that can move it is the key this point is about.

import { afterEach, beforeEach, it } from "vitest";
import { CURSOR_SPEED, CURSOR_Y_MAX, CURSOR_Y_MIN } from "../../src/constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The second key specs/controls.md binds the `up` action to. */
const KEY = "KeyW";

/** The band's height, `CURSOR_Y_MAX - CURSOR_Y_MIN` (`32`), from specs/cursor.md. */
const BAND_H = CURSOR_Y_MAX - CURSOR_Y_MIN;

/**
 * How long the key is held, in ticks.
 *
 * Half a second — nearly seven times the `0.074` s a conforming build takes to
 * cross the whole `32`-unit band at `CURSOR_SPEED` (`430`). The window is
 * generous ON PURPOSE: a short window against a fixed distance would quietly
 * demand a rate of the build, and the rate is cursor/move-speed's point.
 */
const HOLD_TICKS = TICK_HZ / 2;

/**
 * The least upward travel that reads as "it went that way", in logical units.
 *
 * A quarter of the band (`8`). Over `HOLD_TICKS` that is a floor of `16` units a
 * second against the `430` specs/cursor.md fixes — a twenty-seventh of the rate,
 * so nothing but the DIRECTION is being asked for, and far above any rounding
 * drift. Where the travel stops is cursor/clamped-top's.
 */
const MOVED = BAND_H / 4;

/**
 * How far the untouched axis may drift, in logical units.
 *
 * Nothing in this scenario drives the horizontal axis — no key on it is held,
 * and specs/controls.md gives `up` no horizontal effect — so the only movement a
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

it("lifts the cursor up the band while KeyW is held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, CURSOR_Y_MAX);

  const before = h.snapshot();
  await holdFor(h, KEY, HOLD_TICKS);
  const moved = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture that
  // shows where the key put the cursor.
  captureStill(h, "moved");

  assertGreaterThanOrEqual(
    before.cursor.y - moved.cursor.y,
    MOVED,
    `logical units of UPWARD travel over ${HOLD_TICKS} ticks with ${KEY} ` +
      `held from CURSOR_Y_MAX (${CURSOR_Y_MAX}), at CURSOR_SPEED ` +
      `(${CURSOR_SPEED}) (specs/controls.md, specs/cursor.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(moved.cursor.x - before.cursor.x),
    STILL,
    "logical units the cursor's centre x moved under a purely vertical hold, " +
      "which specs/controls.md gives no horizontal effect",
  );
});
