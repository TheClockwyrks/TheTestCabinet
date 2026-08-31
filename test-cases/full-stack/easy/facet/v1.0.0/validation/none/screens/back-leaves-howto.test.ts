// Facet — screens/back-leaves-howto: `back` returns from how-to to the title.
//
// specs/ui.md gives the how-to screen exactly one way out — "`back` returns to
// `title` with `menuIndex = 0`" — and specs/controls.md binds `back` to
// `Escape`. There is no other exit: the screen carries no menu, and `confirm`
// is given nothing to take there, so a build that misses this line strands the
// player on the how-to screen for the rest of the session.
//
// The key is real. `tapAction` delivers `back`'s first binding in
// specs/controls.md's table, which that file fixes for a build of every engine,
// as one press the frame reads as an edge — so what is decided here is that the
// key itself reaches the transition, not merely that some pose can perform it.
//
// The screen is reached through `openHowTo()`, which specs/instrumentation.md
// defines as the choice of `HOW TO PLAY` "exactly as choosing that item does",
// so nothing here depends on where that item sits in the title menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title, first item highlighted, on the back key", async () => {
  await h.debug.reset();
  await h.debug.openHowTo();
  assertEqual((await h.snapshot()).screen, "howto", "the screen back is pressed on");

  await h.tapAction("back");

  const left = await h.snapshot();
  await captureStill(h, "title");
  assertEqual(left.screen, "title", "the screen back returns to");
  assertEqual(left.menuIndex, 0, "the highlight on returning to the title");
});
