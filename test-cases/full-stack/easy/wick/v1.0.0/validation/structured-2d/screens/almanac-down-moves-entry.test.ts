// Wick — screens/almanac-down-moves-entry: `down` moves the almanac's entry
// highlight one entry down.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "`up`
// and `down` move `menuIndex` by one over the tab's entries and wrap at both
// ends." `specs/controls.md` gives the `almanac` row "`up`, `down` move the
// entry highlight, wrapping" and binds `down` to `ArrowDown`.
//
// WHAT IS READ. `menuIndex` after the press. One press is one move, so the
// reading is `1` from the `0` the screen arrives with.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it with "`menuIndex` `0`" (`specs/instrumentation.md`), then one real
// `ArrowDown`.
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

it("reads menuIndex 1 after one ArrowDown on the almanac", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the press is made on");
  assertEqual(posed.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "almanac", "the screen after ArrowDown");
  assertEqual(
    after.menuIndex,
    1,
    "menuIndex after one ArrowDown (specs/ui.md, almanac)",
  );
});
