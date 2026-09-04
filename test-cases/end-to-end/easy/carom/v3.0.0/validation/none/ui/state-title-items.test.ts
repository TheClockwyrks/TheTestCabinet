// ui/state-title-items — the title screen draws its menu.
//
// Two readings of the same frame. The game's own state says which screen it is
// on, and the frame's draw calls say what it put on the canvas, so a build that
// reports a title whose entries it never draws fails here rather than passing on
// either half alone.
//
// The copy is the case's: every entry of `TITLE_ITEMS` (specs/ui.md). Matching
// is by substring, because a menu entry is commonly drawn with a selection
// marker beside it, and that is the build's own presentation. Everything else
// about the screen is the build's.
//
// SPLIT FROM `ui/state-title`, which reads the heading. A build that draws the
// menu but no heading is not the same build as one that draws neither: a player
// who cannot see the entries is choosing between them blind, where a title
// screen missing the word CAROM still reads as a menu and still works.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("draws every entry of the title menu", async () => {
  await h.debug.reset();
  const calls = await h.frameCalls();
  await captureStill(h, "menu");

  assertEqual((await h.snapshot()).screen, "title");
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(calls, item), true);
  }
});
