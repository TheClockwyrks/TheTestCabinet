// screens/almanac-up-moves-entry — `up` moves the almanac's entry highlight up
// one.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`up` and `down`
// move `menuIndex` by one over the tab's entries and wrap at both ends."
// specs/controls.md ("What each screen reads"), the `almanac` row: "`up`,
// `down` move the entry highlight, wrapping", read as press EDGES, since the row
// holds no key.
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`,
// so the second entry is reached the only way it can be: one `ArrowDown` from
// the `0` the almanac is entered on, read back before the press so that a build
// whose `down` is broken fails the point that owns it rather than this one. Both
// presses are REAL keys through Chromium's input pipeline, each held across
// exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
import { openAlmanac, poseEntry } from "./almanac";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 0 after ArrowUp on the second entry", async () => {
  await openAlmanac(h);
  const posed = await poseEntry(h, 1);
  assertEqual(posed.menuIndex, 1, "the entry the press is made on");

  const after = await pressUp(h);
  await captureStill(h, "up");

  assertHighlight(after, "almanac", 0, "after ArrowUp on the almanac");
});
