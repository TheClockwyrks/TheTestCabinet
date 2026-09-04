// Wireworm — screens/title-screen: the title opens with its first item
// highlighted and draws its title, its tagline and both menu items.
//
// `specs/ui.md` fixes four runs of text for this screen — TITLE_TEXT,
// TAGLINE_TEXT, and both entries of TITLE_ITEMS, all from `../constants` — and
// the frame's own draw calls say what the build actually put on the canvas. The
// game's state is read beside them, so a build that reports a title it never
// draws, or draws one it does not report, fails here rather than passing on
// either half. Matching is by substring, because a menu entry is commonly drawn
// with a selection marker or padding beside it.
//
// The same spec states that "the highlight rests on the first item when the game
// opens", which is the `menuIndex` read below.
//
// Whether the highlighted item is drawn DISTINCTLY is a separate requirement,
// decided by `screens/title-highlight`, so a build that draws all four runs of
// copy but marks no highlight fails there and passes here.

import { afterEach, beforeEach, it } from "vitest";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title with its first item highlighted, drawing the title, the tagline and both menu items", async () => {
  h.debug.reset();
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "reset restores the title screen");
  assertEqual(
    opened.menuIndex,
    0,
    "the title opens with its first item highlighted",
  );

  const drawn = await drawFrame(h);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(drewText(drawn, TITLE_TEXT), true, "the title text is drawn");
  assertEqual(drewText(drawn, TAGLINE_TEXT), true, "the tagline is drawn");
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(drawn, item), true, `the ${item} item is drawn`);
  }
});
