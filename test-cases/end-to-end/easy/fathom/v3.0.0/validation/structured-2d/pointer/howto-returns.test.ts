// pointer/howto-returns — a click completed on the how-to screen leaves it.
//
// specs/ui.md, "Pointer and touch": "The how-to-play screen shows no menu, so it
// carries no item regions. A pointer pressed and released anywhere on `"howto"`
// ... returns to `"title"`, exactly as `confirm` and `back` do, so the screen is
// left by hand as well as by key."
//
// WHY THE POINT EXISTS. The title menu is confirmable by hand, and its second
// entry opens this screen. A build that read the pointer on its menus and nowhere
// else strands a player who has no keyboard on the one screen the game has no
// menu for, so the way out is graded like the way in.
//
// THE GESTURE IS AIMED AT THE MIDDLE OF THE STAGE, because the rule gives it its
// effect ANYWHERE on the screen: there is no region to ask the build for, and the
// stage's own middle is a point every layout covers.
//
// NO KEY IS PRESSED, so a build whose keyboard `back` is broken still has its
// mouse graded here, and a build whose mouse is broken fails this and keeps
// `states.howto-return-back`.
//
// THE SCREEN IS POSED, NOT WALKED TO. `setScreen("howto")` puts the game on it
// without confirming an entry on the title (specs/instrumentation.md), so a build
// with a broken title menu fails the title menu's points and not this one.
//
// Nothing advances on `"howto"` or on `"title"` (specs/ui.md), so the gesture runs
// over a world that cannot move under it.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  clickScreenAt,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The middle of the stage: a point inside every layout of the screen. */
const MIDDLE = { x: STAGE_W / 2, y: STAGE_H / 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when a click is completed on the how-to screen", async () => {
  openTitle(h);
  h.debug.setScreen("howto");
  const posed = h.snapshot();
  assertEqual(posed.screen, "howto", "the screen the click is completed on");

  await clickScreenAt(h, MIDDLE);
  // Before the assertion, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen a pointer pressed and released on the how-to-play screen " +
      "returns to (specs/ui.md)",
  );
});
