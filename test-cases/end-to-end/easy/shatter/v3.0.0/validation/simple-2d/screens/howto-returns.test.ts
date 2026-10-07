// screens/howto-returns — leaving the how-to screen returns to the title.
//
// THE RULE. `specs/ui.md` closes the `howto` section with "Confirming leaves the
// screen as leaving it does, and both return to `title`", and `specs/controls.md`
// fixes what leaving is: the `back`
// action, read "as a press edge, once per press", whose menu column reads "leave
// the screen". So a real press of a key bound to `back` on the how-to screen must
// put the game on the title screen — otherwise a player who opened the
// instructions is stuck in them.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` reaches the
// scenario directly (`specs/instrumentation.md`), so what is graded is the way OFF
// the screen and not the way onto it, which is `screens/howto-reachable`'s point.
//
// THE PRESS IS A REAL ONE, at the target the engine listens on, through the key
// `specs/controls.md` binds to `back`. That key is `Escape`, which the same file
// also binds to `pause` — deliberately, one key meaning "get me out of here" —
// and "the screen decides which meaning applies". On `howto` the meaning is
// `back`, so a build that took it as a pause and put a pause menu up over the
// instructions fails here, naming the screen it reached.
//
// WHAT THIS ITEM DOES NOT DECIDE. That `Escape` LEAVES a screen at all as an
// action, which is `controls/back-escape`, nor the title screen's own contents,
// which are `screens/title-shows-the-title` and `screens/title-menu-entries`.
// `specs/ui.md` also says the title's highlight rests on its first entry after the
// return; the manifest's item is the screen alone, so that is left ungraded here
// rather than folded into this grade.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when the how-to screen is left", async () => {
  h.debug.reset();
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the back press was made on",
  );

  await h.tap(keyFor("back"));
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen leaving the how-to returns to (specs/ui.md)",
  );
});
