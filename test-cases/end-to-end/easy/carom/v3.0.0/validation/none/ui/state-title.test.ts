// ui/state-title — the game opens on the title, and the frame draws the copy
// the specification fixes for it.
//
// Two readings of the same frame. The game's own state says which screen it
// is on, and the frame's draw calls say what it put on the canvas, so a build
// that reports a title it never draws, or draws one it does not report, fails
// here rather than passing on either half alone.
//
// The copy is the case's: `TITLE_TEXT` and every entry of `TITLE_ITEMS`
// (specs/ui.md). Matching is by substring, because a menu entry is commonly
// drawn with a selection marker beside it, and that is the build's own
// presentation. Everything else about the screen is the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS, TITLE_TEXT } from "../constants";
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

it("opens on the title and draws its name and menu", async () => {
  await h.debug.reset();
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual((await h.snapshot()).screen, "title");
  assertEqual(drewText(calls, TITLE_TEXT), true);
  for (const item of TITLE_ITEMS) {
    assertEqual(drewText(calls, item), true);
  }
});
