// Shatter — controls/fire-space: one press of `Space` puts exactly one bullet in
// flight.
//
// THE RULE. `specs/controls.md` binds `Space` to "Fire the gun" while the game is
// being played, and reads firing "as a press and as a hold. One press takes one
// shot". `specs/weapons.md` says the same from the gun's side: "one press of the
// fire key takes one shot when the gate allows it".
//
// `Space` CARRIES A SECOND MEANING, AND THIS IS THE PLAYING ONE. The same key
// confirms a menu selection (`controls/confirm-space`), and `specs/controls.md` says
// the screen decides which meaning applies: "`Space` fires while the game is being
// played and confirms on a screen showing a menu". The field is posed on `playing`,
// so what the key must do here is shoot — and a build that confirmed instead would
// leave the roster empty and fail.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page. The tick between the
// two edges is what makes the press visible to a build that reads its keyboard by
// comparing held state at the top of each tick as well as to one that reads the
// press edge itself; either way the key is down for exactly one tick, so a build
// firing on the edge and a build firing at the gate both take exactly one shot.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path from the physical key to a round on the roster is the build's.
//
// THE GATE IS OPEN. `startPlaying` leaves `fireCooldown` at `0`, which is where a
// life begins (`specs/instrumentation.md`), and empties the bullet roster, so the
// `MAX_BULLETS` (`4`) cap is nowhere near and `specs/weapons.md`'s gate allows the
// shot. That is the condition the item's own description names.
//
// WHAT IS READ IS THE DELTA, NOT THE ROSTER. Counting the difference across the one
// press rather than asserting an empty roster before it keeps this item off
// `instrumentation/clear-bullets`'s ground: a build whose `clearBullets` left
// something behind fails that item and is still graded fairly here.
//
// WHAT THIS ITEM DOES NOT DECIDE. Where the bullet came out, how fast, or what it
// carries — `bullets/fires-from-the-nose`, `bullets/muzzle-speed` and
// `bullets/inherits-ship-velocity`. Nor the gate a HELD key fires at, which is
// `bullets/fire-rate`, nor the cap, which is `bullets/max-four`. Exactly one round,
// from exactly one press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_FIRE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** How many rounds `specs/weapons.md` gives one press: "one press takes one shot". */
const SHOTS_PER_PRESS = 1;

/**
 * One tick run after the press, before the reading is taken.
 *
 * `tap` already runs the tick that delivers the key, so a build that acts on the
 * press edge inside that tick has acted before this. This one tick is for the build
 * that LATCHES the edge and drains it at the top of the next tick, which
 * `specs/controls.md` leaves open: it fixes the press edge as the trigger and says
 * nothing about which tick the effect must land on. It costs nothing either way —
 * `tap` has already released the key, so no further edge can arrive in it.
 */
const SETTLE_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts exactly one bullet in flight for one press of Space", async () => {
  await startPlaying(h);
  const before = await h.snapshot();

  await h.tap(KEY_FIRE);
  await h.advance(SETTLE_TICKS);
  const after = await h.snapshot();
  await captureStill(h, "shot");

  assertEqual(
    after.bullets.length - before.bullets.length,
    SHOTS_PER_PRESS,
    "the rounds one press of Space added to the roster",
  );
});
