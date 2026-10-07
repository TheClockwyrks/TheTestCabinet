// Wireworm — screens/title-screen: the title screen opens with its first item
// highlighted and carries its title, its tagline and both menu items.
//
// specs/ui.md's `title` table fixes three pieces of copy — `TITLE_TEXT`
// (WIREWORM), `TAGLINE_TEXT` (CUT THE CURRENT) and both entries of
// `TITLE_ITEMS` — and states that "the highlight rests on the first item when
// the game opens".
//
// The copy is matched by SUBSTRING, because the words are the case's and the
// presentation is the build's: a menu entry is commonly drawn with a selection
// marker or padding around it, and requiring the exact run would fail a screen
// showing precisely the right words.
//
// Whether the highlight is drawn DISTINCTLY is a separate requirement and
// `screens/title-highlight` is the item that decides it, so a build that draws
// all four runs of copy but marks no highlight fails there and passes here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/index";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens on the title with its first item highlighted, drawing the title, the tagline and both menu items", async () => {
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "the highlight on arriving at the title");

  assertEqual(drewText(calls, TITLE_TEXT), true, `draws "${TITLE_TEXT}"`);
  assertEqual(drewText(calls, TAGLINE_TEXT), true, `draws "${TAGLINE_TEXT}"`);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }
});
