// Wireworm — controls/key-s: KeyS drives the cursor's `down` movement.
//
// specs/controls.md binds the `down` action to two keys, `ArrowDown` and `KeyS`,
// so a build that answers only the arrow half has left the WASD player with no way
// to move. `ArrowDown` is `controls.down-arrow`'s point; this is the other key of
// the same binding, and it is a point of its own because a build can bind one and
// forget the other — a bindings table that omits a row grades differently here
// than there.
//
// POSED AT THE FAR BOUND, `CURSOR_Y_MIN` (672), so the whole 32 units of the band
// specs/cursor.md confines the cursor to lie in front of the hold. The item's own
// description fixes that starting point.
//
// THIS POINT DECIDES DIRECTION, NOT RATE. specs/cursor.md fixes one
// `CURSOR_SPEED` for every direction and `cursor.move-speed` measures it, over two
// HORIZONTAL probes, because the band is only 32 units tall and a build at the
// stated rate crosses it in 0.074 s. The reading below is a strict inequality
// against the posed y, which any downward rate satisfies and no upward or absent
// one does.
//
// THE BAND IS A FLOOR HERE, NOT A RESTING PLACE. Where exactly the cursor comes to
// rest is `cursor.clamped-bottom`'s reading; what this point requires is that the
// movement stays inside the band the cursor is confined to.
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

/** The key this point is about, the second of the two `down` is bound to. */
const KEY = "KeyS";

/**
 * How long the key is held, in frames of the harness's 100 Hz clock.
 *
 * NOT a tolerance and not a rate: the direction reading is a strict inequality,
 * which any downward rate satisfies over any hold. Half a second is thirteen
 * hundredths of a second more than the 0.074 s a build at the `CURSOR_SPEED`
 * (430) specs/cursor.md fixes needs to cross the band's whole 32 units.
 */
const HOLD_FRAMES = framesFor(0.5);

/**
 * How far the axis this key does not drive may drift over the hold, in logical
 * units.
 *
 * specs/cursor.md moves the cursor on an axis only while a movement on that axis
 * is held, so the honest figure is zero and this is rounding room alone: half a
 * unit is under one pixel of the 1280x720 stage and a twenty-fourth of the
 * cursor's own `CURSOR_HALF` (12) box.
 */
const OFF_AXIS_MAX = 0.5;

/**
 * How far past `CURSOR_Y_MAX` the cursor may sit and still count as inside the
 * band, in logical units.
 *
 * The clamp specs/cursor.md states is exact, so the honest figure is zero and the
 * same half unit is rounding room for a build that computes its bound rather than
 * writing it down.
 */
const BAND_FLOOR_SLACK = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the cursor down inside the band while KeyS is held", async () => {
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
    `the cursor's centre y after ${HOLD_FRAMES} frames of KeyS, posed at CURSOR_Y_MIN (${CURSOR_Y_MIN})`,
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
