// Wireworm — controls/key-d: KeyD drives the cursor's `right` movement.
//
// specs/controls.md binds the `right` action to two keys, `ArrowRight` and
// `KeyD`, so a build that answers only the arrow half has left the WASD player
// with no way to move. `ArrowRight` is `controls.right-arrow`'s point; this is the
// other key of the same binding, and it is a point of its own because a build can
// bind one and forget the other — a bindings table that omits a row grades
// differently here than there.
//
// THIS POINT DECIDES DIRECTION, NOT RATE. specs/cursor.md fixes one
// `CURSOR_SPEED` for every direction, and `cursor.move-speed` measures it. The
// reading here is a floor of half a tile on the travel from where the cursor was posed, so a
// build that moves the cursor right at any rate passes and one that moves it
// left, or not at all, fails — whatever its speed. Nothing about the length of the
// hold can smuggle a rate in.
//
// THE RELEASE IS NOT READ HERE. That the cursor stops when a movement key is let
// go is `controls.right-arrow`'s reading, taken once for the `right` action; what
// this point adds is that the second key reaches that action at all.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters, shuts
// the three world gates and parks the cursor at the band's centre `(640, 688)`,
// and this check puts nothing back.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the second of the two `right` is bound to. */
const KEY = "KeyD";

/**
 * How long the key is held, in frames of the harness's 100 Hz clock.
 *
 * NOT a tolerance and not a rate. The reading it feeds is a floor of half a tile,
 * a thirteenth of the rate specs/cursor.md fixes, so any hold a build can run its
 * own integration across decides the same verdict.
 * Half a second is chosen only so the clamp never enters the reading: at the
 * `CURSOR_SPEED` (430) specs/cursor.md fixes it carries the cursor 215 units,
 * which from the band's centre (640) stops far short of `CURSOR_X_MAX` (1264).
 */
const HOLD_FRAMES = framesFor(0.5);

/**
 * The least travel on this key's own axis that reads as "it went that way", in
 * logical units.
 *
 * Half a tile (`16`). Over `HOLD_FRAMES` that is a floor of `32` units a second,
 * a thirteenth of the `CURSOR_SPEED` (`430`) specs/cursor.md fixes — far above
 * any rounding drift and far below the rate, because how FAST the cursor travels
 * is `cursor.move-speed`'s point and asserting it here would cost one build two
 * points for one fault. The `simple-2d` and `structured-2d` suites hold the
 * horizontal pair to the same floor.
 */
const MOVED = TILE / 2;

/**
 * How far the axis this key does not drive may drift over the hold, in logical
 * units.
 *
 * specs/cursor.md moves the cursor on an axis only while a movement on that axis
 * is held, so the honest figure is zero and this is rounding room alone: half a
 * unit is a sixty-fourth of the band's 32-unit height and a twenty-fourth of the
 * cursor's own `CURSOR_HALF` (12) box, under one pixel of the 1280x720 stage. A
 * build leaking any part of `CURSOR_SPEED` into y would move 215 units here.
 */
const OFF_AXIS_MAX = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the cursor right while KeyD is held", async () => {
  await startPlaying(h);
  await h.advance(1);
  const posed = (await h.snapshot()).cursor;

  await h.holdFor(KEY, HOLD_FRAMES);
  const held = (await h.snapshot()).cursor;
  await captureStill(h, "moved");

  assertGreaterThanOrEqual(
    held.x - posed.x,
    MOVED,
    `logical units of RIGHTWARD travel over ${HOLD_FRAMES} frames with ` +
      `${KEY} held from ${posed.x}`,
  );
  assertLessThanOrEqual(
    Math.abs(held.y - posed.y),
    OFF_AXIS_MAX,
    `how far the centre y moved over the hold, posed at ${posed.y}`,
  );
});
