// pointer/almanac-shown-tab-click-inert — clicking the tab the almanac is
// already showing changes nothing.
//
// WHAT THIS DECIDES. One thing: a primary press inside the rectangle of the tab
// at `almanacTab` leaves `almanacTab`, `menuIndex`, and `almanacScroll` exactly
// where they were, so a reader part way down a list keeps their place. That a
// click on a DIFFERENT tab selects it, and resets both indices, is its own
// point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "a click inside the rectangle of a
//   tab the almanac is not showing selects that tab exactly as `right` reaching
//   it does, and a click inside the shown tab's rectangle changes nothing".
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and `almanacScroll`
//   to `0`", so the reset this point reads the ABSENCE of is a real one.
//   specs/instrumentation.md (Menus): `tabRects` reports "one per tab in
//   `ALMANAC_TABS` order", so the rectangle at `almanacTab` is the shown tab's.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The three indices after the
// click. `menuIndex` is carried to `4` first, which is inside the first window
// of ten rows so `almanacScroll` stays `0`; a build that answered the shown
// tab's rectangle as a selection would reset `menuIndex` to `0` and be caught
// by that reading alone.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md); then
// four `down` presses, the only way the surface poses a highlight, which carry
// `menuIndex` to `4` while "The list shows `ALMANAC_ROWS` (`10`) entries at a
// time" keeps `almanacScroll` at `0`. Then a primary press at the middle of the
// rectangle the build reported for tab position `0`, the tab it is showing, and
// the one frame that reads it.
//
// THE TOLERANCE. None: three indices and a screen name are discrete figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { moveHighlightDown, tabRectAt } from "./pointing";

let h: Harness;

/** The tab clicked: the one the almanac arrives showing, position 0. */
const SHOWN = 0;

/** How far down the tools list the reader is carried; inside the first window. */
const STEPS = 4;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the tab, the highlight, and the scroll when the shown tab is clicked", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the click lands on");
  assertEqual(posed.almanacTab, SHOWN, "the tab the almanac is showing");

  const before = await moveHighlightDown(h, STEPS);
  assertEqual(before.menuIndex, STEPS, "the highlight before the click");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const rect = tabRectAt(h, SHOWN, "the tab the almanac is showing");
  const after = await clickRect(h, rect);
  captureStill(h, "shown");

  assertEqual(after.screen, "almanac", "the screen the click left the game on");
  assertEqual(
    after.almanacTab,
    SHOWN,
    "the tab after a click inside the shown tab's rectangle",
  );
  assertEqual(
    after.menuIndex,
    STEPS,
    "the highlight after that click, which specs/controls.md leaves untouched",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "the first visible row after that click, which specs/controls.md leaves untouched",
  );
});
