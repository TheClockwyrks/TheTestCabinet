// Wireworm — controls/down-arrow: ArrowDown drives the cursor's `down` movement,
// and drives it inside the band.
//
// specs/controls.md binds the `down` action to `ArrowDown` and `KeyS` and gives it
// two jobs: it "moves the cursor down inside the band during play, and moves a
// menu highlight down". This point is the play half; the menu half is
// `controls.menu-down`. specs/cursor.md fixes the band the cursor is confined to,
// `y` in `[CURSOR_Y_MIN (672), CURSOR_Y_MAX (704)]`, and states that its centre
// "is clamped to the band's four bounds ... so it never leaves the band".
//
// POSED AT THE FAR BOUND, `CURSOR_Y_MIN` (672), so the whole 32 units of the band
// lie in front of the hold and any build with a downward movement at all has room
// to show it. The item's own description fixes that starting point.
//
// THIS POINT DECIDES DIRECTION, NOT RATE, and is the mirror of
// `controls.up-arrow`: a build that drove both vertical keys the same way is right
// about one and wrong about the other, and the two points then grade differently.
// specs/cursor.md's one `CURSOR_SPEED` is `cursor.move-speed`'s requirement, and
// it is measured there over two HORIZONTAL probes, because the band is only 32
// units tall and a build at the stated rate crosses it in 0.074 s. The reading
// below is therefore a strict inequality against the posed y, which any downward
// rate satisfies and no upward or absent one does.
//
// THE BAND IS A FLOOR HERE, NOT A RESTING PLACE. That the cursor comes to rest
// EXACTLY on `CURSOR_Y_MAX` is `cursor.clamped-bottom`'s reading. What this point
// requires is the weaker thing its own title says — that the movement stays inside
// the band the cursor is confined to.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters and shuts
// the three world gates, and this check puts nothing back.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_CX, CURSOR_Y_MAX, CURSOR_Y_MIN } from "../constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the first of the two `down` is bound to. */
const KEY = "ArrowDown";

/**
 * How long the key is held, in frames of the harness's 100 Hz clock.
 *
 * NOT a tolerance and not a rate: the direction reading is a strict inequality,
 * which any downward rate satisfies over any hold. Half a second is thirteen
 * hundredths of a second more than the 0.074 s a build at the `CURSOR_SPEED`
 * (430) specs/cursor.md fixes needs to cross the band's whole 32 units, so a
 * build far slower than the specification still shows its direction here.
 */
const HOLD_FRAMES = framesFor(0.5);

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

/**
 * How far past `CURSOR_Y_MAX` the cursor may sit and still count as inside the
 * band, in logical units.
 *
 * The clamp specs/cursor.md states is exact, so the honest figure is zero again
 * and the same half unit is rounding room for a build that computes its bound
 * rather than writing it down. A build that ignores the band entirely leaves it
 * by hundreds of units on a half-second hold.
 */
const BAND_FLOOR_SLACK = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the cursor down inside the band while ArrowDown is held", async () => {
  await startPlaying(h);
  await h.debug.setCursor(BAND_CX, CURSOR_Y_MIN);
  await h.advance(1);
  const posed = (await h.snapshot()).cursor;

  await h.holdFor(KEY, HOLD_FRAMES);
  const held = (await h.snapshot()).cursor;
  await captureStill(h, "moved");

  assertGreaterThan(
    held.y,
    posed.y,
    `the cursor's centre y after ${HOLD_FRAMES} frames of ArrowDown, posed at CURSOR_Y_MIN (${CURSOR_Y_MIN})`,
  );
  assertLessThanOrEqual(
    held.y,
    CURSOR_Y_MAX + BAND_FLOOR_SLACK,
    `the cursor's centre y, which never leaves the band's bottom bound CURSOR_Y_MAX (${CURSOR_Y_MAX})`,
  );
  assertLessThanOrEqual(
    Math.abs(held.x - posed.x),
    OFF_AXIS_MAX,
    `how far the centre x moved over the hold, posed at ${posed.x}`,
  );
});
