// touch/howto-returns — a tap completed on the how-to screen leaves it.
//
// specs/ui.md, "Pointer and touch": "The how-to-play screen shows no menu, so it
// carries no item regions. ... a touch contact landing and lifting anywhere on it
// returns to `"title"`, exactly as `confirm` and `back` do, so the screen is left
// by hand as well as by key."
//
// WHY THE POINT EXISTS. A finger opens this screen through the title menu, and a
// build that read a contact on its menus and nowhere else strands a player on a
// phone here, with no keyboard to press and no item to tap. The way out is graded
// like the way in, and separately from the mouse's, because a finger is read on a
// different path: it never hovers, so its landing and its lift are all the build
// hears.
//
// THE GESTURE IS AIMED AT THE MIDDLE OF THE STAGE, because the rule gives it its
// effect ANYWHERE on the screen: there is no region to ask the build for, and the
// stage's own middle is a point every layout covers.
//
// NO KEY IS PRESSED, so a build whose keyboard `back` is broken still has its
// finger graded here, and a build whose finger is broken fails this and keeps
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
  createHarness,
  openTitle,
  tapScreenAt,
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

it("returns to the title when a tap is completed on the how-to screen", async () => {
  openTitle(h);
  h.debug.setScreen("howto");
  const posed = h.snapshot();
  assertEqual(posed.screen, "howto", "the screen the contact is completed on");

  await tapScreenAt(h, MIDDLE);
  // Before the assertion, so a failing check still leaves the screen it read.
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen a touch contact landed and lifted on the how-to-play screen " +
      "returns to (specs/ui.md)",
  );
});
