// Wick — pointer/almanac-entry-hover-highlights: the pointer resting on the
// third visible entry row highlights that entry.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// `almanac` is one of the screens that "answers the pointer", and "On
// `almanac` it is the visible entry rows, at most `ALMANAC_ROWS` of them, and
// the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`." Rule 1, Hover: "The pointer inside the rectangle of the
// item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex` to `i`."
// `specs/ui.md`, "`almanac`", puts `menuIndex`, `almanacTab`, and
// `almanacScroll` all at `0` on arriving, so the third visible row is the entry
// at `menuIndex` `2`.
//
// WHY THE LIST HOLDS TEN ROWS. `specs/ui.md` gives the `TOOLS` tab "the ten of
// `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen entries, and
// "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at the
// entry at `almanacScroll`", so a tab of sixteen entries at `almanacScroll` `0`
// shows exactly ten rows.
//
// THE DRIVE. `setScreen("almanac")`, which `specs/instrumentation.md` makes
// enter the almanac "exactly as confirming `THE ALMANAC` does: the idle run,
// `menuIndex` `0`, `almanacTab` `0`, `almanacScroll` `0`"; the third visible
// row's rectangle read off `menuRects`; and the pointer moved to its middle for
// one frame. The point is the build's own: the specification fixes no layout
// for the list.
//
// THE TOLERANCE. None on the index. The point is the rectangle's centre, the
// one point inside it that no padding, border, or rounding can put outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  menuRects,
  poseScreen,
  type Harness,
} from "../harness";

/** The position of the third row of the visible window. */
const THIRD_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 2 with the pointer inside the third visible row", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the pointer rests on");
  assertEqual(opened.menuIndex, 0, "menuIndex on arriving at the almanac");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const rects = menuRects(h);
  assertLength(
    rects,
    ALMANAC_ROWS,
    "the list's rectangles, one per visible row (specs/ui.md, almanac)",
  );

  const after = await hoverRect(h, rects[THIRD_ROW]);
  captureStill(h, "hover");

  assertEqual(after.screen, "almanac", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    THIRD_ROW,
    "menuIndex with the pointer inside the third visible row (specs/controls.md, Hover)",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "the list's first visible row, a hover scrolling nothing",
  );
});
