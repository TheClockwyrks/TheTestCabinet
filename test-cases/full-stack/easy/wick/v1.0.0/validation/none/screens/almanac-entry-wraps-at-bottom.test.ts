// screens/almanac-entry-wraps-at-bottom — `down` on the last entry reaches the
// first.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`up` and `down`
// move `menuIndex` by one over the tab's entries and wrap at both ends." The
// entries of the tab this is read on are fixed by the same section: "`TOOLS` |
// the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen of
// them, so the last is index `15` and the wrap from it is `0`.
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`,
// so the last entry is reached the only way it can be: one `ArrowDown` per entry
// from the `0` the almanac is entered on, read back before the press that wraps
// so that a build whose `down` is broken fails the point that owns it rather
// than this one. Every press is a REAL key through Chromium's input pipeline,
// held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { openAlmanac, poseEntry, tabIndex } from "./almanac";
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

it("reads menuIndex 0 after ArrowDown on the last of the sixteen tools", async () => {
  await openAlmanac(h);
  const posed = await poseEntry(h, LAST_ENTRY);
  assertEqual(posed.menuIndex, LAST_ENTRY, "the entry the press is made on");

  const after = await pressDown(h);
  await captureStill(h, "wrap");

  assertHighlight(after, "almanac", 0, "after ArrowDown on the last entry");
});
