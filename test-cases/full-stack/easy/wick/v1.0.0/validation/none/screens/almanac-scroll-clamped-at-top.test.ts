// screens/almanac-scroll-clamped-at-top — walking the highlight back to the
// first entry returns the window to the top of the list.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`almanacScroll`
// follows the highlight: after every move of `menuIndex` it becomes the lesser
// of `almanacScroll` and `menuIndex`, then the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`." Walking back to `menuIndex` `0` makes the
// lesser of the window and `0` equal to `0`, and `0 − 10 + 1` is below it, so
// the window is `0` however far the walk had carried it.
//
// WHY THE WORLD IS POSED AS IT IS. Ten `ArrowDown` presses and then ten
// `ArrowUp` presses, over the sixteen entries of the `TOOLS` tab, so the walk
// goes out far enough to move the window and comes back the same way. The state
// at the turn is read as a PRECONDITION — the highlight at `10` and the window
// off the top — because a walk that never moved the window would decide nothing
// on the way back. Every press is a REAL key through Chromium's input pipeline,
// held across exactly one frame.
//
// THE TOLERANCE. None: two indices are exact comparisons. The precondition asks
// only that the window left the top, because how far it moved is
// `almanac-scroll-follows-highlight`'s point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  pressUp,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { openAlmanac, poseEntry } from "./almanac";

/** How far out the highlight is walked, and back: past the tenth row. */
const WALK = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 0 with almanacScroll 0 after ten downs and ten ups", async () => {
  await openAlmanac(h);
  const out = await poseEntry(h, WALK);
  assertEqual(out.menuIndex, WALK, "the entry the walk reached");
  assertGreaterThan(
    out.almanacScroll,
    0,
    "the window the walk carried off the top of the list",
  );

  let back: WickSnapshot = out;
  for (let i = 0; i < WALK; i += 1) back = await pressUp(h);
  await captureStill(h, "top");

  assertEqual(back.screen, "almanac", "the screen the walk back left");
  assertEqual(back.menuIndex, 0, "menuIndex after the walk back");
  assertEqual(
    back.almanacScroll,
    0,
    "almanacScroll with the highlight back on the first entry (specs/ui.md)",
  );
});
