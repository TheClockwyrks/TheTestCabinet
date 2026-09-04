// Carom — ui/state-pause: the pause menu draws the items the specification fixes
// for it.
//
// Two readings of the same frame. The game's own state says it is on `paused`,
// and the frame's draw calls say what it actually put on the canvas, so a build
// that reports a pause menu it never draws, or draws one it does not report,
// fails here rather than passing on either half alone.
//
// The menu is POSED over a live match. `enterPlaying` reaches `playing` and
// `openPause` is `setResumeScreen("playing")`, `setMenuIndex(0)` and
// `setScreen("paused")` — the three fields specs/ui.md says a `pause` edge sets —
// so the menu is raised over a match in flight rather than over its countdown.
// Whether a key opens it is `controls-solo/escape` and `controls-versus/escape`'s
// point, and whether its entries do what they say is the navigation category's, so
// a build with a broken pause key and a perfectly good pause menu fails those and
// passes this one.
//
// The field is left standing behind the menu. specs/ui.md says in as many words
// that the field is visible and frozen there, nothing advances on `paused`, and
// no ball and no obstacle can draw a run of text — so there is nothing here to
// remove, and an emptied field would make the still misrepresent the screen a
// reviewer is grading. Nothing takes a paddle: a menu is not driven through one.
//
// The three entries are the case's own, PAUSE_ITEMS from
// `validation/constants.ts`, which states what specs/ui.md fixes. Matching is by
// substring, because a selected entry is commonly drawn with a marker beside it.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  enterPlaying,
  openPause,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a pause menu carrying every pause item", async () => {
  enterPlaying(h, "versus");
  assertEqual(h.snapshot().screen, "playing");

  openPause(h, "playing");
  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "pause");

  assertEqual(h.snapshot().screen, "paused");
  for (const item of PAUSE_ITEMS) {
    assertEqual(drewText(h.calls, item), true);
  }
});
