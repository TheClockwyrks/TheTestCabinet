// screens/almanac-confirm-inert — `confirm` does nothing on the almanac.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`confirm` and
// `pause` do nothing here." specs/controls.md ("What each screen reads") leaves
// `confirm` off the `almanac` row and states the rule for every such omission:
// "An action a row omits does nothing on that screen, so `confirm` on `almanac`"
// changes nothing. specs/controls.md ("Actions and bindings"): "`confirm` |
// `Enter`, `Space` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. "As they were" is only a reading when the
// three fields are somewhere they could be moved FROM, so the screen is walked
// to the `ENEMIES` tab and out to its thirteenth entry, which carries the window
// off the top of the thirteen the tab holds: a build that reset the tab, the
// highlight, or the window on a confirm reads a different figure for whichever
// it reset. Each field is read back before the press. The press is a REAL
// `Enter` through Chromium's input pipeline held across exactly one frame, which
// is one press edge whichever of the two conformant ways a build reads one.
//
// THE TOLERANCE. None: a screen name and three indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  pressConfirm,
  type Harness,
} from "../harness";
import { openAlmanac, poseEntry, poseTab, tabIndex } from "./almanac";

/** The tab the press is made on, and the entry the list stands out at. */
const ENEMIES = tabIndex("ENEMIES");
const SCROLLED_ENTRY = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen, the tab, the highlight and the window as they were after Enter", async () => {
  await openAlmanac(h);
  await poseTab(h, ENEMIES);
  const posed = await poseEntry(h, SCROLLED_ENTRY);
  assertEqual(posed.almanacTab, ENEMIES, "the tab the press is made on");
  assertEqual(
    posed.menuIndex,
    SCROLLED_ENTRY,
    "the entry the press is made on",
  );
  assertGreaterThan(
    posed.almanacScroll,
    0,
    "the window the walked highlight carried off the top of the list",
  );

  const after = await pressConfirm(h);
  await captureStill(h, "inert");

  assertEqual(after.screen, "almanac", "the screen after Enter (specs/ui.md)");
  assertEqual(
    after.almanacTab,
    posed.almanacTab,
    "almanacTab after Enter (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    posed.menuIndex,
    "menuIndex after Enter (specs/ui.md)",
  );
  assertEqual(
    after.almanacScroll,
    posed.almanacScroll,
    "almanacScroll after Enter (specs/ui.md)",
  );
});
