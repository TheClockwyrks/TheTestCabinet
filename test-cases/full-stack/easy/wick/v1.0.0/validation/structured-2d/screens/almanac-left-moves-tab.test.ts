// Wick — screens/almanac-left-moves-tab: `left` moves the almanac's tab one to
// the left.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends, and set `menuIndex` and `almanacScroll` to `0`."
// `specs/controls.md` gives the `almanac` row "`left`, `right` move the tab,
// wrapping" and binds `left` to `ArrowLeft`.
//
// WHAT IS READ. `almanacTab` after the press. The screen arrives at tab `0`,
// which has no tab to its left that is not the wrap, so the second tab is
// reached first with one `ArrowRight` and read there; what this point decides
// is the `ArrowLeft` that follows.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, one
// `ArrowRight` onto tab `1`, then one real `ArrowLeft`.
//
// THE TOLERANCE. None: an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacTab 0 after one ArrowLeft from tab 1", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const moved = await tap(h, "ArrowRight");
  assertEqual(moved.almanacTab, 1, "almanacTab before the press");

  const after = await tap(h, "ArrowLeft");
  captureStill(h, "left");

  assertEqual(after.screen, "almanac", "the screen after ArrowLeft");
  assertEqual(
    after.almanacTab,
    0,
    "almanacTab after one ArrowLeft (specs/ui.md, almanac)",
  );
});
