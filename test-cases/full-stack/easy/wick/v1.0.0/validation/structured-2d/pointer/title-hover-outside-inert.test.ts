// Wick — pointer/title-hover-outside-inert: the pointer inside no rectangle
// moves no highlight.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 1, Hover: "The pointer inside the rectangle of the item at `menuIndex`
// `i`, with `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`.
// The pointer inside no rectangle changes nothing." `specs/ui.md`, "`title`",
// puts `menuIndex` at `0` on arriving, so a highlight that stayed where it was
// reads `0`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` and `screen` off the
// snapshot after the frame that read the pointer. A build that highlights
// whatever row the pointer's height falls on, rather than the rectangle it is
// inside, moves the highlight here and fails.
//
// THE DRIVE. `reset` to the title screen, the menu's own rectangles read off
// `menuRects`, and the pointer moved to a stage point at least
// `MENU_CLEARANCE` units outside every one of them, then one frame. The point
// is SEARCHED FOR against what the build reported rather than named here: the
// specification fixes no layout, so the only honest way to aim at "inside no
// rectangle" is to derive the point from the rectangles the build drew.
//
// THE TOLERANCE. The clearance, and nothing else: `MENU_CLEARANCE` stage units
// of space between the point and the nearest rectangle, which leaves room for a
// hit area a little larger than the rectangle reported and for the rounding
// between stage units and device pixels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverAt,
  menuRects,
  type Harness,
} from "../harness";
import { outsidePoint } from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds menuIndex 0 with the pointer inside no title rectangle", async () => {
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
  const empty = outsidePoint(rects);

  const after = await hoverAt(h, empty.x, empty.y);
  captureStill(h, "outside");

  assertEqual(after.screen, "title", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    0,
    "menuIndex with the pointer inside no rectangle (specs/controls.md, Hover)",
  );
});
