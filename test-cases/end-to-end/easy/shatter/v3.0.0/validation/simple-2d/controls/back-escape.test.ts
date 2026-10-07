// controls/back-escape — `Escape` pressed on the how-to screen gives the title
// screen.
//
// THE RULE. `specs/controls.md` binds `Escape` to the `back` action, whose menu
// column reads "Leave the screen" and whose playing column reads "Pause", and
// settles the ambiguity outright: "`back` is read on `title`, `howto`, `paused`,
// and `gameover`, and `pause` is read on `playing` and `paused`. `Escape` raises
// both on one frame, so a single `Escape` press on `playing` pauses once and a
// single `Escape` press on `paused` resumes once." Leaving a screen is a press
// edge, "once per press". `specs/ui.md` says where leaving the how-to screen goes:
// "Confirming leaves the screen as leaving it does, and both return to `title`".
//
// THIS IS THE OTHER HALF OF THE AMBIGUOUS KEY. `controls/pause-escape` presses
// `Escape` on `playing` and requires a pause; this one presses it away from play
// and requires the opposite reading. A build that resolved `Escape` to a single
// meaning fails exactly one of the two and passes the other, which names which way
// it got stuck — and the `howto` screen is where that reading is cleanest, since it
// is the one screen `specs/ui.md` gives leaving a destination of its own rather
// than an entry to duplicate. (Leaving `paused` does what `RESUME` does, and
// leaving `title` does nothing at all.)
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game where
// the requirement lives without spending the title menu's own confirm on the way
// (`specs/instrumentation.md`: a screen pose "spawns nothing and clears nothing").
// A route through `HOW TO PLAY` would make this item fail for a build whose confirm
// is broken, which is `screens/howto-reachable`'s point to make and not this one's.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. That contract also makes a press "news for
// exactly one frame", so a build reading the armed edge answers in the first of the
// two frames and a build that latched it answers in the second: both are read.
// `specs/instrumentation.md` gives the debug surface no keyboard operation at all,
// so the whole route from the key to the returned screen is the one a player takes.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the how-to screen SAYS
// (`screens/howto-shows-the-controls`), nor where the title's highlight rests when
// the game gets back there. Only that this key, on this screen, leaves it for the
// title.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "Escape";
const ACTION = "back";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when Escape is pressed on the how-to screen", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `back` action to",
  );

  h.debug.reset();
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the check was posed on",
  );

  await h.tap(KEY);
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen Escape left the how-to screen for",
  );
});
