// Wireworm — controls/left-arrow: ArrowLeft drives the cursor's `left` movement.
//
// specs/controls.md binds the `left` action to `ArrowLeft` and `KeyA`, and states
// that the four movement actions "are read as holds: the cursor travels while a
// movement is held". specs/cursor.md states what travelling left is: the cursor
// "moves freely in logical units inside the player band", lowering its centre x.
//
// THIS POINT DECIDES DIRECTION, NOT RATE. How fast a held key moves the cursor is
// `cursor.move-speed`'s requirement, measured there over an exact one-second
// window, and how the travel stops at the band's edge is `cursor.clamped-left`'s.
// So the reading below is a floor of half a tile on the travel from where the cursor was
// posed rather than a distance: a build that moves the cursor left at any rate
// passes, and a build that moves it right, or not at all, fails — whatever its
// speed. Nothing about the length of the hold can therefore smuggle in a rate.
//
// THREE READINGS OF ONE SCENARIO, and the item's own description names all three:
// the centre x falls while the key is held, the centre y stays where it was, and
// the cursor stops once the key is released. Each names a different wrong build —
// one that drove the wrong axis, one that leaks its horizontal rate into y, and
// one that latches a key down and never reads the release specs/controls.md's
// "held" wording requires.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters, shuts
// the three world gates and parks the cursor at the band's centre `(640, 688)`,
// and this check puts nothing back. So the only thing on the board that can move
// is the cursor, and the only thing that can move it is the key under test.

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

/** The key this point is about, the first of the two `left` is bound to. */
const KEY = "ArrowLeft";

/**
 * How long the key is held, in frames of the harness's 100 Hz clock.
 *
 * NOT a tolerance and not a rate. The reading it feeds is a floor of half a tile,
 * a thirteenth of the rate specs/cursor.md fixes, so any hold a build can run its
 * own integration across decides the same verdict.
 * Half a second is chosen only so the clamp never enters the reading: at the
 * `CURSOR_SPEED` (430) specs/cursor.md fixes it carries the cursor 215 units,
 * which from the band's centre (640) stops far short of `CURSOR_X_MIN` (16).
 */
const HOLD_FRAMES = framesFor(0.5);

/** How long the check watches after the release, on the same reasoning. */
const SETTLE_FRAMES = framesFor(0.5);

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

/**
 * How far the cursor may still travel after the key is released, in logical
 * units, over a window as long as the hold itself.
 *
 * Zero is the honest figure for the same reason, and the same half unit is the
 * rounding room. A build that never reads the release travels the full 215 units
 * of a second half-second hold across this window, four hundred times this.
 */
const STOPPED_MAX = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the cursor left while ArrowLeft is held, and stops on the release", async () => {
  await startPlaying(h);
  await h.advance(1);
  const posed = (await h.snapshot()).cursor;

  await h.hold(KEY);
  await h.advance(HOLD_FRAMES);
  const held = (await h.snapshot()).cursor;
  await h.release(KEY);
  await h.advance(SETTLE_FRAMES);
  const settled = (await h.snapshot()).cursor;
  await captureStill(h, "moved");

  assertGreaterThanOrEqual(
    posed.x - held.x,
    MOVED,
    `logical units of LEFTWARD travel over ${HOLD_FRAMES} frames with ` +
      `${KEY} held from ${posed.x}`,
  );
  assertLessThanOrEqual(
    Math.abs(held.y - posed.y),
    OFF_AXIS_MAX,
    `how far the centre y moved over the hold, posed at ${posed.y}`,
  );
  assertLessThanOrEqual(
    Math.abs(settled.x - held.x),
    STOPPED_MAX,
    `how far the centre x travelled in the ${SETTLE_FRAMES} frames after the release`,
  );
});
