// Carom — ui/state-title: the title is the screen the game opens on, and it
// draws the copy the specification fixes for it.
//
// Two readings of the same frame. The game's own state says which screen it
// believes it is on, and the frame's draw calls say what it actually put on the
// canvas, so a build that reports a title it never draws, or draws one it does
// not report, fails here rather than passing on either half alone.
//
// The copy is the case's: TITLE_TEXT and every entry of TITLE_ITEMS from
// `src/constants.ts` (specs/ui.md). Matching is by substring, because a menu
// entry is commonly drawn with a selection marker beside it. Everything else
// about the screen is the build's, rated through the domains.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS, TITLE_TEXT } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("opens on the title and draws its name and menu", async () => {
  // The game opens on the title, so this `reset` is a pose in place rather than
  // a level transition, and the one advanced frame draws the screen it posed.
  h.debug.reset();
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(drewText(h.calls, TITLE_TEXT), true);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
