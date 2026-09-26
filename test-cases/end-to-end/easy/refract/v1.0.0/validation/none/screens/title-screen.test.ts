// Refract — screens/title-screen: the game opens on the title with menuIndex 0,
// and the frame draws the copy the specification fixes for it.
//
// Two readings of the same frame. The game's own state says which screen it is
// on and where the highlight sits, and the frame's draw calls say what it put on
// the canvas, so a build that reports a title it never draws, or draws one it
// does not report, fails here rather than passing on either half alone.
//
// The copy is the case's: `TITLE_TEXT`, `TAGLINE_TEXT`, and every entry of
// `TITLE_ITEMS`, in the table specs/ui.md gives the `title` screen. Matching is
// by substring, because a menu entry is commonly drawn with a selection marker
// beside it, and that is the build's own presentation. Everything else about the
// screen is the build's.

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

it("opens on the title with menuIndex 0, drawing the fixed copy", async () => {
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at the title");

  assertEqual(drewText(calls, TITLE_TEXT), true, `draws "${TITLE_TEXT}"`);
  assertEqual(drewText(calls, TAGLINE_TEXT), true, `draws "${TAGLINE_TEXT}"`);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(calls, item), true, `draws the menu item "${item}"`);
  }
});
