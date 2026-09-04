// ui/state-title — the game opens on the title, and the frame draws the title
// copy.
//
// Two readings of the same frame. The game's own state says which screen it
// is on, and the frame's draw calls say what it put on the canvas, so a build
// that reports a title it never draws, or draws one it does not report, fails
// here rather than passing on either half alone.
//
// The copy is the case's: `TITLE_TEXT` (specs/ui.md). Matching is by substring,
// because a heading is commonly drawn with decoration around it, and that is the
// build's own presentation. Everything else about the screen is the build's.
//
// THE MENU'S OWN ENTRIES ARE `ui/state-title-items`'S POINT. A build that draws
// its menu but no heading is not the same build as one that draws neither: the
// first is a title screen a player can use and the second is not, so the two
// halves are graded apart and capped apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_TEXT } from "../constants";
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

it("opens on the title and draws its name", async () => {
  await h.debug.reset();
  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual((await h.snapshot()).screen, "title");
  assertEqual(drewText(calls, TITLE_TEXT), true);
});
