// screens/almanac-entry-wraps-at-top — `up` on the first entry reaches the last.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`up` and `down`
// move `menuIndex` by one over the tab's entries and wrap at both ends." The
// entries of the tab this is read on are fixed by the same section: "`TOOLS` |
// the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen of
// them, so the wrap from index `0` is index `15`.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md makes the same arrival
// as confirming `THE ALMANAC`, so the highlight stands on `0` of the `TOOLS` tab
// without a key having been pressed. The press is a REAL `ArrowUp` through
// Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries } from "../constants";
import { captureStill, createHarness, pressUp, type Harness } from "../harness";
import { openAlmanac, tabIndex } from "./almanac";
import { assertHighlight } from "./stage";

/** The tab this is read on, and the last of its sixteen entries. */
const TOOLS = tabIndex("TOOLS");
const LAST_ENTRY = almanacEntries(TOOLS).length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 15 after ArrowUp on the first of the sixteen tools", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.menuIndex, 0, "the entry the press is made on");
  assertEqual(opened.almanacTab, TOOLS, "the tab the press is made on");

  const after = await pressUp(h);
  await captureStill(h, "wrap");

  assertHighlight(
    after,
    "almanac",
    LAST_ENTRY,
    "after ArrowUp on the first entry",
  );
});
