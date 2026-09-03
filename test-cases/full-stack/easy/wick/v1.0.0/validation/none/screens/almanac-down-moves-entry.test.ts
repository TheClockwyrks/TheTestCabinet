// screens/almanac-down-moves-entry — `down` moves the almanac's entry highlight
// down one.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`up` and `down`
// move `menuIndex` by one over the tab's entries and wrap at both ends."
// specs/controls.md ("What each screen reads"), the `almanac` row: "`up`,
// `down` move the entry highlight, wrapping", read as press EDGES, since the row
// holds no key.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md makes the same arrival
// as confirming `THE ALMANAC`, so the highlight stands on `0` without a key
// having been pressed. The press is a REAL `ArrowDown` through Chromium's input
// pipeline held across exactly one frame, which is one press edge whichever of
// the two conformant ways a build reads one.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { openAlmanac } from "./almanac";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 1 after ArrowDown on the first entry", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.menuIndex, 0, "the entry the press is made on");

  const after = await pressDown(h);
  await captureStill(h, "down");

  assertHighlight(after, "almanac", 1, "after ArrowDown on the almanac");
});
