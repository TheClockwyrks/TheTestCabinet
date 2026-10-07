// Wick — screens/almanac-right-moves-tab: `right` moves the almanac's tab one
// to the right.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends, and set `menuIndex` and `almanacScroll` to `0`."
// `specs/controls.md` gives the `almanac` row "`left`, `right` move the tab,
// wrapping" and binds `right` to `ArrowRight`.
//
// WHAT IS READ. `almanacTab` after the press, which
// `specs/instrumentation.md` reports as "the tab the almanac is showing". One
// press is one move, so the reading is `1` from the `0` the screen arrives
// with.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it with "`almanacTab` `0`" (`specs/instrumentation.md`), then one
// real `ArrowRight`. The starting tab is read before the press.
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

it("reads almanacTab 1 after one ArrowRight from tab 0", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the press is made on");
  assertEqual(posed.almanacTab, 0, "almanacTab before the press");

  const after = await tap(h, "ArrowRight");
  captureStill(h, "right");

  assertEqual(after.screen, "almanac", "the screen after ArrowRight");
  assertEqual(
    after.almanacTab,
    1,
    "almanacTab after one ArrowRight (specs/ui.md, almanac)",
  );
});
