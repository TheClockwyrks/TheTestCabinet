// controls/space-fires — `Space` puts a bolt in the air.
//
// specs/controls.md binds both fire actions, `a` and `b`, to `Space` and gives
// each one effect — "Fires a bolt" — and has the two fire actions "read as
// holds: ... a held fire action produces a bolt every `FIRE_INTERVAL` while the
// cooldown and the cap allow one". specs/cursor.md fixes where that bolt appears:
// "A bolt is created with its center in the cursor's column, at the cursor's
// center `x`". So: pose live play with the cursor's cooldown at rest and no bolt
// in flight, hold the key for a moment, and read the roster.
//
// THE CURSOR IS POSED OFF-CENTRE, on the centre of column 10 (`x = 336`) rather
// than in the middle of the band, precisely so "in the cursor's column" is a
// reading rather than a coincidence: a build that spawns its bolts down the
// middle of the stage, or over the board's centre, reads `640` here and fails,
// where posed mid-band it would have passed.
//
// THE KEY IS HELD, NOT TAPPED. The fire actions are read as HOLDS
// (specs/controls.md), so a build that reads the action's value rather than its
// press edge is conforming and must not be failed by the way this point presses
// the key. It is held for `HOLD_TICKS`, a third of `FIRE_INTERVAL`, so exactly
// one bolt is due however the build reads it: the press edge lands inside the
// window and the held value is up for the whole of it, and the cooldown the
// first shot sets has not run out by the end.
//
// WHAT THIS DOES NOT DECIDE. How OFTEN a held key fires, which is
// cursor/fire-interval's; how many bolts may be in flight, which is
// cursor/bolt-cap's; where the bolt sits ABOVE the cursor, which is
// cursor/bolt-spawns-at-cursor's; and how it then travels, which is
// cursor/bolt-travels-up's. This point asks only that the key produces the shot,
// in the column the cursor is standing in.
//
// THE WORLD IS EMPTY AND QUIET. `startPlaying` clears every node, worm, foe and
// bolt, shuts the three world gates and rests the fire cooldown at `0`, so
// nothing else can add or remove a bolt while the key is down and nothing above
// the cursor can resolve the one it fires.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL, tileCX } from "../../src/constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  BAND_CY,
  captureStill,
  createHarness,
  holdFor,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/controls.md binds both fire actions, `a` and `b`, to. */
const KEY = "Space";

/** The column the cursor is posed in, away from the middle of the stage. */
const COLUMN = 10;

/**
 * How long the key is held, in ticks.
 *
 * Six ticks, `0.05` s: a third of `FIRE_INTERVAL` (`0.15` s, specs/cursor.md).
 * Long enough that a build reading the held value has had five frames in which
 * to fire, and short enough that the cooldown the first shot sets is still
 * running when the window closes, so the roster holds exactly the one bolt this
 * press is worth however the build reads the key.
 */
const HOLD_TICKS = 6;

/**
 * How far the bolt's centre may sit from the cursor's, across the column, in
 * logical units.
 *
 * specs/cursor.md puts the bolt "at the cursor's center `x`" and has that x
 * "never change" as it climbs, so a conforming build lands on the figure exactly
 * and half a unit is rounding room. It is a fortieth of the `32`-unit tile the
 * cursor stands over, so a bolt fired down a neighbouring column cannot pass.
 */
const COLUMN_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts one bolt in the cursor's column when Space is held", async () => {
  startPlaying(h);
  h.debug.setCursor(tileCX(COLUMN), BAND_CY);

  const before = h.snapshot();
  await holdFor(h, KEY, HOLD_TICKS);
  const fired = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture that
  // shows what the key put on the board.
  captureStill(h, "fired");

  assertLength(
    before.bolts,
    0,
    "bolts in flight before the key went down, so what is counted after it is " +
      "this press's doing",
  );
  assertLength(
    fired.bolts,
    1,
    `bolts in flight after ${KEY} was held for ${HOLD_TICKS} ticks from a ` +
      `rested fire cooldown — one press inside FIRE_INTERVAL ` +
      `(${FIRE_INTERVAL}) is worth one bolt (specs/controls.md, ` +
      `specs/cursor.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(fired.bolts[0].x - fired.cursor.x),
    COLUMN_TOLERANCE,
    `logical units between the bolt's centre x and the cursor's, which a bolt ` +
      `is created at and never leaves (specs/cursor.md); the cursor was posed ` +
      `on column ${COLUMN}, x = ${tileCX(COLUMN)}`,
  );
});
