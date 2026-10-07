// pointer/almanac-tab-click-selects — clicking a tab the almanac is not showing
// selects it.
//
// WHAT THIS DECIDES. One thing: a primary press inside the rectangle of the tab
// at position `2` selects that tab, which means `almanacTab` `2` with
// `menuIndex` and `almanacScroll` both back at `0`, exactly as `right` reaching
// that tab leaves them. A click on the tab already shown is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "a click inside the rectangle of a
//   tab the almanac is not showing selects that tab exactly as `right`
//   reaching it does".
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and `almanacScroll`
//   to `0`", the tab bar being "`ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`,
//   `PICKUPS`, in that order)".
//   specs/instrumentation.md (Menus): `tabRects` "Reports the rectangles of the
//   almanac's tab bar on `almanac`, one per tab in `ALMANAC_TABS` order ...
//   Each rectangle is the area a click selects that tab inside".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacTab`, `menuIndex`, and
// `almanacScroll` after the click. The reader is first carried deep into the
// tools list, so both indices are away from `0` when the press lands and the
// two zeros read afterwards are facts about what the tab change did rather than
// about a state that never moved.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md); then
// twelve `down` presses, the only way the surface poses a highlight, which
// carry `menuIndex` to `12` and, by "`almanacScroll` follows the highlight",
// `almanacScroll` to `menuIndex − ALMANAC_ROWS + 1` (`3`). Then a primary press
// at the middle of the rectangle the build reported for tab position `2`, and
// the one frame that reads it.
//
// THE TOLERANCE. None: three indices and a screen name are discrete figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { moveHighlightDown, tabRectAt } from "./pointing";

let h: Harness;

/** The tab clicked: `ENEMIES`, position 2 of `ALMANAC_TABS`. */
const CLICKED = 2;

/** How far down the tools list the reader is carried before the click. */
const STEPS = 12;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("selects the tab the click landed in and returns the reader to the top of its list", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the click lands on");
  assertEqual(posed.almanacTab, 0, "the tab the almanac is showing");

  const before = await moveHighlightDown(h, STEPS);
  assertEqual(before.menuIndex, STEPS, "the highlight before the click");
  assertEqual(
    before.almanacScroll,
    STEPS - ALMANAC_ROWS + 1,
    "the list's first visible row, which specs/ui.md has follow the highlight",
  );
  assertNotEqual(
    before.almanacTab,
    CLICKED,
    "the tab shown, which the clicked tab is deliberately not",
  );

  const rect = tabRectAt(h, CLICKED, "the third tab");
  const after = await clickRect(h, rect);
  captureStill(h, "tab");

  assertEqual(after.screen, "almanac", "the screen the click left the game on");
  assertEqual(
    after.almanacTab,
    CLICKED,
    "the tab the click selected, position 2 of ALMANAC_TABS",
  );
  assertEqual(
    after.menuIndex,
    0,
    "the highlight a tab change sets to 0, as specs/ui.md states",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "the first visible row a tab change sets to 0, as specs/ui.md states",
  );
});
