// Spectra — controls/back-escape: `Escape` on the how-to-play screen returns to
// the title.
//
// THE RULE. `specs/controls.md` binds the `back` action — "Leaves the current
// screen." — to `Escape` alone, reads it as a press edge, and lists it among the
// two actions the `howto` screen reads. `specs/ui.md` says `back` on that screen
// "returns to `title`". This point decides that binding.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `Escape` is `back`'s ONLY key:
// there is no alternate to fall back on, so a build that misses it strands the
// player on the how-to-play screen with no way out.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Escape` drives `back` AND
// `pause`, and `specs/controls.md` settles the collision with its table of what
// each screen reads: the `howto` screen reads `back` and does not read `pause`. A
// real `Escape` key event raises both readings at once, and the how-to screen must
// resolve it as the back — which is what pressing the physical key, rather than
// raising an action, puts in front of the build. `controls/pause-escape` decides
// the same key's other reading, in a live wave.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game on the
// screen this point is about, so the verdict rests on the `back` binding alone.
// Walking there through the title menu instead would fold the confirm binding and
// the menu highlight into this point, and a build whose `confirm` was broken would
// fail this one as well — two points for one fault. Reaching the scenario directly
// is what `specs/instrumentation.md` gives `setScreen` for.
//
// WHAT IS NOT ASSERTED. Where the title's highlight comes back to is
// `screens/howto-returns-selection`'s; what the how-to screen draws is
// `screens/howto-content`'s. This point reads the screen the press arrived at and
// nothing else.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline — so what
// reaches the build is a browser-trusted DOM key event on the real page, and the
// frame between the down and the up makes the press visible to a build that
// compares held state between frames as well as to one that latches the edge in
// its handler. Under this engine there is no action layer between the page and the
// game (`specs/instrumentation.md` gives the surface no keyboard operation at
// all), so the whole path from a physical key to the title screen is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The one key `specs/controls.md` binds `back` to. */
const BACK_KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when Escape is pressed on the how-to-play screen", async () => {
  await h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the game is on the how-to-play screen",
  );

  await h.tap(BACK_KEY);
  await captureStill(h, "returned");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "Escape took the back action, which specs/ui.md says returns to the title",
  );
});
