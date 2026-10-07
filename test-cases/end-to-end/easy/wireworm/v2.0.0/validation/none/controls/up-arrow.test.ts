// Wireworm — controls/up-arrow: ArrowUp drives the cursor's `up` movement, and
// drives it up the band.
//
// specs/controls.md binds the `up` action to `ArrowUp` and `KeyW` and gives it
// two jobs: it "moves the cursor up inside the band during play, and moves a menu
// highlight up". This point is the play half; the menu half is
// `controls.menu-up`. specs/cursor.md fixes the band the cursor is confined to,
// `y` in `[CURSOR_Y_MIN (672), CURSOR_Y_MAX (704)]`, and states that its centre
// "is clamped to the band's four bounds ... so it never leaves the band".
//
// POSED AT THE FAR BOUND, `CURSOR_Y_MAX` (704), so the whole 32 units of the band
// lie in front of the hold and any build with an upward movement at all has room
// to show it. The item's own description fixes that starting point.
//
// THIS POINT DECIDES DIRECTION, NOT RATE. specs/cursor.md fixes one
// `CURSOR_SPEED` for every direction, and `cursor.move-speed` measures it — over
// two HORIZONTAL probes, because the band is only 32 units tall and a build at the
// stated rate crosses it in 0.074 s, so a vertical probe measures the clamp rather
// than the rate. That is exactly why the vertical pair asserts direction: the
// reading below is a floor on the UPWARD travel, a quarter of the band, which any
// upward rate clears and no downward or absent one does.
//
// WHERE THE TRAVEL STOPS IS NOT READ HERE. That the cursor comes to rest exactly
// on `CURSOR_Y_MIN`, and never passes it, is `cursor.clamped-top`'s requirement,
// and asserting it here too would cost a build with one broken clamp two grades
// for one fault. This point reads the direction alone.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters and shuts
// the three world gates, and this check puts nothing back.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CX, CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the first of the two `up` is bound to. */
const KEY = "ArrowUp";

/**
 * How long the key is held, in frames of the harness's 100 Hz clock.
 *
 * NOT a tolerance and not a rate: the direction reading is a floor of a quarter
 * of the band, which any upward rate clears over this hold. Half a second is thirteen
 * hundredths of a second more than the 0.074 s a build at the `CURSOR_SPEED`
 * (430) specs/cursor.md fixes needs to cross the band's whole 32 units, so a
 * build far slower than the specification still shows its direction here.
 */
const HOLD_FRAMES = framesFor(0.5);

/** The band's height, `CURSOR_Y_MAX - CURSOR_Y_MIN` (`32`), from specs/cursor.md. */
const BAND_H = CURSOR_Y_MAX - CURSOR_Y_MIN;

/**
 * The least travel on this key's own axis that reads as "it went that way", in
 * logical units.
 *
 * A quarter of the band (`8`). Over `HOLD_FRAMES` that is a floor of `16` units
 * a second against the `CURSOR_SPEED` (`430`) specs/cursor.md fixes — a
 * twenty-seventh of the rate, so nothing but the DIRECTION is being asked for,
 * and far above any rounding drift. The `simple-2d` and `structured-2d` suites
 * hold the vertical pair to the same floor, so the one requirement is decided
 * against the same threshold on all three engines.
 */
const MOVED = BAND_H / 4;

/**
 * How far the axis this key does not drive may drift over the hold, in logical
 * units.
 *
 * specs/cursor.md moves the cursor on an axis only while a movement on that axis
 * is held, so the honest figure is zero and this is rounding room alone: half a
 * unit is under one pixel of the 1280x720 stage and a twenty-fourth of the
 * cursor's own `CURSOR_HALF` (12) box. A build leaking any part of `CURSOR_SPEED`
 * into x would move 215 units over this hold, four hundred times this.
 */
const OFF_AXIS_MAX = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lifts the cursor up the band while ArrowUp is held", async () => {
  await startPlaying(h);
  await h.debug.setCursor(BAND_CX, CURSOR_Y_MAX);
  await h.advance(1);
  const posed = (await h.snapshot()).cursor;

  await h.holdFor(KEY, HOLD_FRAMES);
  const held = (await h.snapshot()).cursor;
  await captureStill(h, "moved");

  assertGreaterThanOrEqual(
    posed.y - held.y,
    MOVED,
    `logical units of UPWARD travel over ${HOLD_FRAMES} frames with ` +
      `${KEY} held from CURSOR_Y_MAX (${CURSOR_Y_MAX}) `,
  );
  assertLessThanOrEqual(
    Math.abs(held.x - posed.x),
    OFF_AXIS_MAX,
    `how far the centre x moved over the hold, posed at ${posed.x}`,
  );
});
