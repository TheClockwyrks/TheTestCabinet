// Shatter — controls/back-escape: `Escape` pressed on the how-to screen gives the
// title screen.
//
// THE RULE. `specs/controls.md` binds `Escape` to "Pause" while the game is being
// played and to "Leave the screen" otherwise, and settles the ambiguity outright:
// "`Escape` pauses while the game is being played and leaves the screen otherwise.
// The screen decides which meaning applies." Leaving a screen is a press edge, "once
// per press". `specs/ui.md` says where leaving the how-to screen goes: "Confirming
// leaves the screen as leaving it does, and both return to `title`".
//
// THIS IS THE OTHER HALF OF THE AMBIGUOUS KEY. `controls/pause-escape` presses
// `Escape` on `playing` and requires a pause; this one presses it on `howto` and
// requires the opposite reading. A build that wired `Escape` to a single meaning
// fails exactly one of the two and passes the other, which names which way it got
// stuck — and the `howto` screen is where that reading is cleanest, since it is the
// one screen `specs/ui.md` gives leaving a destination of its own rather than an
// entry to duplicate.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game where
// the requirement lives without spending the title menu's own confirm on the way
// (`specs/instrumentation.md`: it "spawns nothing and clears nothing"). A route
// through `HOW TO PLAY` would make this item fail for a build whose confirm is
// broken, which is `screens/howto-reachable`'s point to make and not this one's.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path from the physical key to the returned screen is the build's.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the how-to screen SAYS
// (`screens/howto-shows-the-controls`), nor where the title's highlight rests when
// the game gets back there. Only that this key, on this screen, leaves it for the
// title.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_BACK } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides. `specs/controls.md` binds `Escape` to back and pause. */
const KEY = KEY_BACK;

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

it("returns to the title when Escape is pressed on the how-to screen", async () => {
  await h.debug.reset();
  await h.debug.setScreen("howto");
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the check was posed on",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "back");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen Escape left the how-to screen for",
  );
});
