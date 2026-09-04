// input/back-closes-pause — `back` closes the pause menu.
//
// THE REQUIREMENT. `specs/controls.md` gives `back` one ordered list to resolve
// against, and the pause menu's own exit is the FIFTH of the six: "on `paused` the
// pause menu closes". `specs/ui.md` says where that lands — `paused` sits over the
// run, and leaving it returns to `playing` — and states the general rule for menus
// besides: "Every menu that this file gives a `BACK` entry can also be left with
// the back action."
//
// HOW IT IS DECIDED. A run is opened and moved to the pause menu directly, through
// the operation that reaches a screen "exactly as reaching it in play does", so a
// build with a broken pause KEY still has this point decided on its own terms.
// `back` is then pressed once as a player presses it, a real browser key event
// through the build's own keyboard layer, and the screen is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to playing from the pause menu", async () => {
  await openYard(h);
  await h.debug.setScreen("paused");

  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the pause menu showing before back is pressed (specs/ui.md)",
  );

  await h.tap(keyFor("back"));
  await captureStill(h, "back");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    `pressing ${keyFor("back")} on the paused screen to close the pause menu ` +
      "(specs/controls.md, specs/ui.md)",
  );
});
