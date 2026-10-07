// controls/left-arrow — holding `ArrowLeft` slides the cursor left.
//
// specs/controls.md binds the `left` action to `ArrowLeft` and `KeyA`, gives
// that action one effect — "Moves the cursor left during play" — and has the
// four movement actions "read as holds: the cursor travels while a movement is
// held". specs/cursor.md says the same from the cursor's side: "While a movement
// is held the cursor travels at `CURSOR_SPEED` ... The rate is the same in every
// direction." So: pose live play with the cursor mid-band, hold the key, and
// read what the game did — its centre x fell, its centre y did not move, and the
// cursor came to rest once the key came up.
//
// `ArrowLeft` is the FIRST of the two keys the `left` row binds. `KeyA` is
// controls/key-a's, and the two are separate points because a build that wired
// one and not the other must grade differently from one that wired neither.
//
// WHAT THIS DOES NOT DECIDE. How FAST the cursor travels, which is
// cursor/move-speed's, measured there over an exact one-second window; and where
// the band's left bound stops it, which is cursor/clamped-left's. The bound
// below is deliberately loose and the hold deliberately short of the bound, so
// the only thing that can fail here is the direction the key drives.
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

/** The first key specs/controls.md binds the `left` action to. */
const KEY = "ArrowLeft";

/**
 * How long the key is held, in ticks.
 *
 * A quarter of a second. At `CURSOR_SPEED` (`430`, specs/cursor.md) that is
 * `107.5` units of travel, and the cursor starts `624` units from
 * `CURSOR_X_MIN` (`16`), so a conforming build is nowhere near the bound when
 * the hold ends and this point never reads the clamp.
 */
const HOLD_TICKS = TICK_HZ / 4;

/**
 * The least leftward travel that reads as "it went that way", in logical units.
 *
 * Half a tile (`16`). Over `HOLD_TICKS` that is a floor of `64` units a second,
 * a seventh of the `CURSOR_SPEED` (`430`) specs/cursor.md fixes — far above any
 * rounding drift and far below the rate, because how FAST the cursor travels is
 * cursor/move-speed's point and asserting it here would cost one build two
 * points for one fault.
 */
const MOVED = TILE / 2;

/**
 * How far the untouched axis may drift, in logical units.
 *
 * Nothing in this scenario drives the vertical axis — no key on it is held, and
 * specs/controls.md gives `left` no vertical effect — so the only movement a
 * conforming build can show there is arithmetic noise. Half a unit is orders of
 * magnitude above that and far under the half-tile that would read as travel.
 */
const STILL = 0.5;

/**
 * Ticks between the two readings taken after the key comes up.
 *
 * A quarter of a second each. A cursor that kept travelling because the release
 * went unread covers `107.5` units in one of these windows — hundreds of times
 * `STILL` — and is still `317` units clear of `CURSOR_X_MIN`, so a runaway
 * cannot hide by resting on the bound.
 */
const SETTLE_TICKS = TICK_HZ / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("slides the cursor left while ArrowLeft is held", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);

  const before = h.snapshot();
  await holdFor(h, KEY, HOLD_TICKS);
  const moved = h.snapshot();
  await h.advance(SETTLE_TICKS);
  const rest = h.snapshot();
  await h.advance(SETTLE_TICKS);
  const still = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture that
  // shows where the key put the cursor.
  captureStill(h, "moved");

  assertGreaterThanOrEqual(
    before.cursor.x - moved.cursor.x,
    MOVED,
    `logical units of LEFTWARD travel over ${HOLD_TICKS} ticks with ` +
      `${KEY} held, at CURSOR_SPEED (${CURSOR_SPEED}) (specs/controls.md, ` +
      `specs/cursor.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(moved.cursor.y - before.cursor.y),
    STILL,
    "logical units the cursor's centre y moved under a purely horizontal " +
      "hold, which specs/controls.md gives no vertical effect",
  );
  assertLessThanOrEqual(
    Math.abs(still.cursor.x - rest.cursor.x),
    STILL,
    `logical units the cursor travelled over ${SETTLE_TICKS} ticks after ` +
      `${KEY} came up: the cursor travels WHILE a movement is held ` +
      `(specs/controls.md), so it rests once the key does`,
  );
});
