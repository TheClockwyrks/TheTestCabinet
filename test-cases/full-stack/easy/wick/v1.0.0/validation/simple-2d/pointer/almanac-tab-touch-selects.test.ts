// pointer/almanac-tab-touch-selects — a contact landing and lifting in a tab's
// rectangle selects that tab.
//
// WHAT THIS DECIDES. One thing: a contact on a tab the almanac is not showing
// selects it, with the list back at its start.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "the almanac's entry rows
//   and its tab rectangles answer a contact exactly as they answer a press and a
//   release", and rule 2 for a tab: "a press and release inside the rectangle of
//   a tab the almanac is not showing selects that tab exactly as `right`
//   reaching it does."
//   specs/ui.md (`almanac`): `left` and `right` "move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and `almanacScroll`
//   to `0`."
//
// WHY IT IS A POINT OF ITS OWN. The tab bar is the almanac's whole navigation,
// so a build that answers no contact there leaves a touch player on the first
// tab. The mouse's route is `pointer/almanac-tab-click-selects`'.
//
// THE DRIVE. The almanac through `setScreen`, its highlight and window moved off
// their starts so the reset is visible, and a contact landing at the middle of
// the THIRD rectangle `tabRects` reports and lifting there.
//
// THE TOLERANCE. None: a screen name and three indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  touchTapRect,
  type Harness,
} from "../harness";
import { tabRectAt } from "./pointing";
import { DOWN_KEY, tapTimes } from "../screens/almanac";

/** The tab the contact takes: the third, which is not the shown one. */
const TAPPED = 2;

/** How far the entry highlight is walked first, so the reset is visible. */
const WALKED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("selects the tab a contact takes, restarting the list", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the contact lands on");
  const walked = await tapTimes(h, DOWN_KEY, WALKED);
  assertEqual(walked.menuIndex, WALKED, "the entry the walk highlighted");

  const rect = tabRectAt(h, TAPPED, "the third tab");
  const after = await touchTapRect(h, rect);
  captureStill(h, "tab");

  assertEqual(after.screen, "almanac", "the screen the contact left");
  assertEqual(after.almanacTab, TAPPED, "the tab the contact selected");
  assertEqual(after.menuIndex, 0, "menuIndex after the tab change");
  assertEqual(after.almanacScroll, 0, "almanacScroll after the tab change");
});
