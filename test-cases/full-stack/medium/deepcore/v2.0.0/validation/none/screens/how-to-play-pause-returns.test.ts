// screens/how-to-play-pause-returns — the pause key leaves the how-to screen.
//
// `specs/ui.md`'s transition table: `how-to-play` | `BACK`, or the `pause`
// action | `title`. So the key that goes back out of a menu screen works here as
// well as the screen's own `BACK` item, and a player who opened the how-to screen
// is never trapped on it.
//
// ONE ROUTE PER POINT. `screens/how-to-play-back` decides the `BACK` item's
// route. This one presses no menu item at all: it raises the `pause` action and
// reads the screen, so a build whose only way out is the item fails here and
// passes there.
//
// THE KEY IS THE SPECIFICATION'S. `ACTION_KEY.pause` is the first code
// `specs/controls.md` binds to `pause`; that EVERY code bound to it raises the
// action is `screens/pause-opens-on-the-second-binding`'s point, not this one.
//
// ISOLATION. The how-to screen posed on a cleared slot, with nothing about an
// expedition touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title on the pause action", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("how-to-play");

  await h.tap(ACTION_KEY.pause);
  await captureStill(h, "back");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "specs/ui.md: the pause action on the how-to-play screen returns to the title",
  );
});
