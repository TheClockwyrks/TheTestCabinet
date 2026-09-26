// Wick — screens/almanac-up-moves-entry: `up` moves the almanac's entry
// highlight one entry up.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "`up`
// and `down` move `menuIndex` by one over the tab's entries and wrap at both
// ends." `specs/controls.md` gives the `almanac` row "`up`, `down` move the
// entry highlight, wrapping" and binds `up` to `ArrowUp`.
//
// WHAT IS READ. `menuIndex` after the press. The screen arrives at entry `0`,
// which has no entry above it that is not the wrap, so entry `1` is reached
// first with one `ArrowDown` and read there; what this point decides is the
// `ArrowUp` that follows.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, one
// `ArrowDown` onto entry `1`, then one real `ArrowUp`.
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

it("reads menuIndex 0 after one ArrowUp from entry 1", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "up");

  assertEqual(after.screen, "almanac", "the screen after ArrowUp");
  assertEqual(
    after.menuIndex,
    0,
    "menuIndex after one ArrowUp (specs/ui.md, almanac)",
  );
});
