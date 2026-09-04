// Wick — pointer/title-hover-highlights: the pointer resting on the second
// title item highlights it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// "Every screen that shows a vertical menu answers the pointer: `title`,
// `almanac`, `levelup`, `paused`, `fallen`, and `dawn`. Each item the menu
// currently shows occupies a rectangle on the stage", and "On `title`,
// `levelup`, `paused`, `fallen`, and `dawn` that is every item of the menu, and
// the rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule
// 1, Hover: "The pointer inside the rectangle of the item at `menuIndex` `i`,
// with `menuIndex` not `i`, sets `menuIndex` to `i`". `specs/ui.md`, "`title`",
// puts `menuIndex` at `0` on arriving, so the second item is `menuIndex` `1`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot,
// which `specs/instrumentation.md` makes "the highlighted item of the current
// screen's menu". The highlight the player sees is drawn from it, and the
// rectangles are read from `menuRects`, which reports "the area a hover or a
// click selects that item inside".
//
// THE DRIVE. `reset` to the title screen, where the specification puts
// `menuIndex` `0`; the build's own rectangle for the second item read back off
// `menuRects`; the pointer moved to the MIDDLE of that rectangle and one frame
// run, which is the frame the hover rule is applied on. No coordinate is
// hard-coded: the specification fixes no layout, so the point aimed at is the
// one the build itself reported.
//
// THE TOLERANCE. None on the index. The point is the rectangle's centre, the
// one point inside it that no padding, border, or rounding can put outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  menuRects,
  type Harness,
} from "../harness";

/** The index of THE ALMANAC, the second item of TITLE_ITEMS (specs/ui.md). */
const SECOND_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 with the pointer inside the second title item", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the pointer rests on");
  assertEqual(before.menuIndex, 0, "menuIndex before the pointer moved");

  const rects = menuRects(h);
  assertLength(
    rects,
    TITLE_ITEMS.length,
    "the title menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await hoverRect(h, rects[SECOND_ITEM]);
  captureStill(h, "hover");

  assertEqual(after.screen, "title", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    SECOND_ITEM,
    "menuIndex with the pointer inside the second item's rectangle (specs/controls.md, Hover)",
  );
});
