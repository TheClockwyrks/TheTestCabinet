// controls/fire-space — one press of `Space` puts exactly one bullet in flight.
//
// THE RULE. `specs/controls.md` binds `Space` to the `a` action, whose playing
// column reads "Fire the gun", and reads firing "as a press and as a hold. One
// press takes one shot". `specs/weapons.md` says the same from the gun's side: "One
// press of the fire key takes one shot when the gate allows it."
//
// ONE PRESS, HOWEVER MANY ACTIONS IT ARMS — WHICH IS THIS ENGINE'S OWN TRAP.
// `specs/controls.md` binds `Space` to `confirm` as well as to `a`, and under
// `base` to `b` too, and the engine arms an edge on EVERY action a pressed key
// resolves. So one press of `Space` reaches a `base` build as two firing edges,
// and a build that spends each of them without going through the one gate
// `specs/weapons.md` fixes takes two shots from the press a player made once. The
// count below is exactly one, which is what "one press takes one shot" requires
// however many actions the key happens to arm.
//
// AND THIS IS THE PLAYING MEANING. `specs/controls.md` settles the ambiguity by the
// screen: `Space` fires while the game is being played and confirms on a screen
// showing a menu. The field is posed on `playing`, so what the key must do here is
// shoot — a build that confirmed instead would leave the roster empty and fail.
// `controls/confirm-space` is the same key on the other side of that rule.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. That contract also makes a press "news for
// exactly one frame", so a build reading the armed edge answers in the first of
// those two frames and a build that latched it answers in the second: both are
// counted, and neither can slip past unread. The key is down for one frame alone,
// so the HOLD reading of the same key cannot take a second shot either.
// `specs/instrumentation.md` gives the debug surface no keyboard operation at all,
// so the whole route from the key to a round on the roster is the one a player
// takes.
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
import { BINDINGS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "Space";
const ACTION = "a";

/** How many rounds `specs/weapons.md` gives one press: "one press takes one shot". */
const SHOTS_PER_PRESS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly one bullet in flight for one press of Space", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `a` action to",
  );

  startPlaying(h);
  const before = h.snapshot();

  await h.tap(KEY);
  const after = h.snapshot();
  captureStill(h, "shot");

  assertEqual(
    after.bullets.length - before.bullets.length,
    SHOTS_PER_PRESS,
    "the rounds one press of Space added to the roster",
  );
});
