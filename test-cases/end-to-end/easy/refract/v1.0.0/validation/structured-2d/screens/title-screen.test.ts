// Refract — screens/title-screen: the game opens on the title with menuIndex 0,
// and the title frame draws the copy the specification fixes for it.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas, so a build that reports a title it never draws, or draws one it does
// not report, fails here rather than passing on either half alone.
//
// The copy is the case's: TITLE_TEXT, TAGLINE_TEXT, and every entry of
// TITLE_ITEMS, read from this project's `constants.ts`, which transcribes all
// three from specs/ui.md rather than reading the build's own copy of them.
// Matching is by substring, because a menu entry is commonly drawn with a
// selection marker or padding beside it. Everything else about the screen is
// the build's, rated through the domains.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drewText } from "../case-harness/text";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens on the title with menuIndex 0 and draws the fixed copy", async () => {
  // "Opens on": the state the build initialized into, read before anything is
  // posed — the title, with the highlight on the first item (specs/ui.md:
  // `menuIndex` is 0 on arriving at the title).
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the game opens on the title");
  assertEqual(opened.menuIndex, 0, "the title opens with menuIndex 0");

  // The opening frame's draws, recorded whole: clear the call log, run one
  // frame, and read what that frame put on the canvas.
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(drewText(h.calls, TITLE_TEXT), true, "the title text is drawn");
  assertEqual(drewText(h.calls, TAGLINE_TEXT), true, "the tagline is drawn");
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(h.calls, item), true, `the ${item} item is drawn`);
  }
});
