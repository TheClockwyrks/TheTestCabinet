// Facet — screens/howto-screen: HOW TO PLAY reaches the how-to screen.
//
// specs/ui.md gives the title menu's `HOW TO PLAY` one effect — "Sets `screen =
// howto`" — and `howto` is a screen with no menu on it, so `menuIndex` rests at
// `0` there.
//
// THE ITEM IS REALLY CHOSEN. The highlight is posed onto it — `setMenuIndex`
// takes no item, so a build whose `up` and `down` never worked is still asked
// this question — and `confirm` is what takes it, through the key
// specs/controls.md binds and the build's own input path. Nothing here depends
// on where the entry sits in its menu; the ordering is the menu's own point.
//
// WHAT THE SCREEN SAYS IS ITS OWN POINT. `screens/howto-copy` reads the copy
// specs/ui.md asks that screen for: a build can reach the screen and draw
// nothing on it, and a build can draw the copy on a screen no menu entry
// reaches.
//
// GOING BACK IS ITS OWN POINT TOO. That `back` returns to the title with the
// entry that led away highlighted is `screens/back-leaves-howto`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  takeMenuItem,
  type Harness,
} from "../harness";

/** Where `HOW TO PLAY` sits on the title menu, from specs/ui.md's `TITLE_ITEMS`. */
const HOW_TO_PLAY_INDEX = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen when HOW TO PLAY is taken", async () => {
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the item is taken from",
  );

  await takeMenuItem(h, HOW_TO_PLAY_INDEX);
  await captureStill(h, "howto");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "howto", "the screen HOW TO PLAY reaches");
  assertEqual(opened.menuIndex, 0, "the highlight on a screen with no menu");
});
