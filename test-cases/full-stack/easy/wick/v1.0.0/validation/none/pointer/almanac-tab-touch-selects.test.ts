// pointer/almanac-tab-touch-selects — a contact landing and lifting in a tab's
// rectangle selects that tab.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "the almanac's entry rows and its tab rectangles answer a contact
// exactly as they answer a press and a release", and rule 2 for a tab: "a press
// and release inside the rectangle of a tab the almanac is not showing selects
// that tab exactly as `right` reaching it does." specs/ui.md ("`almanac`"):
// `left` and `right` "move `almanacTab` by one over `ALMANAC_TABS`, wrap at both
// ends, and set `menuIndex` and `almanacScroll` to `0`."
//
// WHY THIS IS A POINT OF ITS OWN. The tab bar is the almanac's whole navigation,
// so a build that answers no contact there leaves a touch player on the first
// tab. The mouse's route is `pointer/almanac-tab-click-selects`'.
//
// HOW THE SCENARIO IS DRIVEN. The almanac entered through its `setScreen` row,
// its entry highlight walked to the fifth entry with real `down` presses so the
// reset is visible, and a REAL contact landing at the middle of the THIRD
// rectangle `tabRects()` reports and lifting there. The third is a tab the
// almanac is not showing, which is the case the rule fixes.
//
// THE TOLERANCE. None: a screen name and three indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { highlightEntry, poseAlmanac, tabPoints } from "./stage";

/** The tab the contact takes: the third of `ALMANAC_TABS`, not the shown one. */
const TAPPED = 2;

/** Where the entry highlight stands beforehand, so the reset is visible. */
const HIGHLIGHTED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads almanacTab 2 with the list back at its start after a contact on the third tab", async () => {
  await poseAlmanac(h);
  await highlightEntry(h, HIGHLIGHTED);
  const points = await tabPoints(h, "for the almanac's tab bar");

  const selected = await touchTapAt(h, points[TAPPED]!);
  await captureStill(h, "tab");

  assertEqual(selected.screen, "almanac", "the screen the contact left");
  assertEqual(
    selected.almanacTab,
    TAPPED,
    "almanacTab after a contact inside the third tab's rectangle",
  );
  assertEqual(selected.menuIndex, 0, "menuIndex after the tab change");
  assertEqual(selected.almanacScroll, 0, "almanacScroll after the tab change");
});
