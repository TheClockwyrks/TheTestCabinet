// Wireworm — controls/space-fires: Space reaches the fire action.
//
// specs/controls.md binds both fire actions, `a` and `b`, to `Space`, and says
// `Space` "fires while the game is being played". specs/cursor.md states what
// firing does: "While the fire action is held, a bolt is fired whenever the
// cooldown is at `0` and fewer than `MAX_BOLTS` bolts are in flight", and "a bolt
// is created with its center in the cursor's column, at the cursor's center `x`".
//
// THE PRESS IS ONE FRAME LONG. `Harness.tap` puts the key down, runs exactly one
// frame, and lifts it — the one shape of press both conformant ways of reading a
// keyboard agree on. One frame is also what makes the count unambiguous: firing
// sets the cooldown to `FIRE_INTERVAL` (0.15 s), which is fifteen frames of this
// harness's clock, so no conforming build can put a second bolt in the air inside
// the press however it reads its keys, and a build that fired once per bound
// action rather than once per cooldown puts two there.
//
// WHAT IS READ, AND WHAT IS LEFT TO ITS OWN POINT. That a bolt appeared and that
// it appeared in the cursor's column — the two things the item's description
// names. How high above the cursor it starts is `cursor.bolt-spawns-at-cursor`'s
// reading, how fast it climbs is `cursor.bolt-travels-up`'s, how soon the next one
// follows is `cursor.fire-interval`'s, and how many may be in the air at once is
// `cursor.bolt-cap`'s. None of them is asserted here.
//
// THE WORLD IS THE CURSOR ALONE. `startPlaying` empties the four rosters — the
// bolt roster included, so the bolt read below can only be the one this press
// produced — shuts the three world gates, parks the cursor at the band's centre
// and leaves `fireCooldown` at `0`, which is the precondition the item names.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this point is about, the one both fire actions are bound to. */
const KEY = "Space";

/**
 * How far the bolt's centre x may sit from the cursor's, in logical units.
 *
 * specs/cursor.md puts a new bolt "at the cursor's center `x`" exactly, and its
 * centre x "never changes" as it climbs, so the honest figure is zero and this is
 * rounding room for a build that rounds a muzzle position to a whole unit or to a
 * device pixel. Half a unit is a forty-eighth of the cursor's own `CURSOR_HALF`
 * (12) box and a sixty-fourth of a `TILE` (32): a bolt fired from a neighbouring
 * column misses by 32 units, sixty-four times this.
 */
const COLUMN_MAX = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("puts one bolt in the cursor's column when Space is pressed", async () => {
  await startPlaying(h);
  await h.advance(1);
  const before = await h.snapshot();

  await h.tap(KEY);
  const after = await h.snapshot();
  await captureStill(h, "fired");

  assertLength(
    after.bolts,
    1,
    `the bolts in flight one frame after Space, from an empty roster with fireCooldown at ${before.fireCooldown}`,
  );
  assertLessThanOrEqual(
    Math.abs(after.bolts[0].x - before.cursor.x),
    COLUMN_MAX,
    `how far the bolt's centre x sits from the cursor's, which was at ${before.cursor.x}`,
  );
});
